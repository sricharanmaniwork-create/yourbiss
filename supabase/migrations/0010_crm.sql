-- ============================================================================
-- Yourbiss — 0010: CRM (contacts, leads, a workspace's own pipeline, activities)
--
-- What this app is for
--
-- The other apps already catch people: a form answers, a booking arrives. None of
-- them remembers what happened next. CRM is the record of the follow-up — who the
-- person is, whether they were a lead or a customer, what the deal is worth, and
-- what the team did about it.
--
-- Design, and the reasons:
--
--   * Every table carries org_id, so a policy is one membership test, exactly like
--     0002 through 0006. `anon` gets no privilege on any of them: a CRM row is
--     never rendered for an anonymous visitor, so there is nothing to expose.
--
--   * The pipeline is data, not an enum. `crm_stages` is a table the workspace
--     edits, because a studio's stages and a clinic's stages are not the same list
--     and a fixed enum would be a product decision disguised as a schema. What IS
--     fixed is the shape: a stage is `open`, `won` or `lost`, and there is exactly
--     one of each closing stage per workspace (partial unique index), so "did this
--     deal close" has one answer.
--
--   * A deal's state is its stage, never a second column that can disagree with it.
--     There is no `crm_deals.state`: the stage row carries the kind, and the only
--     thing stored on the deal is *when* it closed (won_at / lost_at), written by a
--     trigger that reads the stage it was moved to. Moving a deal back to an open
--     stage clears both, so a re-opened deal cannot be counted twice in a month.
--
--   * A lead converts through one function and not by an edit. `crm_convert_lead`
--     creates the contact, optionally opens a deal, and stamps the lead, in one
--     transaction with the lead row locked — because "converted" that happened
--     twice is two duplicate contacts, and a double-click is a real event. The
--     table itself refuses a hand-set status: `status = 'converted'` requires
--     converted_contact_id and converted_at to be present, so the only way to get
--     there is the way that records what it became.
--
--   * Origin is kept, not inferred. A lead can carry the form submission or the
--     booking it came from, both `on delete set null`, so a response cleaned out of
--     Forms does not silently take the customer's history with it, and the CRM can
--     still say where somebody arrived from.
--
--   * An activity is one row with one of four kinds. Tasks are the only kind that
--     can be done, which the table enforces, so "open tasks" is a where clause and
--     not a convention.
--
-- Privileges live in this file rather than in 0008 for the reason 0008 states: an
-- applied migration is immutable, and a table with policies and no grant looks
-- exactly like a broken policy. Same for the `public.` RPC wrappers, which 0007
-- would otherwise own.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- The lead lifecycle is fixed on purpose: unlike deal stages, these five are what
-- a lead *is* rather than how one workspace names its funnel, and the conversion
-- guard below depends on `converted` meaning exactly one thing.
create type public.crm_lead_status as enum ('new', 'contacted', 'qualified', 'converted', 'unqualified');
create type public.crm_stage_kind  as enum ('open', 'won', 'lost');
create type public.crm_activity_kind as enum ('note', 'call', 'meeting', 'task');

-- ===========================================================================
-- Pipeline stages — the workspace's own list
-- ===========================================================================

create table public.crm_stages (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  kind       public.crm_stage_kind not null default 'open',
  -- Positions are gaps of ten so a stage can be dropped between two others
  -- without renumbering the list. They are not unique: a tie is broken by
  -- created_at, which keeps a reorder to one small UPDATE instead of a shift of
  -- every row after it.
  position   integer not null default 0 check (position between 0 and 10000),
  color      text not null default '#2E6BE6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two stages called "Proposal" is a mistake, and the seed function below relies on
-- this to be safe against a concurrent first visit.
create unique index crm_stages_org_name on public.crm_stages (org_id, lower(name));

-- Exactly one closing stage of each kind, per workspace.
create unique index crm_stages_one_won  on public.crm_stages (org_id, kind) where kind = 'won';
create unique index crm_stages_one_lost on public.crm_stages (org_id, kind) where kind = 'lost';

create index crm_stages_org_order on public.crm_stages (org_id, position, created_at);

-- ===========================================================================
-- Contacts — people this workspace has a relationship with
-- ===========================================================================

create table public.crm_contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  company    text check (company is null or char_length(company) between 1 and 120),
  email      citext,
  phone      text check (phone is null or char_length(phone) between 1 and 40),
  owner_id   uuid references auth.users (id) on delete set null,
  -- Where the contact first arrived from. Free within a shape, because the apps
  -- that will write it (automations, store) are not built yet and should not have
  -- to alter this table to say so.
  source     text not null default 'manual' check (source ~ '^[a-z_]{1,32}$'),
  tags       text[] not null default '{}'::text[]
             check (array_length(tags, 1) is null or array_length(tags, 1) <= 20),
  address    text check (address is null or char_length(address) <= 400),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is null or char_length(email::text) <= 254)
);

-- One person, one row. A blank is not an address, so the two contacts without one
-- are not a conflict.
create unique index crm_contacts_org_email on public.crm_contacts (org_id, email)
  where email is not null and btrim(email::text) <> '';

create index crm_contacts_org_name on public.crm_contacts (org_id, lower(name));
create index crm_contacts_org_owner on public.crm_contacts (org_id, owner_id);

-- Each tag has to be short and has to be a tag, not a paragraph.
create or replace function youbiss.crm_tags_are_clean(p_tags text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_tags is null
      or not exists (
        select 1 from unnest(p_tags) t
        where btrim(t) = '' or char_length(btrim(t)) > 32 or t ~ '[\r\n]'
      );
$$;

alter table public.crm_contacts
  add constraint crm_contacts_tag_shape
  check (youbiss.crm_tags_are_clean(tags));

-- ===========================================================================
-- Leads — prospects that have not become a relationship yet
-- ===========================================================================

create table public.crm_leads (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  company    text check (company is null or char_length(company) between 1 and 120),
  email      citext,
  phone      text check (phone is null or char_length(phone) between 1 and 40),
  owner_id   uuid references auth.users (id) on delete set null,
  source     text not null default 'manual' check (source ~ '^[a-z_]{1,32}$'),
  status     public.crm_lead_status not null default 'new',
  -- Why it was dropped, or what was written down when it arrived. One column,
  -- because a lead that is not qualified has exactly one thing to say about itself.
  reason     text check (reason is null or char_length(reason) <= 1000),
  form_submission_id uuid references public.form_submissions (id) on delete set null,
  booking_id         uuid references public.bookings (id) on delete set null,
  -- Only ever written by youbiss.crm_convert_lead(); see the constraint below.
  converted_contact_id uuid references public.crm_contacts (id) on delete set null,
  converted_deal_id    uuid,
  converted_at         timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is null or char_length(email::text) <= 254),
  -- The one rule that keeps the convert function honest: a lead cannot be marked
  -- converted by an edit that forgets what it turned into.
  check (
    status <> 'converted'
    or (converted_contact_id is not null and converted_at is not null)
  ),
  -- A source that names another app has to point at that app's row, not merely say so.
  check (
    (source <> 'website_form' or form_submission_id is not null)
    and (source <> 'booking' or booking_id is not null)
  )
);

create index crm_leads_org_status on public.crm_leads (org_id, status, created_at desc);
create index crm_leads_org_owner  on public.crm_leads (org_id, owner_id);
create index crm_leads_form       on public.crm_leads (form_submission_id) where form_submission_id is not null;
create index crm_leads_booking    on public.crm_leads (booking_id) where booking_id is not null;

-- ===========================================================================
-- Deals — money that may or may not arrive
-- ===========================================================================

create table public.crm_deals (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 140),
  stage_id   uuid not null references public.crm_stages (id) on delete restrict,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  lead_id    uuid references public.crm_leads (id) on delete set null,
  owner_id   uuid references auth.users (id) on delete set null,
  amount     numeric(14, 2) not null default 0 check (amount >= 0),
  currency   char(3) not null check (currency ~ '^[A-Z]{3}$'),
  expected_close date,
  -- Written only by the stage trigger below, so they cannot drift from the stage.
  won_at  timestamptz,
  lost_at timestamptz,
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A deal is about somebody. It may name both the contact and the lead it came
  -- from, but it may not name nobody.
  check (contact_id is not null or lead_id is not null)
);

create index crm_deals_org_stage  on public.crm_deals (org_id, stage_id, created_at desc);
create index crm_deals_org_owner  on public.crm_deals (org_id, owner_id);
create index crm_deals_contact    on public.crm_deals (contact_id) where contact_id is not null;
create index crm_deals_lead       on public.crm_deals (lead_id) where lead_id is not null;
create index crm_deals_open_close on public.crm_deals (org_id, expected_close) where won_at is null and lost_at is null;

-- The lead's back-reference, added now that the table exists.
alter table public.crm_leads
  add constraint crm_leads_converted_deal
  foreign key (converted_deal_id) references public.crm_deals (id) on delete set null;

-- ===========================================================================
-- Activities — notes, calls, meetings and tasks
-- ===========================================================================

create table public.crm_activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  kind       public.crm_activity_kind not null,
  subject    text check (subject is null or char_length(subject) between 1 and 200),
  body       text check (body is null or char_length(body) <= 4000),
  contact_id uuid references public.crm_contacts (id) on delete cascade,
  lead_id    uuid references public.crm_leads (id) on delete cascade,
  deal_id    uuid references public.crm_deals (id) on delete cascade,
  owner_id   uuid references auth.users (id) on delete set null,
  due_at     timestamptz,
  done_at    timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contact_id is not null or lead_id is not null or deal_id is not null),
  -- A note cannot be "done". Only a task has a completion, which is what makes the
  -- dashboard's open-task count a where clause instead of a guess.
  check (done_at is null or kind = 'task'),
  -- A subject or some words: an empty activity is a row nobody can read later.
  check (coalesce(btrim(subject), '') <> '' or coalesce(btrim(body), '') <> '')
);

create index crm_activities_contact on public.crm_activities (contact_id, created_at desc) where contact_id is not null;
create index crm_activities_lead    on public.crm_activities (lead_id, created_at desc) where lead_id is not null;
create index crm_activities_deal    on public.crm_activities (deal_id, created_at desc) where deal_id is not null;
create index crm_activities_org_due on public.crm_activities (org_id, due_at) where done_at is null and kind = 'task';

-- ===========================================================================
-- Triggers
-- ===========================================================================

create trigger youbiss_crm_stages_touch     before update on public.crm_stages
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_crm_contacts_touch   before update on public.crm_contacts
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_crm_leads_touch      before update on public.crm_leads
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_crm_deals_touch      before update on public.crm_deals
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_crm_activities_touch before update on public.crm_activities
  for each row execute function youbiss.touch_updated_at();

-- A stage's kind is what closes a deal, so changing it would silently re-time
-- every deal that ever sat on it. Moving a deal is the supported way.
create or replace function youbiss.crm_stage_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.kind is distinct from old.kind then
    raise exception 'a pipeline stage keeps its workspace and its kind' using errcode = '42809';
  end if;
  return new;
end;
$$;

create trigger youbiss_crm_stage_immutable
  before update on public.crm_stages
  for each row execute function youbiss.crm_stage_immutable();

-- Deleting a stage out from under a deal would leave the deal nowhere. The FK
-- already refuses it with 23503; this says it in words the screen can show.
create or replace function youbiss.crm_stage_deletable()
returns trigger
language plpgsql
as $$
begin
  if old.kind <> 'open' then
    raise exception 'the won and lost stages are what a deal closes on, they cannot be removed'
      using errcode = '42809';
  end if;
  if exists (select 1 from public.crm_deals d where d.stage_id = old.id) then
    raise exception 'move the deals on this stage somewhere else first' using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger youbiss_crm_stage_deletable
  before delete on public.crm_stages
  for each row execute function youbiss.crm_stage_deletable();

-- The only writer of won_at / lost_at, and the only check that a deal does not sit
-- in another workspace's pipeline. One trigger covers insert and update because
-- both can carry a stage id, and a policy that subqueries crm_stages would be read
-- on every row of a board.
create or replace function youbiss.crm_deal_stage_guard()
returns trigger
language plpgsql
as $$
declare
  v_kind public.crm_stage_kind;
  v_org  uuid;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'a deal does not change workspace' using errcode = '42809';
  end if;

  select s.kind, s.org_id into v_kind, v_org
  from public.crm_stages s
  where s.id = new.stage_id;

  if not found then
    raise exception 'that pipeline stage does not exist' using errcode = 'P0002';
  end if;
  if v_org is distinct from new.org_id then
    raise exception 'a deal cannot sit in another workspace’s pipeline' using errcode = '42501';
  end if;

  if v_kind = 'won' then
    -- coalesce keeps the original close date when a deal is edited while already
    -- won; a deal re-opened and won again is legitimately a new close.
    new.won_at  := coalesce(old.won_at, now());
    new.lost_at := null;
  elsif v_kind = 'lost' then
    new.lost_at := coalesce(old.lost_at, now());
    new.won_at  := null;
  else
    new.won_at  := null;
    new.lost_at := null;
  end if;

  return new;
end;
$$;

create trigger youbiss_crm_deal_stage
  before insert or update on public.crm_deals
  for each row execute function youbiss.crm_deal_stage_guard();

-- A converted lead is the record of a conversion. Its own identity is frozen;
-- who owns it and what is written about it can still change.
create or replace function youbiss.crm_lead_converted_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'converted' and (
       new.name is distinct from old.name
    or new.email is distinct from old.email
    or new.company is distinct from old.company
    or new.phone is distinct from old.phone
    or new.status is distinct from old.status
    or new.converted_contact_id is distinct from old.converted_contact_id
    or new.converted_deal_id is distinct from old.converted_deal_id
    or new.converted_at is distinct from old.converted_at
  ) then
    raise exception 'a converted lead stays as it was converted' using errcode = '42809';
  end if;
  return new;
end;
$$;

create trigger youbiss_crm_lead_converted
  before update on public.crm_leads
  for each row execute function youbiss.crm_lead_converted_guard();

-- A deal's own org must match the workspace of the contact or lead it names, which
-- the policy cannot check without reading two other tables per row.
create or replace function youbiss.crm_deal_target_guard()
returns trigger
language plpgsql
as $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.crm_contacts c where c.id = new.contact_id and c.org_id = new.org_id
  ) then
    raise exception 'a deal cannot name another workspace’s contact' using errcode = '42501';
  end if;
  if new.lead_id is not null and not exists (
    select 1 from public.crm_leads l where l.id = new.lead_id and l.org_id = new.org_id
  ) then
    raise exception 'a deal cannot name another workspace’s lead' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger youbiss_crm_deal_target
  before insert or update on public.crm_deals
  for each row execute function youbiss.crm_deal_target_guard();

-- Same rule for the three kinds of activity target, in one pass.
create or replace function youbiss.crm_activity_target_guard()
returns trigger
language plpgsql
as $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.crm_contacts c where c.id = new.contact_id and c.org_id = new.org_id
  ) then
    raise exception 'that contact is not in this workspace' using errcode = '42501';
  end if;
  if new.lead_id is not null and not exists (
    select 1 from public.crm_leads l where l.id = new.lead_id and l.org_id = new.org_id
  ) then
    raise exception 'that lead is not in this workspace' using errcode = '42501';
  end if;
  if new.deal_id is not null and not exists (
    select 1 from public.crm_deals d where d.id = new.deal_id and d.org_id = new.org_id
  ) then
    raise exception 'that deal is not in this workspace' using errcode = '42501';
  end if;
  if new.owner_id is not null and not exists (
    select 1 from public.org_members m where m.org_id = new.org_id and m.user_id = new.owner_id
  ) then
    raise exception 'a record cannot be owned by someone outside the workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger youbiss_crm_activity_target
  before insert or update on public.crm_activities
  for each row execute function youbiss.crm_activity_target_guard();

-- Contacts and leads carry the same owner rule, so a hand-crafted request cannot
-- hand a customer to a person who left the team.
create or replace function youbiss.crm_owner_is_member()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.org_members m where m.org_id = new.org_id and m.user_id = new.owner_id
  ) then
    raise exception 'a record cannot be owned by someone outside the workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger youbiss_crm_contact_owner
  before insert or update on public.crm_contacts
  for each row execute function youbiss.crm_owner_is_member();
create trigger youbiss_crm_lead_owner
  before insert or update on public.crm_leads
  for each row execute function youbiss.crm_owner_is_member();
create trigger youbiss_crm_deal_owner
  before insert or update on public.crm_deals
  for each row execute function youbiss.crm_owner_is_member();

-- ===========================================================================
-- crm_seed_stages — the first visit to an empty pipeline
--
-- SECURITY DEFINER, which is the one exception in this file and it is here for a
-- specific reason: seeding has to be possible on a member's first visit. As the
-- caller, the insert would run against crm_stages_write — an admin policy — so the
-- hub could only ever offer the pipeline to an owner, and every member who arrived
-- first would see an error instead of a board. A loose insert policy would fix the
-- symptom and be worse: the first member through the door could then hand-write a
-- stage of any name or kind before the admin got there.
--
-- So the function takes the one decision that is safe to take on anyone's say-so —
-- an empty pipeline becomes the six defaults, and nothing else ever changes — and
-- re-asks the two questions the policies ask before it does even that. It cannot
-- rename, reorder, close or overwrite anything, because it refuses to run the
-- moment the workspace has a stage of its own.
--
-- ON CONFLICT DO NOTHING is what makes two people opening CRM for the first time in
-- the same second produce one pipeline: crm_stages_org_name is the constraint that
-- catches it.
-- ===========================================================================
create or replace function youbiss.crm_seed_stages(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_added integer;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'crm')) then
    raise exception 'only a member of this workspace can open its pipeline' using errcode = '42501';
  end if;

  insert into public.crm_stages (org_id, name, kind, position, color)
  select p_org_id, s.name, s.kind, s.position, s.color
  from (values
    ('Qualification', 'open'::public.crm_stage_kind, 10, '#6B7280'),
    ('Meeting set',   'open'::public.crm_stage_kind, 20, '#2E6BE6'),
    ('Proposal sent', 'open'::public.crm_stage_kind, 30, '#7C3AED'),
    ('Negotiation',   'open'::public.crm_stage_kind, 40, '#0F766E'),
    ('Won',           'won'::public.crm_stage_kind,  50, '#15803D'),
    ('Lost',          'lost'::public.crm_stage_kind, 60, '#B91C1C')
  ) as s(name, kind, position, color)
  where not exists (select 1 from public.crm_stages c where c.org_id = p_org_id)
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- ===========================================================================
-- crm_convert_lead — the one way a lead becomes a contact
--
-- SECURITY DEFINER because it writes three tables as one decision, and because the
-- lead row has to be locked before its status is read: two double-clicks arriving
-- on different connections must produce one contact, not two. The membership and
-- app checks are inside it for exactly that reason — a definer body sees rows RLS
-- would hide, so it re-asks the same two questions every policy asks.
--
-- Called twice on purpose returns the first conversion's ids rather than an error,
-- so the screen that lost a race shows the right thing instead of a failure.
-- ===========================================================================
create or replace function youbiss.crm_convert_lead(
  p_lead_id     uuid,
  p_stage_id    uuid,
  p_create_deal boolean default true,
  p_deal_title  text    default null,
  p_amount      numeric default 0
)
returns table (contact_id uuid, deal_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead    public.crm_leads;
  v_stage   public.crm_stages;
  v_contact uuid;
  v_deal    uuid;
begin
  select * into v_lead from public.crm_leads where id = p_lead_id for update;
  if not found then
    raise exception 'that lead is not in this workspace' using errcode = 'P0002';
  end if;

  if not (youbiss.is_member(v_lead.org_id) and youbiss.app_enabled(v_lead.org_id, 'crm')) then
    raise exception 'only a member of this workspace can convert its leads' using errcode = '42501';
  end if;

  if v_lead.status = 'converted' then
    return query select v_lead.converted_contact_id, v_lead.converted_deal_id;
    return;
  end if;

  if p_amount < 0 then
    raise exception 'a deal cannot be worth less than nothing' using errcode = '22003';
  end if;

  if p_create_deal then
    select * into v_stage from public.crm_stages where id = p_stage_id;
    if not found or v_stage.org_id <> v_lead.org_id then
      raise exception 'pick a pipeline stage from this workspace' using errcode = '42501';
    end if;
  end if;

  -- A contact already using that address makes this a merge, not a conversion. Two
  -- records of one person is a decision for the person holding the lead, so the
  -- function refuses rather than picking a row on their behalf — and the unique
  -- index above is what would otherwise have made that choice by accident.
  if v_lead.email is not null and btrim(v_lead.email::text) <> '' and exists (
    select 1 from public.crm_contacts c
    where c.org_id = v_lead.org_id and c.email = v_lead.email
  ) then
    raise exception 'a contact already has that address' using errcode = '23505';
  end if;

  insert into public.crm_contacts (org_id, name, company, email, phone, owner_id, source, created_by)
  values (v_lead.org_id, v_lead.name, v_lead.company, v_lead.email, v_lead.phone,
          v_lead.owner_id, 'lead', auth.uid())
  returning id into v_contact;

  if p_create_deal then
    insert into public.crm_deals (org_id, title, stage_id, contact_id, lead_id, owner_id,
                                 amount, currency, created_by)
    values (v_lead.org_id,
            left(coalesce(nullif(btrim(coalesce(p_deal_title, '')), ''), nullif(btrim(coalesce(v_lead.company, '')), ''), v_lead.name), 140),
            p_stage_id, v_contact, v_lead.id, v_lead.owner_id,
            coalesce(p_amount, 0),
            (select o.currency from public.orgs o where o.id = v_lead.org_id),
            auth.uid())
    returning id into v_deal;
  end if;

  -- The status guard is in the WHERE, not only above: this is the statement that
  -- makes a second concurrent conversion do nothing instead of convert twice.
  update public.crm_leads
     set status = 'converted',
         converted_contact_id = v_contact,
         converted_deal_id = v_deal,
         converted_at = now()
   where id = p_lead_id and status <> 'converted';

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (v_lead.org_id, auth.uid(), 'crm', 'crm_lead', p_lead_id::text, 'converted',
          left(format('Converted %s into a contact%s', v_lead.name,
                      case when v_deal is not null then ' and opened a deal' else '' end), 500));

  return query select v_contact, v_deal;
end;
$$;

-- ===========================================================================
-- crm_counts — the hub, the board header and the dashboard in one read
--
-- The same shape as `org_dashboard_counts` in 0006, for the same reason: the hub
-- needs eleven numbers, and eleven head-counts from the browser would be eleven
-- round trips that each answer a question this function can answer while it is
-- already looking. SECURITY DEFINER so the counts are not filtered by the policy
-- of each table again — every policy here is a membership test, so what it counts
-- is exactly what a member can list, and the one guard inside says so.
--
-- "Open" is asked of the stage, never of a column on the deal: kind = 'open' is the
-- only definition of an unclosed deal in this schema.
-- ===========================================================================
create or replace function youbiss.crm_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'crm')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'stages',        (select count(*) from public.crm_stages s where s.org_id = p_org_id),
    'contacts',      (select count(*) from public.crm_contacts c where c.org_id = p_org_id),
    'leads_open',    (select count(*) from public.crm_leads l where l.org_id = p_org_id
                        and l.status in ('new', 'contacted', 'qualified')),
    'leads_new',     (select count(*) from public.crm_leads l where l.org_id = p_org_id
                        and l.status = 'new'),
    'leads_7d',      (select count(*) from public.crm_leads l where l.org_id = p_org_id
                        and l.created_at > now() - interval '7 days'),
    'converted_30d', (select count(*) from public.crm_leads l where l.org_id = p_org_id
                        and l.status = 'converted' and l.converted_at > now() - interval '30 days'),
    'deals_open',    (select count(*) from public.crm_deals d
                        join public.crm_stages s on s.id = d.stage_id
                       where d.org_id = p_org_id and s.kind = 'open'),
    'deals_value',   (select coalesce(sum(d.amount), 0) from public.crm_deals d
                        join public.crm_stages s on s.id = d.stage_id
                       where d.org_id = p_org_id and s.kind = 'open'),
    'won_30d',       (select count(*) from public.crm_deals d where d.org_id = p_org_id
                        and d.won_at > now() - interval '30 days'),
    'won_30d_value', (select coalesce(sum(d.amount), 0) from public.crm_deals d where d.org_id = p_org_id
                        and d.won_at > now() - interval '30 days'),
    'lost_30d',      (select count(*) from public.crm_deals d where d.org_id = p_org_id
                        and d.lost_at > now() - interval '30 days'),
    'tasks_open',    (select count(*) from public.crm_activities a where a.org_id = p_org_id
                        and a.kind = 'task' and a.done_at is null),
    'tasks_overdue', (select count(*) from public.crm_activities a where a.org_id = p_org_id
                        and a.kind = 'task' and a.done_at is null
                        and a.due_at is not null and a.due_at < now())
  ) into out;

  return out;
end;
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.crm_stages     enable row level security;
alter table public.crm_contacts   enable row level security;
alter table public.crm_leads      enable row level security;
alter table public.crm_deals      enable row level security;
alter table public.crm_activities enable row level security;

-- A stage list is read by everyone in the workspace and edited by the people who
-- own the funnel: moving every deal's possible destinations is a business decision,
-- the same class as a workspace closure in 0005.
create policy crm_stages_select on public.crm_stages
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_stages_write on public.crm_stages
  for all to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'crm'))
  with check (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_contacts_select on public.crm_contacts
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_contacts_insert on public.crm_contacts
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_contacts_update on public.crm_contacts
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

-- Merging or removing a customer is not a Tuesday afternoon click.
create policy crm_contacts_delete on public.crm_contacts
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_leads_select on public.crm_leads
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_leads_insert on public.crm_leads
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

-- converted_* is written only by crm_convert_lead, which runs as definer and so
-- ignores this policy anyway; the table's own CHECK is what stops an edit from
-- claiming a conversion it did not perform.
create policy crm_leads_update on public.crm_leads
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_leads_delete on public.crm_leads
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_deals_select on public.crm_deals
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_deals_insert on public.crm_deals
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

-- Moving a deal along the pipeline is the daily action of this app, so it is a
-- member action. Closing one out of hand — deleting it — is not.
create policy crm_deals_update on public.crm_deals
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_deals_delete on public.crm_deals
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_activities_select on public.crm_activities
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_activities_insert on public.crm_activities
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

-- Anyone in the workspace can add to a record's history and tick a task off; the
-- body of what somebody else wrote stays theirs to change.
create policy crm_activities_update on public.crm_activities
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'crm'));

create policy crm_activities_delete on public.crm_activities
  for delete to authenticated
  using (
    youbiss.app_enabled(org_id, 'crm')
    and (youbiss.is_org_admin(org_id) or created_by = auth.uid())
  );

revoke all on public.crm_stages, public.crm_contacts, public.crm_leads,
              public.crm_deals, public.crm_activities
  from anon, public;

-- ===========================================================================
-- Privileges (see the header: 0008 is applied, so these belong to this file)
-- ===========================================================================
grant select, insert, update, delete on public.crm_stages     to authenticated;
grant select, insert, update, delete on public.crm_contacts   to authenticated;
grant select, insert, update, delete on public.crm_leads      to authenticated;
grant select, insert, update, delete on public.crm_deals      to authenticated;
grant select, insert, update, delete on public.crm_activities to authenticated;

grant all on public.crm_stages, public.crm_contacts, public.crm_leads,
               public.crm_deals, public.crm_activities
  to service_role, postgres;

-- The three callable functions only. The trigger and CHECK helpers above are not
-- revoked, exactly like 0004's form_fields_are_wellformed and 0005's booking
-- guards: a constraint or trigger runs as part of the DML that reaches it, and the
-- `youbiss` schema is not in PostgREST's exposed list, so there is no door to shut.
grant execute on function youbiss.crm_seed_stages(uuid) to authenticated, service_role;
grant execute on function youbiss.crm_counts(uuid) to authenticated, service_role;
grant execute on function youbiss.crm_convert_lead(uuid, uuid, boolean, text, numeric)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The RPC surface. 0007 is applied and immutable, so a new callable function
-- carries its own pass-through wrapper here. SECURITY INVOKER, same as the rest:
-- a wrapper cannot grant anything the inner function does not already allow.
-- ---------------------------------------------------------------------------
create or replace function public.crm_seed_stages(p_org_id uuid)
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.crm_seed_stages(p_org_id);
$$;

create or replace function public.crm_counts(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.crm_counts(p_org_id);
$$;

create or replace function public.crm_convert_lead(
  p_lead_id     uuid,
  p_stage_id    uuid,
  p_create_deal boolean default true,
  p_deal_title  text    default null,
  p_amount      numeric default 0
)
returns table (contact_id uuid, deal_id uuid)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.crm_convert_lead(p_lead_id, p_stage_id, p_create_deal, p_deal_title, p_amount);
$$;

revoke all on function public.crm_seed_stages(uuid) from public;
revoke all on function public.crm_counts(uuid) from public;
revoke all on function public.crm_convert_lead(uuid, uuid, boolean, text, numeric) from public;
grant execute on function public.crm_seed_stages(uuid) to authenticated, service_role;
grant execute on function public.crm_counts(uuid) to authenticated, service_role;
grant execute on function public.crm_convert_lead(uuid, uuid, boolean, text, numeric)
  to authenticated, service_role;

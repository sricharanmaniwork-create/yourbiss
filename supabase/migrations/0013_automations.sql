-- ============================================================================
-- Yourbiss — 0013 · Automations
--
-- "When something happens here, do something over there."
--
-- The suite already keeps a timeline: 0002 created `activity_log`, and every app
-- writes into it — a form response arrives, a booking is cancelled, an order is
-- placed, stock is received. That log is this app's trigger source, which is why no
-- other app has to change for Automations to exist: an event the suite already
-- records is an event an automation can act on.
--
-- What this migration adds:
--
--   * `automation_events` — the vocabulary. Which (app, record, action) triples the
--     log really receives, and which fields of that record may be asked about. It is
--     a table rather than a list in the app code because a rule's foreign key points
--     at it: a rule that names an event nobody writes cannot be saved at all, and the
--     builder offers exactly what the table holds, so the two cannot disagree.
--   * `automation_rules`  — a watched event, up to six conditions on the record it
--     happened to, and one to four actions.
--   * `automation_runs`   — one row per rule per event, with the outcome. The unique
--     key on (rule_id, log_id) is the whole idempotency story: the runner may start
--     twice in a minute and an order still gets one letter.
--   * `automations_counts`— the hub's numbers in one read, as every other app has it.
--
-- The actions themselves run in the Node layer, because the two things an automation
-- can do live there: a letter goes through `sendMail()`, the only door that knows the
-- workspace's own SMTP or Resend settings, and a CRM activity has to find the right
-- record first. This file therefore holds the *shape* an action must have and refuses
-- anything else, so a rule that reaches the runner is a rule the runner can carry out.
--
-- Guarantees, in the order the file enforces them:
--   1. a rule names a real event (foreign key) and real fields of that record;
--   2. its conditions and actions are shape-checked before the row exists;
--   3. an event runs at most once per rule (unique key on the run);
--   4. nobody but the runner writes a run, and a run is never edited or deleted —
--      the browser holds SELECT on `automation_runs` and nothing else;
--   5. a rule never acts on an event older than the moment it was switched on
--      (`watched_from`, moved by `automation_rules_watch_from`).
-- ============================================================================

create type public.automation_outcome as enum ('done', 'skipped', 'failed');

comment on type public.automation_outcome is
  'done: the actions ran. skipped: the conditions said no, which is recorded so the same event is never asked twice. failed: an action could not be carried out, with the reason in automation_runs.detail.';

-- ===========================================================================
-- The vocabulary
-- ===========================================================================

create table public.automation_events (
  app         public.app_key not null,
  entity_type text not null check (entity_type ~ '^[a-z_]{1,40}$'),
  action      text not null check (action ~ '^[a-z_.]{1,60}$'),
  -- The sentence the builder shows. Written here rather than in the app so there is
  -- one copy of "A booking is cancelled" in the product.
  label       text not null check (char_length(label) between 3 and 120),
  -- Which fields of the record a condition may name, with the kind the value input
  -- needs. `id` compares only for equality, `money` and `time` compare as numbers.
  fields      jsonb not null check (youbiss.is_jsonb_array(fields) and jsonb_array_length(fields) between 1 and 12),
  primary key (app, entity_type, action)
);

comment on table public.automation_events is
  'The events the suite writes into activity_log, and the fields of each record Automations may ask about.';

-- Reference data: it is the same for every workspace, so it is inserted by the
-- migration rather than configured, and a member only reads it.
insert into public.automation_events (app, entity_type, action, label, fields) values
  ('forms', 'form_submission', 'created', 'A form response comes in',
   '[{"name":"form_id","label":"Which form","kind":"id"},
     {"name":"state","label":"Response state","kind":"text"},
     {"name":"submitter_email","label":"Email the visitor gave","kind":"email"}]'::jsonb),

  ('bookings', 'booking', 'created', 'A booking is made',
   '[{"name":"state","label":"Booking state","kind":"text"},
     {"name":"source","label":"Where it came from","kind":"text"},
     {"name":"service_id","label":"Which service","kind":"id"},
     {"name":"staff_id","label":"Which staff member","kind":"id"},
     {"name":"customer_name","label":"Customer name","kind":"text"},
     {"name":"customer_email","label":"Customer email","kind":"email"},
     {"name":"starts_at","label":"When it starts","kind":"time"}]'::jsonb),

  ('bookings', 'booking', 'cancelled', 'A booking is cancelled',
   '[{"name":"source","label":"Where it came from","kind":"text"},
     {"name":"service_id","label":"Which service","kind":"id"},
     {"name":"staff_id","label":"Which staff member","kind":"id"},
     {"name":"customer_name","label":"Customer name","kind":"text"},
     {"name":"customer_email","label":"Customer email","kind":"email"},
     {"name":"cancel_reason","label":"Reason given","kind":"text"},
     {"name":"starts_at","label":"When it starts","kind":"time"}]'::jsonb),

  ('bookings', 'booking', 'rescheduled', 'A booking moves to another time',
   '[{"name":"state","label":"Booking state","kind":"text"},
     {"name":"service_id","label":"Which service","kind":"id"},
     {"name":"staff_id","label":"Which staff member","kind":"id"},
     {"name":"customer_name","label":"Customer name","kind":"text"},
     {"name":"customer_email","label":"Customer email","kind":"email"},
     {"name":"starts_at","label":"When it starts","kind":"time"}]'::jsonb),

  ('crm', 'crm_lead', 'converted', 'A lead becomes a contact',
   '[{"name":"status","label":"Lead status","kind":"text"},
     {"name":"source","label":"Lead source","kind":"text"},
     {"name":"name","label":"Lead name","kind":"text"},
     {"name":"email","label":"Lead email","kind":"email"},
     {"name":"company","label":"Company","kind":"text"},
     {"name":"owner_id","label":"Who owns the lead","kind":"id"}]'::jsonb),

  ('inventory', 'inv_purchase', 'received', 'Goods arrive against a purchase order',
   '[{"name":"status","label":"Order status","kind":"text"},
     {"name":"supplier_id","label":"Which supplier","kind":"id"},
     {"name":"number","label":"Order number","kind":"text"},
     {"name":"expected_date","label":"Expected date","kind":"date"}]'::jsonb),

  ('store', 'store_order', 'placed', 'An order comes in from the storefront',
   '[{"name":"status","label":"Order status","kind":"text"},
     {"name":"number","label":"Order number","kind":"text"},
     {"name":"buyer_name","label":"Buyer name","kind":"text"},
     {"name":"buyer_email","label":"Buyer email","kind":"email"},
     {"name":"total","label":"Order total","kind":"money"},
     {"name":"subtotal","label":"Before tax and shipping","kind":"money"},
     {"name":"shipping","label":"Shipping charged","kind":"money"}]'::jsonb),

  ('store', 'store_order', 'confirmed', 'An order is confirmed and stock goes out',
   '[{"name":"status","label":"Order status","kind":"text"},
     {"name":"number","label":"Order number","kind":"text"},
     {"name":"buyer_name","label":"Buyer name","kind":"text"},
     {"name":"buyer_email","label":"Buyer email","kind":"email"},
     {"name":"total","label":"Order total","kind":"money"}]'::jsonb),

  ('store', 'store_order', 'fulfilled', 'An order is marked sent',
   '[{"name":"status","label":"Order status","kind":"text"},
     {"name":"number","label":"Order number","kind":"text"},
     {"name":"buyer_name","label":"Buyer name","kind":"text"},
     {"name":"buyer_email","label":"Buyer email","kind":"email"},
     {"name":"total","label":"Order total","kind":"money"},
     {"name":"paid_at","label":"When it was paid","kind":"time"}]'::jsonb),

  ('store', 'store_order', 'cancelled', 'An order is cancelled',
   '[{"name":"status","label":"Order status","kind":"text"},
     {"name":"number","label":"Order number","kind":"text"},
     {"name":"buyer_name","label":"Buyer name","kind":"text"},
     {"name":"buyer_email","label":"Buyer email","kind":"email"},
     {"name":"total","label":"Order total","kind":"money"}]'::jsonb),

  ('website', 'site', 'published', 'A website is published',
   '[{"name":"name","label":"Site name","kind":"text"},
     {"name":"slug","label":"Site address","kind":"text"},
     {"name":"status","label":"Site status","kind":"text"}]'::jsonb);

alter table public.automation_events enable row level security;

create policy automation_events_select on public.automation_events
  for select to authenticated
  using (true);

-- A member reads the vocabulary; only the migrations change it. There is no insert,
-- update or delete policy, and the grant below offers the browser SELECT alone.
revoke all on public.automation_events from anon, public;
grant select on public.automation_events to authenticated;
grant all on public.automation_events to service_role, postgres;

-- Which field of which record may be asked about, read off the table above.
create or replace function youbiss.automation_field_known(p_entity_type text, p_field text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.automation_events e,
           jsonb_array_elements(e.fields) field
     where e.entity_type = p_entity_type
       and field ->> 'name' = p_field
  );
$$;

-- ===========================================================================
-- Rules
-- ===========================================================================

create table public.automation_rules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  name        text not null check (btrim(name) <> '' and char_length(name) between 1 and 120),
  -- Off is the honest default: a rule is written before anybody has seen what it
  -- sends, and an automation that mails every customer the day it was saved is not a
  -- feature. The switch is the first thing the screen shows.
  enabled     boolean not null default false,
  -- The moment a rule became responsible. The runner only reads events at or after it,
  -- which is what stops a rule written in the morning from mailing every order of the
  -- previous month when it is switched on at night — see `automation_rule_watch` below.
  watched_from timestamptz not null default now(),
  app         public.app_key not null,
  entity_type text not null,
  action      text not null,
  conditions  jsonb not null default '[]'::jsonb check (youbiss.is_jsonb_array(conditions)),
  actions     jsonb not null check (youbiss.is_jsonb_array(actions)),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- The event has to exist. A CHECK cannot hold a subquery in Postgres, so this is a
  -- foreign key, and the same three columns point at the row that lists the fields.
  foreign key (app, entity_type, action)
    references public.automation_events (app, entity_type, action) on delete restrict,
  check (jsonb_array_length(conditions) <= 6),
  check (jsonb_array_length(actions) between 1 and 4)
);

-- Two rules named the same for one event is how a customer gets the same letter twice
-- and nobody can tell which rule sent it.
create unique index automation_rules_org_name on public.automation_rules (org_id, lower(name));
-- What the runner looks for: the enabled rules for one event, in the order they were
-- written, so a rule created first runs first.
create index automation_rules_watch on public.automation_rules (app, entity_type, action, created_at) where enabled;
create index automation_rules_list on public.automation_rules (org_id, created_at desc);

comment on table public.automation_rules is
  'One watched event, the conditions on the record it happened to, and what to do about it.';

-- ---------------------------------------------------------------------------
-- Shape check
--
-- The runner is Node code, and Node code can only act on a shape it recognises. This
-- trigger is what guarantees that: a condition is {field, op, value} on a field the
-- record really has, and an action is a CRM activity or a letter with a recipient the
-- suite can find. Anything else — a stray key, an operator nobody implements, a
-- letter addressed nowhere — is refused on the way in rather than half-run at three
-- in the morning.
-- ---------------------------------------------------------------------------
create or replace function youbiss.automation_rule_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_condition jsonb;
  v_action    jsonb;
  v_op        text;
  v_field     text;
  v_value     text;
  v_kind      text;
  v_to        text;
  v_type      text;
  v_stray     integer;
begin
  ------------------------------------------------------------------ conditions
  for v_condition in select value from jsonb_array_elements(new.conditions) loop
    if jsonb_typeof(v_condition) <> 'object' then
      raise exception 'a condition is a field, an operator and a value' using errcode = '23514';
    end if;

    -- Exactly field + op, optionally a value. A fourth key would be a setting that
    -- nothing reads, which is worse than not offering it.
    select count(*) into v_stray
      from jsonb_object_keys(v_condition) key
     where key not in ('field', 'op', 'value');

    if v_stray > 0 or not (v_condition ? 'field') or not (v_condition ? 'op') then
      raise exception 'a condition is a field, an operator and a value — nothing else'
        using errcode = '23514';
    end if;

    v_field := v_condition ->> 'field';
    v_op    := v_condition ->> 'op';
    v_value := v_condition ->> 'value';

    if not youbiss.automation_field_known(new.entity_type, v_field) then
      raise exception '% is not something a % row has', coalesce(v_field, 'that'), new.entity_type
        using errcode = '23514';
    end if;

    if v_op not in ('equals', 'not_equals', 'contains', 'greater', 'less', 'is_empty', 'is_not_empty') then
      raise exception 'the % comparison is not one Automations knows', coalesce(v_op, 'missing')
        using errcode = '23514';
    end if;

    -- The two emptiness questions ask about the field alone, so a value beside them
    -- would be ignored. The rest need one.
    if v_op in ('is_empty', 'is_not_empty') then
      if v_condition ? 'value' then
        raise exception 'a % question has no value to compare against', v_op using errcode = '23514';
      end if;
    elsif v_value is null or btrim(v_value) = '' then
      raise exception 'a % comparison needs a value', v_op using errcode = '23514';
    elsif char_length(v_value) > 200 then
      raise exception 'a condition value is at most 200 characters' using errcode = '23514';
    end if;

    -- A money or date question is only meaningful against a number or a date, and the
    -- runner would have to guess. Say so here, when the writer is still looking at it.
    if v_op in ('greater', 'less')
       and exists (
         select 1 from public.automation_events e, jsonb_array_elements(e.fields) f
          where e.entity_type = new.entity_type and f ->> 'name' = v_field
            and f ->> 'kind' = 'money'
       )
       and v_value !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'compare an amount against a number, not against %', v_value
        using errcode = '23514';
    end if;
  end loop;

  ---------------------------------------------------------------------- actions
  for v_action in select value from jsonb_array_elements(new.actions) loop
    if jsonb_typeof(v_action) <> 'object' then
      raise exception 'an action is an object with a type' using errcode = '23514';
    end if;

    v_type := v_action ->> 'type';

    if v_type = 'crm_activity' then
      v_kind := v_action ->> 'kind';

      select count(*) into v_stray
        from jsonb_object_keys(v_action) key
       where key not in ('type', 'kind', 'subject', 'body', 'due_days');

      if v_stray > 0 or not (v_action ? 'kind') or not (v_action ? 'subject') then
        raise exception 'a CRM activity action is a kind and a subject, with an optional body and due date'
          using errcode = '23514';
      end if;

      if v_kind is null or v_kind not in ('note', 'call', 'task') then
        raise exception 'a CRM activity is a note, a call or a task' using errcode = '23514';
      end if;

      if coalesce(btrim(v_action ->> 'subject'), '') = '' then
        raise exception 'a CRM activity needs a subject somebody can read later' using errcode = '23514';
      end if;

      if char_length(v_action ->> 'subject') > 200 then
        raise exception 'a CRM activity subject is at most 200 characters' using errcode = '23514';
      end if;

      if v_action ? 'body' and char_length(coalesce(v_action ->> 'body', '')) > 4000 then
        raise exception 'a CRM activity body is at most 4000 characters' using errcode = '23514';
      end if;

      if v_action ? 'due_days'
         and (jsonb_typeof(v_action -> 'due_days') <> 'number'
              or (v_action ->> 'due_days')::numeric not between 0 and 365) then
        raise exception 'a task is due within a year' using errcode = '23514';
      end if;

      -- A call has no completion, and only a task can be due. Same rule 0010 puts on
      -- the activity table itself, checked here before the row ever reaches it.
      if v_action ? 'due_days' and v_kind <> 'task' then
        raise exception 'only a task can be due' using errcode = '23514';
      end if;

    elsif v_type = 'letter' then
      v_to := v_action ->> 'to';

      select count(*) into v_stray
        from jsonb_object_keys(v_action) key
       where key not in ('type', 'to', 'subject', 'body', 'address');

      if v_stray > 0 or not (v_action ? 'to') or not (v_action ? 'subject') or not (v_action ? 'body') then
        raise exception 'a letter action goes somewhere and says something' using errcode = '23514';
      end if;

      if v_to not in ('record', 'owner', 'address') then
        raise exception 'a letter goes to the record, the workspace owner, or one fixed address'
          using errcode = '23514';
      end if;

      if v_to = 'address' then
        if coalesce(v_action ->> 'address', '') !~ '^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$' then
          raise exception 'a letter to one fixed address needs a real email address' using errcode = '23514';
        end if;
      elsif v_action ? 'address' then
        raise exception 'a letter to the record or the owner has no address of its own' using errcode = '23514';
      end if;

      if coalesce(btrim(v_action ->> 'subject'), '') = '' then
        raise exception 'a letter needs a subject' using errcode = '23514';
      end if;

      if char_length(v_action ->> 'subject') > 200 then
        raise exception 'a letter subject is at most 200 characters' using errcode = '23514';
      end if;

      if coalesce(btrim(v_action ->> 'body'), '') = '' then
        raise exception 'a letter needs something to say' using errcode = '23514';
      end if;

      if char_length(v_action ->> 'body') > 4000 then
        raise exception 'a letter body is at most 4000 characters' using errcode = '23514';
      end if;

    else
      raise exception 'Automations can write a CRM activity or send a letter, not %',
        coalesce(v_type, 'nothing') using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

create trigger automation_rules_guard
  before insert or update of name, app, entity_type, action, conditions, actions
  on public.automation_rules
  for each row execute function youbiss.automation_rule_guard();

create trigger automation_rules_touch
  before update on public.automation_rules
  for each row execute function youbiss.touch_updated_at();

-- ---------------------------------------------------------------------------
-- When a rule becomes responsible
--
-- A rule is written in one sitting and switched on in another, and the events keep
-- arriving in between. Without this, the moment a shop switches on "letter the buyer
-- when an order is confirmed" at night, the runner would find that morning's orders —
-- ones somebody already wrote to by hand — and send a late letter for each.
--
-- So switching a rule on moves its own start line to now, and re-pointing a rule at a
-- different event does the same. Nothing replays what happened before that line — not
-- "Run now", not a cron tick, not an edit — which is the difference between an
-- automation that starts today and a script that discovers last month's customers.
-- ---------------------------------------------------------------------------
create or replace function youbiss.automation_rule_watch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.enabled and not old.enabled then
    new.watched_from := now();
  end if;

  if new.app is distinct from old.app
     or new.entity_type is distinct from old.entity_type
     or new.action is distinct from old.action then
    new.watched_from := now();
  end if;

  return new;
end;
$$;

create trigger automation_rules_watch_from
  before update on public.automation_rules
  for each row execute function youbiss.automation_rule_watch();

-- ===========================================================================
-- Runs
--
-- The screen's "what happened" and the runner's "have I done this one yet", in the
-- same table. `log_id` points at the event, so a run can always be read next to the
-- sentence that triggered it, and the unique key is what lets the runner be started
-- twice without sending the same letter twice.
--
-- A rule that has run is not deletable by its conditions being wrong: the runs go
-- with the rule on delete, because they describe a decision that rule made.
-- ===========================================================================

create table public.automation_runs (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  rule_id    uuid not null references public.automation_rules (id) on delete cascade,
  log_id     bigint not null references public.activity_log (id) on delete cascade,
  outcome    public.automation_outcome not null,
  detail     text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now(),
  unique (rule_id, log_id)
);

create index automation_runs_org_time on public.automation_runs (org_id, created_at desc);
create index automation_runs_rule_time on public.automation_runs (rule_id, created_at desc);

comment on table public.automation_runs is
  'One row per rule per event: done, skipped by the conditions, or failed with the reason.';

-- ===========================================================================
-- RLS
--
-- The same two questions as every other app: is this person a member, and is
-- Automations switched on. Writing a rule is ordinary work for any member — it is a
-- decision about how the workspace runs — but deleting one is left to an owner or
-- admin, because it takes the run history with it.
-- ===========================================================================

alter table public.automation_rules enable row level security;
alter table public.automation_runs enable row level security;

create policy automation_rules_select on public.automation_rules
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'automations'));

create policy automation_rules_insert on public.automation_rules
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'automations'));

create policy automation_rules_update on public.automation_rules
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'automations'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'automations'));

create policy automation_rules_delete on public.automation_rules
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'automations'));

-- Evidence, not a worklist: a member reads the runs, and nothing but the runner —
-- which is the service role — writes one.
create policy automation_runs_select on public.automation_runs
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'automations'));

revoke all on public.automation_rules, public.automation_runs from anon, public;

grant select, insert, update, delete on public.automation_rules to authenticated;
grant select on public.automation_runs to authenticated;

grant all on public.automation_rules, public.automation_runs to service_role, postgres;

-- ===========================================================================
-- Counts — the hub in one read
-- ===========================================================================

create or replace function youbiss.automations_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'automations')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'rules',    (select count(*) from public.automation_rules r where r.org_id = p_org_id),
    'enabled',  (select count(*) from public.automation_rules r where r.org_id = p_org_id and r.enabled),
    -- The day, split the way the hub prints it. Forty skipped and no failures says
    -- the conditions are doing their work, which is a different sentence from a day
    -- with nothing in it at all.
    'runs_24h', (select count(*) from public.automation_runs x
                   where x.org_id = p_org_id and x.created_at > now() - interval '24 hours'),
    'done_24h', (select count(*) from public.automation_runs x
                   where x.org_id = p_org_id and x.outcome = 'done'
                     and x.created_at > now() - interval '24 hours'),
    'failed_24h',(select count(*) from public.automation_runs x
                   where x.org_id = p_org_id and x.outcome = 'failed'
                     and x.created_at > now() - interval '24 hours'),
    'last_run_at', (select to_char(max(x.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                      from public.automation_runs x
                     where x.org_id = p_org_id),
    -- Everything the log received today, whether a rule looked at it or not: the
    -- difference between "nothing happened" and "nothing you care about happened".
    'events_24h', (select count(*) from public.activity_log a
                     where a.org_id = p_org_id
                       and a.app_key in ('website','forms','bookings','crm','inventory','store')
                       and a.created_at > now() - interval '24 hours')
  ) into out;

  return out;
end;
$$;

-- ===========================================================================
-- Privileges and the RPC surface
--
-- PostgREST only exposes `public`, so a callable function carries its own SECURITY
-- INVOKER wrapper, exactly as 0007, 0010, 0011 and 0012 do. The wrapper adds no
-- permission: every body above re-checks the caller.
-- ===========================================================================

create or replace function public.automations_counts(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.automations_counts(p_org_id);
$$;

-- The builder's list of things that can happen. No org and no membership, because it
-- is the vocabulary, not the data: what a workspace can do with it is bounded by the
-- policies and the foreign key above.
create or replace function public.automation_triggers()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'app', e.app,
      'entity_type', e.entity_type,
      'action', e.action,
      'label', e.label,
      'fields', e.fields
    ) order by e.app, e.entity_type, e.action),
    '[]'::jsonb
  )
  from public.automation_events e;
$$;

revoke all on function youbiss.automation_field_known(text, text) from public;
revoke all on function public.automations_counts(uuid) from public;
revoke all on function public.automation_triggers() from public;

grant execute on function youbiss.automation_field_known(text, text) to authenticated, service_role;
grant execute on function public.automations_counts(uuid) to authenticated, service_role;
grant execute on function public.automation_triggers() to authenticated, service_role;

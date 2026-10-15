-- ============================================================================
-- Yourbiss — 0004: forms (definitions, private settings, submissions)
--
-- `forms` holds only what a public form page may render. Addresses the results
-- are mailed to, the redirect target and any webhook live in `form_privates`,
-- which has no SELECT path reachable from a public route — so leaking them is a
-- code problem to fix, not something a joined select can do by accident.
--
-- Submissions are not insertable by any client role. The only write path is the
-- server route, which validates the payload against the stored definition,
-- checks the honeypot, and rate-limits before it inserts with the service role.
-- ============================================================================

create type public.form_status      as enum ('draft', 'published', 'archived');
create type public.form_entry_state as enum ('new', 'read', 'replied', 'spam');

create table public.forms (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  site_id         uuid references public.sites (id) on delete set null,
  title           text not null check (char_length(title) between 1 and 140),
  description     text check (description is null or char_length(description) <= 2000),
  slug            citext not null check (not youbiss.is_reserved_slug(slug)),
  status          public.form_status not null default 'draft',
  fields          jsonb not null check (youbiss.is_jsonb_array(fields)),
  layout          jsonb not null default '[]'::jsonb check (youbiss.is_jsonb_array(layout)),
  settings        jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(settings)),
  theme           jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(theme)),
  submission_count integer not null default 0 check (submission_count >= 0),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, slug)
);

-- Fields a form may reference: keep dangling ids from being possible at all.
create or replace function youbiss.form_fields_are_wellformed(p_fields jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_fields) = 'array'
     and jsonb_array_length(p_fields) <= 200
     and not exists (
       select 1
       from jsonb_array_elements(p_fields) f
       where jsonb_typeof(f) <> 'object'
          or coalesce(f ->> 'id', '') !~ '^[a-zA-Z0-9_-]{1,64}$'
          or coalesce(f ->> 'type', '') !~ '^[a-z_]{1,32}$'
          or coalesce(char_length(f ->> 'label'), 0) > 200
     )
     -- a field cannot point its logic at a field that does not exist
     and not exists (
       select 1
       from jsonb_array_elements(p_fields) f,
            jsonb_array_elements(
              case when jsonb_typeof(f -> 'logic' -> 'conditions') = 'array'
                   then f -> 'logic' -> 'conditions' else '[]'::jsonb end
            ) c
       where not exists (
         select 1 from jsonb_array_elements(p_fields) g
         where g ->> 'id' = c ->> 'field_id'
       )
     );
$$;

alter table public.forms
  add constraint forms_fields_shape
  check (youbiss.form_fields_are_wellformed(fields));

create table public.form_privates (
  form_id           uuid primary key references public.forms (id) on delete cascade,
  org_id            uuid not null references public.orgs (id) on delete cascade,
  notify_emails     text[] not null default '{}'::text[]
                    check (array_length(notify_emails, 1) is null
                           or array_length(notify_emails, 1) <= 20),
  notify_recipient  boolean not null default false,
  confirmation_html text check (confirmation_html is null or char_length(confirmation_html) <= 20000),
  confirmation_subject text check (confirmation_subject is null or char_length(confirmation_subject) <= 200),
  redirect_url      text check (redirect_url is null or redirect_url ~ '^https?://'),
  webhook_url       text check (webhook_url is null or webhook_url ~ '^https://'),
  webhook_secret    text check (webhook_secret is null or char_length(webhook_secret) <= 200),
  updated_at        timestamptz not null default now()
);

create table public.form_submissions (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references public.forms (id) on delete cascade,
  org_id          uuid not null references public.orgs (id) on delete cascade,
  data            jsonb not null check (youbiss.is_jsonb_object(data)),
  submitter_email citext,
  state           public.form_entry_state not null default 'new',
  -- Hashed, not raw: useful for duplicate detection without storing the
  -- visitor's address in the clear.
  visitor_key     text check (visitor_key is null or visitor_key ~ '^[a-f0-9]{16,64}$'),
  source_url      text check (source_url is null or char_length(source_url) <= 500),
  user_agent      text check (user_agent is null or char_length(user_agent) <= 300),
  created_at      timestamptz not null default now()
);

create index forms_org_idx              on public.forms (org_id, status);
create index submissions_form_created   on public.form_submissions (form_id, created_at desc);
create index submissions_org_state      on public.form_submissions (org_id, state, created_at desc);
-- The hourly duplicate guard is a query inside record_form_submission, not an
-- expression index: `date_trunc('hour', created_at)` is STABLE (it depends on
-- the session TimeZone), and Postgres rejects any non-IMMUTABLE function in an
-- index expression. This index is what that lookup runs on.
create index submissions_form_visitor
  on public.form_submissions (form_id, visitor_key, created_at desc)
  where visitor_key is not null;

-- ===========================================================================
-- Bookkeeping: the counter and the published timestamp follow the row's own
-- state, so they cannot drift from what the UI shows.
-- ===========================================================================
create or replace function youbiss.forms_state_touch()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := now();
  elsif new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger youbiss_forms_state
  before insert or update on public.forms
  for each row execute function youbiss.forms_state_touch();

create trigger youbiss_forms_touch before update on public.forms
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_form_privates_touch before update on public.form_privates
  for each row execute function youbiss.touch_updated_at();

-- A private row must always exist for a form, and must share the form's org.
create or replace function youbiss.forms_ensure_private_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.form_privates (form_id, org_id)
  values (new.id, new.org_id)
  on conflict (form_id) do update set org_id = excluded.org_id;
  return new;
end;
$$;

create trigger youbiss_form_private_mirror
  after insert or update of org_id on public.forms
  for each row execute function youbiss.forms_ensure_private_row();

-- ===========================================================================
-- record_form_submission
--
-- Called by the public submit route with the service role. Everything that has
-- to be true about a payload is asserted here, in the same statement as the
-- insert, so a future caller cannot skip a step: the form must be published, the
-- answers must line up with the stored field list, required fields must be
-- present, and the hourly duplicate guard is enforced by the caller's key.
-- ===========================================================================
create or replace function youbiss.record_form_submission(
  p_form_id       uuid,
  p_data          jsonb,
  p_submitter_email text,
  p_visitor_key   text,
  p_source_url    text,
  p_user_agent    text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form      public.forms;
  v_answer    text;
  v_field     jsonb;
  v_missing   text[] := '{}';
  v_sub_id    uuid;
begin
  select * into v_form from public.forms f where f.id = p_form_id for update;
  if not found then
    raise exception 'form not found' using errcode = 'P0002';
  end if;
  if v_form.status <> 'published' then
    raise exception 'this form is not accepting responses' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'answers must be an object';
  end if;

  -- Duplicate guard. The form row is locked above, so two submissions from the
  -- same visitor to the same form cannot both read "no answer in the last hour"
  -- and both insert — the lock makes this check atomic without an expression
  -- index. errcode 23505 is deliberate: it is the same code a unique violation
  -- raises, so the route that calls this can keep one message for both.
  if p_visitor_key is not null and exists (
    select 1 from public.form_submissions s
    where s.form_id = p_form_id
      and s.visitor_key = p_visitor_key
      and s.created_at > now() - interval '1 hour') then
    raise exception 'this visitor already answered this form in the last hour'
      using errcode = '23505';
  end if;

  -- Reject answers for fields the form does not define.
  if exists (
    select 1 from jsonb_object_keys(p_data) k
    where not exists (
      select 1 from jsonb_array_elements(v_form.fields) f where f ->> 'id' = k)) then
    raise exception 'unexpected answer key';
  end if;

  for v_field in select * from jsonb_array_elements(v_form.fields) loop
    continue when v_field ->> 'type' in ('section','divider','heading','spacer','rating_display');
    v_answer := coalesce(p_data ->> (v_field ->> 'id'), '');
    -- Compared as jsonb rather than cast, so one hand-edited row holding
    -- "required": "yes" cannot throw on every later submit.
    if coalesce(v_field -> 'required', 'false'::jsonb) = 'true'::jsonb
       and btrim(v_answer) = '' then
      v_missing := v_missing || (v_field ->> 'label');
    end if;
  end loop;

  if v_missing <> '{}' then
    raise exception 'missing required fields: %', array_to_string(v_missing, ', ');
  end if;

  insert into public.form_submissions
    (id, form_id, org_id, data, submitter_email, visitor_key, source_url, user_agent)
  values (gen_random_uuid(), p_form_id, v_form.org_id, p_data,
          nullif(btrim(coalesce(p_submitter_email, '')), ''),
          p_visitor_key, left(coalesce(p_source_url, ''), 500),
          left(coalesce(p_user_agent, ''), 300))
  returning id into v_sub_id;

  update public.forms set submission_count = submission_count + 1 where id = p_form_id;

  insert into public.activity_log (org_id, app_key, entity_type, entity_id, action, summary)
  values (v_form.org_id, 'forms', 'form_submission', v_sub_id::text, 'created',
          left(format('New response for "%s"', v_form.title), 500));

  return v_sub_id;
end;
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.forms           enable row level security;
alter table public.form_privates   enable row level security;
alter table public.form_submissions enable row level security;

create policy forms_select on public.forms
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'forms'));

create policy forms_write on public.forms
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'forms'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'forms'));

create policy form_privates_select on public.form_privates
  for select to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'forms'));

-- Admins configure notifications; the row itself is created by the trigger.
create policy form_privates_update on public.form_privates
  for update to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'forms'))
  with check (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'forms')
              and form_id = (select f.id from public.forms f where f.id = form_id and f.org_id = org_id));

create policy submissions_select on public.form_submissions
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'forms'));

-- Members triage responses; the answers themselves are frozen at write time by
-- youbiss.submission_immutable_fields(), which is a trigger rather than a policy
-- because a WITH CHECK that reads its own table sees an indeterminate version of
-- the row being written.
create policy submissions_update_state on public.form_submissions
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'forms'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'forms'));

create policy submissions_delete on public.form_submissions
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'forms'));

revoke all on public.forms, public.form_privates, public.form_submissions from anon, public;

-- A stored response is a record of what someone actually submitted. Only the
-- triage state may change after the fact.
create or replace function youbiss.submission_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if new.id           is distinct from old.id
     or new.form_id   is distinct from old.form_id
     or new.org_id    is distinct from old.org_id
     or new.data      is distinct from old.data
     or new.created_at is distinct from old.created_at
     or new.visitor_key is distinct from old.visitor_key
     or new.submitter_email is distinct from old.submitter_email then
    raise exception 'a stored response cannot be edited' using errcode = '42809';
  end if;
  return new;
end;
$$;

create trigger youbiss_submission_immutable
  before update on public.form_submissions
  for each row execute function youbiss.submission_immutable_fields();

-- record_form_submission is the public submit path and is called only by our
-- server routes. Exposing it to anon or authenticated would let a browser skip
-- the rate limiting and honeypot the route applies.
revoke all on function youbiss.record_form_submission(uuid, jsonb, text, text, text, text)
  from public, anon, authenticated;
grant execute on function youbiss.record_form_submission(uuid, jsonb, text, text, text, text)
  to service_role;

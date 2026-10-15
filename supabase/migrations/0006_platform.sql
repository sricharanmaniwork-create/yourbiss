-- ============================================================================
-- Yourbiss — 0006: platform services
--   * outgoing email: per-workspace SMTP / Resend config, templates, send log
--   * the SMTP password kept in a table with no client-readable policy at all
--   * rate limiting that works on serverless (no in-process memory to share)
--   * storage buckets + upload policies keyed to workspace membership
--   * custom-domain verification state
-- ============================================================================

create type public.email_provider as enum ('resend', 'smtp');
create type public.email_state    as enum ('queued', 'sent', 'failed', 'skipped');

-- ===========================================================================
-- Email configuration
--
-- `org_email_settings` is safe for an admin's browser. `org_email_passwords`
-- holds AES-256-GCM ciphertext produced in the server layer, and is deliberately
-- given NO policy: with RLS on and no policy, no client role can read it, while
-- service_role (which our server routes hold) reads it to build the transport.
-- ===========================================================================
create table public.org_email_settings (
  org_id       uuid primary key references public.orgs (id) on delete cascade,
  provider     public.email_provider not null default 'smtp',
  from_address citext not null,
  from_name    text not null default 'Yourbiss' check (char_length(from_name) between 1 and 80),
  reply_to     citext,
  smtp_host    text check (smtp_host is null or smtp_host ~ '^[a-zA-Z0-9\.\-]{1,253}$'),
  smtp_port    integer check (smtp_port is null or smtp_port between 1 and 65535),
  smtp_secure  text not null default 'starttls' check (smtp_secure in ('none','ssl','starttls')),
  smtp_user    text,
  verified_at  timestamptz,
  last_error   text,
  daily_quota  integer not null default 100 check (daily_quota between 1 and 100000),
  sent_today   integer not null default 0,
  sent_on      date not null default current_date,
  updated_at   timestamptz not null default now()
);

create table public.org_email_passwords (
  org_id     uuid primary key references public.orgs (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.org_email_settings enable row level security;
alter table public.org_email_passwords enable row level security;

-- Admins edit their own workspace's mail settings. The server-owned counters are
-- protected by youbiss.email_settings_guard_counters() rather than a policy
-- subquery on the same table, which would read an indeterminate version of the
-- row being written.
create policy email_settings_admin on public.org_email_settings
  for all to authenticated
  using (youbiss.is_org_admin(org_id))
  with check (youbiss.is_org_admin(org_id));

create policy email_settings_seed on public.org_email_settings
  for insert to authenticated
  with check (youbiss.is_org_admin(org_id));

-- org_email_passwords: intentionally no policy. Reading it requires service_role.
revoke all on public.org_email_settings  from anon, public;
revoke all on public.org_email_passwords from anon, public, authenticated;

create trigger youbiss_email_settings_touch before update on public.org_email_settings
  for each row execute function youbiss.touch_updated_at();

-- Counters are server-only; guard them against any client UPDATE as well, in
-- case a policy is ever relaxed.
create or replace function youbiss.email_settings_guard_counters()
returns trigger
language plpgsql
as $$
begin
  -- PostgREST runs the statement as the JWT's role, so current_user is the
  -- honest test for "this write came from a browser".
  if current_user::text not in ('service_role', 'postgres') then
    new.sent_today  := old.sent_today;
    new.sent_on     := old.sent_on;
    new.verified_at := old.verified_at;
    new.last_error  := old.last_error;
    new.provider    := old.provider;
  end if;
  return new;
end;
$$;

create trigger youbiss_email_settings_guard
  before update on public.org_email_settings
  for each row execute function youbiss.email_settings_guard_counters();

-- ===========================================================================
-- Templates. Row absence means "use the built-in default", which lives in the
-- app so a new workspace is never waiting on a seed script to send mail.
-- ===========================================================================
create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  key         text not null check (key in ('booking_confirmation','booking_reminder','booking_cancelled',
                                           'booking_rescheduled','team_new_booking','form_response',
                                           'invite_member','verify_email','reset_password','welcome')),
  subject     text not null check (char_length(subject) between 1 and 200),
  html_body   text not null check (char_length(html_body) between 1 and 60000),
  text_body   text check (text_body is null or char_length(text_body) <= 20000),
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  unique (org_id, key)
);

create table public.email_log (
  id          bigint generated always as identity primary key,
  org_id      uuid references public.orgs (id) on delete set null,
  template    text not null,
  to_address  citext not null,
  from_address citext,
  subject     text,
  provider    public.email_provider not null,
  state       public.email_state not null,
  provider_id text,
  error       text,
  related_type text,
  related_id   text,
  created_at  timestamptz not null default now()
);

create index email_log_org_time_idx on public.email_log (org_id, created_at desc);
create index email_log_failed_idx   on public.email_log (created_at desc) where state = 'failed';

alter table public.email_templates enable row level security;
alter table public.email_log       enable row level security;

create policy templates_admin on public.email_templates
  for all to authenticated
  using (youbiss.is_org_admin(org_id))
  with check (youbiss.is_org_admin(org_id));

create policy email_log_select on public.email_log
  for select to authenticated
  using (youbiss.is_org_admin(org_id));
-- No insert/update/delete policy: the send path writes with service_role, and a
-- delivery log a client can edit is not a log.

revoke all on public.email_templates, public.email_log from anon, public;

create trigger youbiss_email_templates_touch before update on public.email_templates
  for each row execute function youbiss.touch_updated_at();

-- ===========================================================================
-- Rate limiting
--
-- Serverless functions cannot share an in-process counter, and a burst of form
-- submits spread over five lambdas must still be one budget. The window is kept
-- in Postgres so the limit is real. Called only by service_role, from the routes.
-- ===========================================================================
create table public.rate_limits (
  bucket       text primary key check (char_length(bucket) between 1 and 200),
  count        integer not null default 0 check (count >= 0),
  window_start timestamptz not null default now(),
  expires_at   timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, public, authenticated;

create or replace function youbiss.rate_limit_consume(
  p_bucket text,
  p_max integer,
  p_window_sec integer
)
returns table (allowed boolean, remaining integer, retry_after_sec integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  -- A window that has simply elapsed is refreshed in place, so the bucket keeps
  -- its identity; `count` never resets to 0 because a new window starts at 1.
  with upsert as (
    insert into public.rate_limits as r (bucket, count, window_start, expires_at)
    values (p_bucket, 1, now(), now() + make_interval(secs => p_window_sec::double precision))
    on conflict (bucket) do update
    set count        = case when r.expires_at <= now() then 1 else r.count + 1 end,
        window_start = case when r.expires_at <= now() then now() else r.window_start end,
        expires_at   = case when r.expires_at <= now()
                            then now() + make_interval(secs => p_window_sec::double precision)
                            else r.expires_at end
    returning r.*
  )
  select u.count <= p_max,
         greatest(p_max - u.count, 0)::integer,
         greatest(ceil(extract(epoch from (u.expires_at - now()))), 0)::integer
  from upsert u;
$$;

-- The first call for a brand-new bucket creates the row and returns count = 1;
-- a bucket whose window has simply elapsed must not be re-created. Both paths
-- above are covered by the ON CONFLICT CASE.

create or replace function youbiss.rate_limits_prune()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.rate_limits where expires_at < now() - interval '1 hour'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

grant execute on function youbiss.rate_limit_consume(text, integer, integer) to service_role;
grant execute on function youbiss.rate_limits_prune() to service_role;
revoke all on function youbiss.rate_limit_consume(text, integer, integer) from public, anon, authenticated;
revoke all on function youbiss.rate_limits_prune() from public, anon, authenticated;

-- ===========================================================================
-- Custom domain verification
-- ===========================================================================
alter table public.sites
  add column if not exists verification_token text,
  add column if not exists domain_status text not null default 'unverified'
    check (domain_status in ('unverified', 'pending', 'verified', 'failed')),
  add column if not exists domain_checked_at timestamptz,
  add column if not exists domain_error text;

-- ===========================================================================
-- Storage
--
-- Layout is `<org_uuid>/<folder>/<file>`, so the first path segment decides who
-- may write. `uploads` is world-readable because a published site references it
-- directly; `private` is readable only by that workspace's members.
-- ===========================================================================
create or replace function youbiss.org_from_storage_path(p_path text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Returns null instead of throwing when the prefix is not a uuid, so a
  -- malformed key simply matches no policy rather than erroring every listing.
  select nullif(substring(p_path from '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'), '')::uuid;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads', 'uploads', true, 15728640,
   array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','application/pdf']),
  ('private', 'private', false, 31457280,
   array['image/png','image/jpeg','image/webp','application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "uploads_read" on storage.objects;
create policy "uploads_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'uploads');

drop policy if exists "uploads_write_own_org" on storage.objects;
create policy "uploads_write_own_org" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads'
              and youbiss.is_member(youbiss.org_from_storage_path((storage.foldername(name))[1])));

drop policy if exists "uploads_update_own_org" on storage.objects;
create policy "uploads_update_own_org" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads'
         and youbiss.is_org_admin(youbiss.org_from_storage_path((storage.foldername(name))[1])));

drop policy if exists "uploads_delete_own_org" on storage.objects;
create policy "uploads_delete_own_org" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads'
         and youbiss.is_org_admin(youbiss.org_from_storage_path((storage.foldername(name))[1])));

drop policy if exists "private_read_own_org" on storage.objects;
create policy "private_read_own_org" on storage.objects
  for select to authenticated
  using (bucket_id = 'private'
         and youbiss.is_member(youbiss.org_from_storage_path((storage.foldername(name))[1])));

drop policy if exists "private_write_own_org" on storage.objects;
create policy "private_write_own_org" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'private'
              and youbiss.is_member(youbiss.org_from_storage_path((storage.foldername(name))[1])));

drop policy if exists "private_delete_own_org" on storage.objects;
create policy "private_delete_own_org" on storage.objects
  for delete to authenticated
  using (bucket_id = 'private'
         and youbiss.is_org_admin(youbiss.org_from_storage_path((storage.foldername(name))[1])));

-- ===========================================================================
-- Rollup the workspace dashboard reads in one call.
-- ===========================================================================
create or replace function youbiss.org_dashboard_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not youbiss.is_member(p_org_id) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'sites', (select count(*) from public.sites s where s.org_id = p_org_id and s.status <> 'archived'),
    'published_pages', (select count(*) from public.site_pages p where p.org_id = p_org_id and p.status = 'published'),
    'forms', (select count(*) from public.forms f where f.org_id = p_org_id and f.status <> 'archived'),
    'form_responses', (select coalesce(sum(f.submission_count), 0)::int from public.forms f where f.org_id = p_org_id),
    'responses_last_7d', (select count(*) from public.form_submissions fs
                          where fs.org_id = p_org_id and fs.created_at > now() - interval '7 days'),
    'services', (select count(*) from public.booking_services v where v.org_id = p_org_id and v.status = 'active'),
    'staff', (select count(*) from public.booking_staff st where st.org_id = p_org_id and st.status = 'active'),
    'bookings_upcoming', (select count(*) from public.bookings b
                          where b.org_id = p_org_id and b.state in ('pending','confirmed')
                            and b.starts_at > now()),
    'bookings_30d', (select count(*) from public.bookings b
                     where b.org_id = p_org_id and b.created_at > now() - interval '30 days'),
    'members', (select count(*) from public.org_members m where m.org_id = p_org_id)
  ) into out;

  return out;
end;
$$;

grant execute on function youbiss.org_dashboard_counts(uuid) to authenticated;

-- Recent activity feed, bounded so a dashboard cannot ask for the moon.
create or replace function youbiss.org_recent_activity(p_org_id uuid, p_limit integer default 20)
returns setof public.activity_log
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.* from public.activity_log a
  where a.org_id = p_org_id
    and youbiss.is_member(p_org_id)
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

grant execute on function youbiss.org_recent_activity(uuid, integer) to authenticated;

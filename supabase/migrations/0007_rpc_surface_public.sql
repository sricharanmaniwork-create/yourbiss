-- ============================================================================
-- Yourbiss — 0007: the RPC surface PostgREST can actually reach
--
-- Supabase's API server only resolves functions in the schemas it exposes, and
-- on a hosted project that list is `public` (a custom schema needs a dashboard
-- setting most projects never touch). Every `supabase.rpc('name')` in this app
-- therefore looks for `public.name`, while the implementations live in the
-- `youbiss` schema alongside the triggers and policy helpers.
--
-- These are pass-through wrappers, nothing else. They are SECURITY INVOKER, so
-- the call still arrives at the inner function as the same database role it
-- would have been — and the inner functions are the ones carrying the checks:
-- `publish_site` re-reads membership, `restore_site_version` re-reads the admin
-- role, `org_dashboard_counts` raises for a non-member, and the booking and form
-- write functions stay service-role only. A wrapper cannot grant anything.
--
-- Grants mirror the inner function exactly. If a function is service_role-only
-- because the route in front of it does the rate limiting and the honeypot
-- check, its wrapper is service_role-only too.
-- ============================================================================

-- --- workspace --------------------------------------------------------------

create or replace function public.accept_invite(p_token uuid)
returns table (org_id uuid, org_slug text, member_role public.org_role)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.accept_invite(p_token);
$$;

create or replace function public.org_dashboard_counts(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.org_dashboard_counts(p_org_id);
$$;

create or replace function public.org_recent_activity(p_org_id uuid, p_limit integer default 20)
returns setof public.activity_log
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.org_recent_activity(p_org_id, p_limit);
$$;

-- --- websites ---------------------------------------------------------------

create or replace function public.publish_site(p_site_id uuid, p_note text default null)
returns table (version_number integer, pages_published integer)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.publish_site(p_site_id, p_note);
$$;

create or replace function public.restore_site_version(p_site_id uuid, p_number integer)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.restore_site_version(p_site_id, p_number);
$$;

-- --- bookings ---------------------------------------------------------------

create or replace function public.staff_for_service(p_service_id uuid)
returns table (id uuid, name text, slug text, bio text, avatar_url text,
               timezone text, sort_order integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.staff_for_service(p_service_id);
$$;

create or replace function public.working_windows(p_staff_id uuid, p_day date)
returns table (opens_at timestamp, closes_at timestamp)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.working_windows(p_staff_id, p_day);
$$;

create or replace function public.slot_conflict(
  p_service_id uuid,
  p_staff_id   uuid,
  p_starts_at  timestamptz,
  p_tz         text default null
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.slot_conflict(p_service_id, p_staff_id, p_starts_at, p_tz);
$$;

create or replace function public.available_slots(
  p_service_id uuid,
  p_staff_id   uuid,
  p_day        date,
  p_tz         text default null
)
returns table (starts_at timestamptz, ends_at timestamptz, state text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.available_slots(p_service_id, p_staff_id, p_day, p_tz);
$$;

create or replace function public.bookable_days(
  p_service_id uuid,
  p_staff_id   uuid,
  p_from       date default null,
  p_days       integer default 28
)
returns table (day date, closed boolean, has_free_slot boolean)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.bookable_days(p_service_id, p_staff_id, p_from, p_days);
$$;

create or replace function public.create_booking(
  p_service_id     uuid,
  p_staff_id       uuid,
  p_starts_at      timestamptz,
  p_customer_name  text,
  p_customer_email text,
  p_customer_phone text default null,
  p_notes          text default null,
  p_source         public.booking_source default 'web',
  p_tz             text default null
)
returns public.bookings
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.create_booking(
    p_service_id, p_staff_id, p_starts_at, p_customer_name, p_customer_email,
    p_customer_phone, p_notes, p_source, p_tz
  );
$$;

create or replace function public.cancel_booking(
  p_code text,
  p_email text,
  p_reason text default null
)
returns public.bookings
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.cancel_booking(p_code, p_email, p_reason);
$$;

create or replace function public.reschedule_booking(
  p_code text,
  p_email text,
  p_starts_at timestamptz,
  p_tz text default null
)
returns public.bookings
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.reschedule_booking(p_code, p_email, p_starts_at, p_tz);
$$;

-- --- platform ---------------------------------------------------------------

create or replace function public.rate_limit_consume(
  p_bucket text,
  p_max integer,
  p_window_sec integer
)
returns table (allowed boolean, remaining integer, retry_after_sec integer)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.rate_limit_consume(p_bucket, p_max, p_window_sec);
$$;

create or replace function public.rate_limits_prune()
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.rate_limits_prune();
$$;

create or replace function public.record_form_submission(
  p_form_id         uuid,
  p_data            jsonb,
  p_submitter_email text,
  p_visitor_key     text,
  p_source_url      text,
  p_user_agent      text
)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.record_form_submission(
    p_form_id, p_data, p_submitter_email, p_visitor_key, p_source_url, p_user_agent
  );
$$;

-- --- grants, one for one with the inner function ----------------------------

revoke all on function public.accept_invite(uuid) from public;
revoke all on function public.org_dashboard_counts(uuid) from public;
revoke all on function public.org_recent_activity(uuid, integer) from public;
revoke all on function public.publish_site(uuid, text) from public;
revoke all on function public.restore_site_version(uuid, integer) from public;
revoke all on function public.staff_for_service(uuid) from public;
revoke all on function public.working_windows(uuid, date) from public;
revoke all on function public.slot_conflict(uuid, uuid, timestamptz, text) from public;
revoke all on function public.available_slots(uuid, uuid, date, text) from public;
revoke all on function public.bookable_days(uuid, uuid, date, integer) from public;
revoke all on function public.create_booking(uuid, uuid, timestamptz, text, text, text, text, public.booking_source, text) from public;
revoke all on function public.cancel_booking(text, text, text) from public;
revoke all on function public.reschedule_booking(text, text, timestamptz, text) from public;
revoke all on function public.rate_limit_consume(text, integer, integer) from public;
revoke all on function public.rate_limits_prune() from public;
revoke all on function public.record_form_submission(uuid, jsonb, text, text, text, text) from public;

grant execute on function public.accept_invite(uuid) to authenticated;

grant execute on function public.org_dashboard_counts(uuid) to authenticated;
grant execute on function public.org_recent_activity(uuid, integer) to authenticated;

grant execute on function public.publish_site(uuid, text) to authenticated;
grant execute on function public.restore_site_version(uuid, integer) to authenticated;

grant execute on function public.staff_for_service(uuid) to authenticated, service_role;
grant execute on function public.working_windows(uuid, date) to authenticated, service_role;
grant execute on function public.slot_conflict(uuid, uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.available_slots(uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.bookable_days(uuid, uuid, date, integer) to authenticated, service_role;

grant execute on function public.create_booking(uuid, uuid, timestamptz, text, text, text, text, public.booking_source, text)
  to service_role;
grant execute on function public.cancel_booking(text, text, text) to service_role;
grant execute on function public.reschedule_booking(text, text, timestamptz, text) to service_role;

grant execute on function public.rate_limit_consume(text, integer, integer) to service_role;
grant execute on function public.rate_limits_prune() to service_role;

-- Called only by our own server routes, exactly like the inner function: the
-- route adds the honeypot, the captcha-free throttle and the origin check.
grant execute on function public.record_form_submission(uuid, jsonb, text, text, text, text) to service_role;

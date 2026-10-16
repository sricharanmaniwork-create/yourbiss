-- 0008 — privileges for the API roles
-- ===========================================================================
-- Why this file exists
--
-- Supabase's automatic grants are attached only to objects created by its own
-- bootstrap role. Every table in this project was created by a migration, so no
-- API role ever received a privilege on it — and Postgres checks the table
-- privilege *before* it consults RLS. The result is 60 correct policies guarding
-- tables nobody can open:
--
--   42501  permission denied for table orgs
--   hint   Grant the required privileges to the current role with:
--          GRANT SELECT ON public.orgs TO authenticated
--
-- That is the whole of the "Yourbiss could not start" screen: the first read a
-- signed-in visitor performs is the workspace list, and it was refused.
--
-- What this file does
--
--   * authenticated — exactly the commands its own policies allow, per table.
--     A table privilege is only a door; RLS still decides which rows and which
--     commands. Granting SELECT where a policy exists for SELECT changes nothing
--     about what a member can reach, it only stops Postgres refusing the query
--     before RLS is read.
--   * service_role, postgres — everything. The server-only client is used for
--     published-page reads, mail logging and every write that must survive RLS.
--   * anon, PUBLIC — explicitly nothing. Revoking makes "anonymous gets no rows"
--     a fact about privileges instead of a hope about policies, and it is what
--     src/lib/site/published.ts documents when it filters by hand.
--
-- Two tables stay out of the member list on purpose: org_email_passwords (an
-- encrypted secret with no read policy at all) and rate_limits (a counter only
-- the server may move). Both were revoked from authenticated in 0006 and are
-- granted here to service_role only.
--
-- Any future migration that creates a table must grant on it here or in that
-- file. A table with policies and no privilege looks identical to a broken
-- policy, and is far more annoying to find.
-- ===========================================================================

-- --- baseline: the public has no table access, whatever the defaults said ---
revoke all on public.orgs, public.org_members, public.org_invites,
              public.org_apps, public.user_profiles, public.activity_log,
              public.sites, public.site_pages, public.site_versions,
              public.forms, public.form_privates, public.form_submissions,
              public.booking_services, public.booking_staff, public.booking_staff_services,
              public.booking_staff_contacts, public.booking_availability, public.booking_breaks,
              public.booking_closed_days, public.booking_exceptions, public.bookings,
              public.booking_notifications, public.org_email_settings, public.org_email_passwords,
              public.email_templates, public.email_log, public.rate_limits
  from anon, public;

-- --- tenancy core ----------------------------------------------------------
grant select, update, delete              on public.orgs         to authenticated;
grant select, update, delete              on public.org_members  to authenticated;
grant select, insert, delete              on public.org_invites  to authenticated;
grant select, update                      on public.org_apps     to authenticated;
grant select, update                      on public.user_profiles to authenticated;
grant select, insert                      on public.activity_log to authenticated;

-- --- websites --------------------------------------------------------------
grant select, insert, update, delete      on public.sites        to authenticated;
grant select, insert, update, delete      on public.site_pages   to authenticated;
grant select, delete                      on public.site_versions to authenticated;

-- --- forms -----------------------------------------------------------------
grant select, insert, update, delete      on public.forms        to authenticated;
grant select, update                      on public.form_privates to authenticated;
grant select, update, delete              on public.form_submissions to authenticated;

-- --- bookings --------------------------------------------------------------
grant select, insert, update, delete      on public.booking_services       to authenticated;
grant select, insert, update, delete      on public.booking_staff          to authenticated;
grant select, insert, update, delete      on public.booking_staff_services to authenticated;
grant select, insert, update, delete      on public.booking_staff_contacts to authenticated;
grant select, insert, update, delete      on public.booking_availability   to authenticated;
grant select, insert, update, delete      on public.booking_breaks         to authenticated;
grant select, insert, update, delete      on public.booking_closed_days    to authenticated;
grant select, insert, update, delete      on public.booking_exceptions     to authenticated;
grant select, update, delete              on public.bookings               to authenticated;
grant select, update                      on public.booking_notifications to authenticated;

-- --- platform: mail --------------------------------------------------------
grant select, insert, update, delete      on public.org_email_settings to authenticated;
grant select, insert, update, delete      on public.email_templates    to authenticated;
-- read only: a member may review what was sent, never rewrite or add a row.
-- Writes belong to src/lib/mail/index.ts, which runs as service_role.
grant select                              on public.email_log          to authenticated;

-- --- the server-only client ------------------------------------------------
grant all on public.orgs, public.org_members, public.org_invites,
                public.org_apps, public.user_profiles, public.activity_log,
                public.sites, public.site_pages, public.site_versions,
                public.forms, public.form_privates, public.form_submissions,
                public.booking_services, public.booking_staff, public.booking_staff_services,
                public.booking_staff_contacts, public.booking_availability, public.booking_breaks,
                public.booking_closed_days, public.booking_exceptions, public.bookings,
                public.booking_notifications, public.org_email_settings, public.org_email_passwords,
                public.email_templates, public.email_log, public.rate_limits
  to service_role, postgres;

-- --- identity columns ------------------------------------------------------
-- activity_log and email_log are `generated always as identity`, so an insert
-- also needs the sequence. The name is looked up rather than written down, so
-- this cannot drift if Postgres ever numbers them differently.
do $$
declare
  tbl text;
  seq text;
begin
  foreach tbl in array array['activity_log', 'email_log'] loop
    seq := pg_get_serial_sequence('public.' || tbl, 'id');
    if seq is null then
      raise exception 'public.% has no identity sequence', tbl;
    end if;
    execute format('grant usage, select on sequence %s to authenticated', seq);
    execute format('grant all on sequence %s to service_role, postgres', seq);
  end loop;
end
$$;

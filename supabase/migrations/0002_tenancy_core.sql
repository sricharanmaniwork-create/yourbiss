-- ============================================================================
-- Yourbiss — 0002: tenancy core (orgs, members, invites, apps, profiles,
-- activity log) + RLS helpers + policies + new-user onboarding.
--
-- Deliberate design:
--   * every business table carries org_id, so a policy is one membership test
--   * `anon` has zero table privileges — public pages are rendered by Next.js
--     server routes holding a service-role client, never by PostgREST
--   * INSERT on orgs / org_members is not exposed to end users at all; those
--     writes belong to the onboarding trigger and to server routes that
--     validate the request first. This removes the bootstrap problem where a
--     policy needs the membership row that the policy is meant to create.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'member');
create type public.app_key as enum (
  'website', 'forms', 'bookings', 'crm', 'inventory', 'store', 'automations', 'board'
);
create type public.app_status as enum ('enabled', 'disabled');
create type public.org_status as enum ('active', 'suspended', 'archived');

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  slug       citext not null unique check (not youbiss.is_reserved_slug(slug)),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  status     public.org_status not null default 'active',
  -- Timezone ids are validated by the app against Intl.supportedValuesOf, and
  -- by slot maths against pg_timezone_names at query time. A CHECK with a
  -- subquery is not legal Postgres, so it is intentionally not a constraint.
  timezone   text not null default 'Asia/Kolkata' check (timezone ~ '^[A-Za-z_/]{1,64}$'),
  currency   char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  locale     text not null default 'en-IN' check (locale ~ '^[a-z]{2}(-[A-Z]{2}){0,1}$'),
  logo_url   text check (logo_url is null or logo_url ~ '^https?://'),
  plan_key   text not null default 'free' check (plan_key ~ '^[a-z0-9_]{1,40}$'),
  settings   jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(settings)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.org_members (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.org_role not null default 'member',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Invites are addressed by email so a person can be granted membership before
-- they have an auth.users row.
create table public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  email       citext not null,
  role        public.org_role not null default 'member' check (role <> 'owner'),
  token       uuid not null unique default gen_random_uuid(),
  invited_by  uuid not null references auth.users (id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);

create table public.org_apps (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  app_key    public.app_key not null,
  status     public.app_status not null default 'enabled',
  settings   jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(settings)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, app_key)
);

-- We own this copy of the display fields, so nothing here ever writes to
-- auth.* from the client.
create table public.user_profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  email        citext not null,
  job_title    text check (job_title is null or char_length(job_title) <= 80),
  phone        text check (phone is null or phone ~ '^[+0-9 ()\-]{0,32}$'),
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https?://'),
  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Shared audit trail. Every module writes here, which is what later gives the
-- CRM a real activity timeline rather than a per-module invention.
create table public.activity_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.orgs (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  app_key     public.app_key,
  entity_type text not null check (entity_type ~ '^[a-z_]{1,40}$'),
  entity_id   text check (entity_id is null or char_length(entity_id) <= 64),
  action      text not null check (action ~ '^[a-z_.]{1,60}$'),
  summary     text check (summary is null or char_length(summary) <= 500),
  meta        jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(meta)),
  created_at  timestamptz not null default now()
);

create index org_members_user_idx      on public.org_members (user_id);
create index org_invites_token_idx     on public.org_invites (token);
create index activity_log_org_time_idx on public.activity_log (org_id, created_at desc);
create index activity_log_entity_idx   on public.activity_log (org_id, entity_type, entity_id);

-- ===========================================================================
-- RLS helpers.
--
-- SECURITY DEFINER because a policy on org_members must read org_members
-- without recursing into its own policy. search_path is pinned so resolution
-- cannot be hijacked.
-- ===========================================================================

create or replace function youbiss.is_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_org_id is not null and exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;

create or replace function youbiss.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_org_id is not null and exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function youbiss.is_org_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_org_id is not null and exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Policies on orgs itself cannot call is_member (that would read orgs), so they
-- test membership through this set-returning function over org_members.
create or replace function youbiss.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.org_id from public.org_members m where m.user_id = auth.uid()
$$;

create or replace function youbiss.my_org_role(p_org_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role from public.org_members m
  where m.org_id = p_org_id and m.user_id = auth.uid()
$$;

create or replace function youbiss.app_enabled(p_org_id uuid, p_app public.app_key)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_apps a
    where a.org_id = p_org_id and a.app_key = p_app and a.status = 'enabled'
  );
$$;

-- ===========================================================================
-- accept_invite: turns a token into membership. SECURITY DEFINER because the
-- caller is not yet a member of the org they are joining.
-- ===========================================================================
create or replace function youbiss.accept_invite(p_token uuid)
returns table (org_id uuid, org_slug text, member_role public.org_role)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.org_invites;
  v_email  citext;
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_invite from public.org_invites i where i.token = p_token;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'this invite has already been used';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'this invite has expired';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_invite.email then
    raise exception 'this invite was issued to a different address';
  end if;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, v_uid, v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do update
    set role = excluded.role, invited_by = excluded.invited_by;

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  return query
    select v_invite.org_id, o.slug::text, v_invite.role
    from public.orgs o where o.id = v_invite.org_id;
end;
$$;

grant execute on function youbiss.accept_invite(uuid) to authenticated;

-- ===========================================================================
-- Onboarding trigger.
--
-- Seeds profile + personal workspace + all apps. The starter site/page is added
-- by the 0003 version of this same function, because public.sites does not
-- exist yet in this migration.
-- ===========================================================================
create or replace function youbiss.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := new.id;
  v_display  text;
  v_org_id   uuid;
  v_slug     text;
begin
  v_display := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'member'), '@', 1));
  v_display := left(v_display, 80);

  insert into public.user_profiles (user_id, display_name, email)
  values (v_uid, v_display, new.email)
  on conflict (user_id) do nothing;

  v_slug := left(regexp_replace(lower(v_display), '[^a-z0-9]', '', 'g'), 20);
  if v_slug = '' then v_slug := 'workspace'; end if;
  v_slug := left(v_slug, 20) || '-' || left(replace(v_uid::text, '-', ''), 8);

  v_org_id := gen_random_uuid();
  insert into public.orgs (id, name, slug, owner_id)
  values (v_org_id, left(v_display || '''s workspace', 80), v_slug, v_uid);

  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_uid, 'owner');

  insert into public.org_apps (org_id, app_key, status)
  select v_org_id, a, 'enabled'
  from unnest(enum_range(null::public.app_key)) as a;

  update public.user_profiles
  set onboarded_at = now()
  where user_id = v_uid;

  return new;
end;
$$;

drop trigger if exists youbiss_on_auth_user_created on auth.users;
create trigger youbiss_on_auth_user_created
  after insert on auth.users
  for each row execute function youbiss.handle_new_user();

create trigger youbiss_orgs_touch     before update on public.orgs
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_org_apps_touch before update on public.org_apps
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_profiles_touch before update on public.user_profiles
  for each row execute function youbiss.touch_updated_at();

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table public.orgs          enable row level security;
alter table public.org_members   enable row level security;
alter table public.org_invites   enable row level security;
alter table public.org_apps      enable row level security;
alter table public.user_profiles enable row level security;
alter table public.activity_log  enable row level security;

-- orgs ---------------------------------------------------------------------
create policy orgs_select on public.orgs
  for select to authenticated
  using (id in (select youbiss.my_org_ids()));

-- Admins may edit their workspace, but may not move ownership through a plain
-- update — that is a dedicated server flow.
create policy orgs_update on public.orgs
  for update to authenticated
  using (youbiss.is_org_admin(id))
  with check (youbiss.is_org_admin(id)
              and owner_id = (select o.owner_id from public.orgs o where o.id = id));

-- Deleting a workspace is only possible after it has been archived, so an
-- accidental delete call on a live org is rejected by policy.
create policy orgs_delete on public.orgs
  for delete to authenticated
  using (youbiss.is_org_owner(id) and status = 'archived');

-- org_members --------------------------------------------------------------
create policy members_select on public.org_members
  for select to authenticated
  using (youbiss.is_member(org_id));

create policy members_admin_update on public.org_members
  for update to authenticated
  using (youbiss.is_org_admin(org_id) and role <> 'owner')
  with check (youbiss.is_org_admin(org_id) and role <> 'owner');

create policy members_admin_remove on public.org_members
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and role <> 'owner');

-- Anyone but the owner may walk away from a workspace.
create policy members_self_leave on public.org_members
  for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');

-- org_invites --------------------------------------------------------------
-- Admins manage invites. `with check` keeps a pending invite pending: the
-- accepted_at stamp is written by accept_invite, not by a client.
create policy invites_admin_select on public.org_invites
  for select to authenticated
  using (youbiss.is_org_admin(org_id));

create policy invites_admin_insert on public.org_invites
  for insert to authenticated
  with check (youbiss.is_org_admin(org_id)
              and role <> 'owner'
              and accepted_at is null
              and invited_by = auth.uid());

create policy invites_admin_delete on public.org_invites
  for delete to authenticated
  using (youbiss.is_org_admin(org_id));

-- org_apps -----------------------------------------------------------------
create policy apps_select on public.org_apps
  for select to authenticated
  using (youbiss.is_member(org_id));

create policy apps_admin_update on public.org_apps
  for update to authenticated
  using (youbiss.is_org_admin(org_id))
  with check (youbiss.is_org_admin(org_id));

-- user_profiles ------------------------------------------------------------
-- Readable for anyone who shares a workspace with you, or for yourself.
create policy profiles_select on public.user_profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or user_id in (
      select m.user_id from public.org_members m
      where m.org_id in (select youbiss.my_org_ids())
    )
  );

-- You own your own profile; email is server-managed because it mirrors auth.
create policy profiles_update on public.user_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and email = (select p.email from public.user_profiles p where p.user_id = auth.uid()));

-- activity_log -------------------------------------------------------------
create policy activity_select on public.activity_log
  for select to authenticated
  using (youbiss.is_member(org_id));

create policy activity_insert on public.activity_log
  for insert to authenticated
  with check (youbiss.is_member(org_id) and actor_id = auth.uid());

-- ===========================================================================
-- Privileges: authenticated keeps what it needs, anon and PUBLIC lose
-- everything on these tables.
-- ===========================================================================
revoke all on public.orgs, public.org_members, public.org_invites,
              public.org_apps, public.user_profiles, public.activity_log
  from anon, public;

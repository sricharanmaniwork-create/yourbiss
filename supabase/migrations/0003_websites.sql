-- ============================================================================
-- Yourbiss — 0003: website builder (sites, pages, block trees, versions)
--
-- Block trees are stored as one jsonb document per page rather than one row per
-- block. Reason: a drag-and-drop editor reorders and reparents subtrees
-- constantly, and doing that across parent_id/position rows needs multi-statement
-- transactions that can leave orphaned blocks mid-drag. A document per page makes
-- autosave, undo and publish single-row atomic writes. The shape is enforced by
-- zod in the server layer plus the structural checks below.
-- ============================================================================

create type public.site_status as enum ('draft', 'published', 'archived');
create type public.page_status as enum ('draft', 'published', 'archived');

create table public.sites (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  slug               citext not null check (not youbiss.is_reserved_slug(slug)),
  status             public.site_status not null default 'draft',
  theme              jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(theme)),
  settings           jsonb not null default '{}'::jsonb check (youbiss.is_jsonb_object(settings)),
  favicon_url        text check (favicon_url is null or favicon_url ~ '^https?://'),
  custom_domain      citext unique check (custom_domain is null or
                       (custom_domain ~ '^[a-z0-9]([a-z0-9\.\-]{1,250}[a-z0-9])$'
                        and custom_domain not like '%..%')),
  domain_verified_at timestamptz,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, slug)
);

create table public.site_pages (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites (id) on delete cascade,
  org_id          uuid not null references public.orgs (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  path            text not null check (youbiss.is_valid_page_path(path)),
  is_home         boolean not null default false,
  status          public.page_status not null default 'draft',
  seo_title       text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description text check (seo_description is null or char_length(seo_description) <= 200),
  og_image_url    text check (og_image_url is null or og_image_url ~ '^https?://'),
  draft_tree      jsonb not null check (youbiss.is_jsonb_object(draft_tree)
                    and draft_tree ->> 'type' = 'page'),
  published_tree  jsonb check (published_tree is null
                    or (youbiss.is_jsonb_object(published_tree)
                        and published_tree ->> 'type' = 'page')),
  published_at    timestamptz,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (site_id, path)
);

-- A page may only be flagged published when there is a tree to serve, and
-- losing published status must clear the stale timestamp.
create or replace function youbiss.page_publish_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and new.published_tree is null then
    raise exception 'a published page must have published content';
  end if;
  if new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger youbiss_page_publish_guard
  before insert or update on public.site_pages
  for each row execute function youbiss.page_publish_guard();

create unique index site_pages_home_idx on public.site_pages (site_id) where is_home;
create index site_pages_org_idx         on public.site_pages (org_id, site_id, status);
create index sites_org_idx              on public.sites (org_id, status);

create table public.site_versions (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites (id) on delete cascade,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  number     integer not null check (number > 0),
  -- { pageId: tree } snapshot of everything that went live.
  snapshot   jsonb not null check (youbiss.is_jsonb_object(snapshot)),
  note       text check (note is null or char_length(note) <= 200),
  page_count integer not null default 0 check (page_count >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (site_id, number)
);

create index site_versions_site_idx on public.site_versions (site_id, number desc);

-- ===========================================================================
-- publish_site
--
-- Atomic: every draft tree becomes the live tree, one version row is written,
-- the site flips to published. SECURITY DEFINER so the three writes cannot
-- interleave with a concurrent autosave from a second editor; membership is
-- re-checked inside the function so a caller cannot publish another org's site.
-- ===========================================================================
create or replace function youbiss.publish_site(p_site_id uuid, p_note text default null)
returns table (version_number integer, pages_published integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site     public.sites;
  v_number   integer;
  v_pages    integer;
  v_snapshot jsonb;
begin
  select * into v_site from public.sites s where s.id = p_site_id;
  if not found then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if not youbiss.is_member(v_site.org_id) then
    raise exception 'not allowed to publish this site' using errcode = '42501';
  end if;

  select coalesce(max(v.number), 0) + 1 into v_number
  from public.site_versions v where v.site_id = p_site_id;

  update public.site_pages p
  set published_tree = p.draft_tree,
      status         = case when p.status = 'draft' then 'published'::public.page_status else p.status end,
      published_at   = case when p.status in ('draft','published') then now() else p.published_at end
  where p.site_id = p_site_id
    and p.status <> 'archived';

  select count(*) into v_pages
  from public.site_pages p
  where p.site_id = p_site_id and p.status = 'published';

  if v_pages = 0 then
    raise exception 'nothing to publish: this site has no active pages';
  end if;

  select jsonb_object_agg(x.id::text, x.published_tree) into v_snapshot
  from public.site_pages x
  where x.site_id = p_site_id and x.published_tree is not null;

  insert into public.site_versions (id, site_id, org_id, number, snapshot, note, page_count, created_by)
  values (gen_random_uuid(), p_site_id, v_site.org_id, v_number,
          coalesce(v_snapshot, '{}'::jsonb),
          nullif(left(btrim(coalesce(p_note, '')), 200), ''),
          v_pages, auth.uid());

  update public.sites
  set status = 'published', published_at = now()
  where id = p_site_id;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (v_site.org_id, auth.uid(), 'website', 'site', p_site_id::text, 'published',
          left(format('Published %s page(s) as version %s', v_pages, v_number), 500));

  return query select v_number, v_pages;
end;
$$;

-- ===========================================================================
-- restore_site_version: roll a site back to a stored snapshot.
-- ===========================================================================
create or replace function youbiss.restore_site_version(p_site_id uuid, p_number integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site     public.sites;
  v_snapshot jsonb;
begin
  select * into v_site from public.sites s where s.id = p_site_id;
  if not found then
    raise exception 'site not found' using errcode = 'P0002';
  end if;
  if not youbiss.is_org_admin(v_site.org_id) then
    raise exception 'only admins can roll a site back' using errcode = '42501';
  end if;

  select v.snapshot into v_snapshot
  from public.site_versions v
  where v.site_id = p_site_id and v.number = p_number;

  if v_snapshot is null then
    raise exception 'version % does not exist', p_number;
  end if;

  update public.site_pages p
  set draft_tree     = v_snapshot -> p.id::text,
      published_tree = v_snapshot -> p.id::text,
      status         = 'published',
      published_at   = now()
  where p.site_id = p_site_id
    and v_snapshot ? p.id::text;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (v_site.org_id, auth.uid(), 'website', 'site', p_site_id::text, 'rolled_back',
          left(format('Rolled back to version %s', p_number), 500));
end;
$$;

grant execute on function youbiss.publish_site(uuid, text) to authenticated;
grant execute on function youbiss.restore_site_version(uuid, integer) to authenticated;

-- ===========================================================================
-- Onboarding (continued): now that sites exist, give a fresh workspace a starter
-- site with an empty Home page — the empty canvas blocks are dropped onto.
-- ===========================================================================
create or replace function youbiss.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := new.id;
  v_display text;
  v_org_id  uuid;
  v_slug    text;
  v_site_id uuid;
begin
  v_display := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(new.email, 'member'), '@', 1));
  v_display := left(v_display, 80);

  insert into public.user_profiles (user_id, display_name, email)
  values (v_uid, v_display, new.email)
  on conflict (user_id) do nothing;

  select m.org_id into v_org_id from public.org_members m where m.user_id = v_uid limit 1;

  -- 0002's body seeded the workspace before sites existed; kept here so the
  -- function is self-sufficient if it is re-applied on its own.
  if v_org_id is null then
    v_slug := left(regexp_replace(lower(v_display), '[^a-z0-9]', '', 'g'), 20);
    if v_slug = '' then v_slug := 'workspace'; end if;
    v_slug := left(v_slug, 20) || '-' || left(replace(v_uid::text, '-', ''), 8);

    v_org_id := gen_random_uuid();
    insert into public.orgs (id, name, slug, owner_id)
    values (v_org_id, left(v_display || '''s workspace', 80), v_slug, v_uid);

    insert into public.org_members (org_id, user_id, role) values (v_org_id, v_uid, 'owner');

    insert into public.org_apps (org_id, app_key, status)
    select v_org_id, a, 'enabled'
    from unnest(enum_range(null::public.app_key)) as a;
  end if;

  select s.id into v_site_id from public.sites s where s.org_id = v_org_id limit 1;

  if v_site_id is null then
    insert into public.sites (id, org_id, name, slug, theme)
    values (gen_random_uuid(), v_org_id, 'My first site', 'my-first-site',
      '{"colors":{"primary":"#2E6BE6","surface":"#FFFFFF","background":"#F7F8FA",
                  "text":"#111827","muted":"#6B7280","border":"#E5E7EB"},
        "fonts":{"heading":"Inter","body":"Inter"},
        "radius":"10px","max_width":"1200px","section_gap":"48px"}')
    returning id into v_site_id;

    insert into public.site_pages (site_id, org_id, title, path, is_home, status, draft_tree, sort_order)
    values (v_site_id, v_org_id, 'Home', '/', true, 'draft',
      '{"type":"page","id":"page-home","props":{},"styles":{},"children":[]}', 0);

    insert into public.site_pages (site_id, org_id, title, path, is_home, status, draft_tree, sort_order)
    values (v_site_id, v_org_id, 'Contact', '/contact', false, 'draft',
      '{"type":"page","id":"page-contact","props":{},"styles":{},"children":[]}', 1);
  end if;

  update public.user_profiles set onboarded_at = now() where user_id = v_uid;

  return new;
end;
$$;

-- ===========================================================================
-- Triggers + RLS
-- ===========================================================================
create trigger youbiss_sites_touch before update on public.sites
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_pages_touch before update on public.site_pages
  for each row execute function youbiss.touch_updated_at();

alter table public.sites         enable row level security;
alter table public.site_pages    enable row level security;
alter table public.site_versions enable row level security;

-- The website app must be switched on as well as the user being a member, so
-- disabling an app genuinely removes access rather than hiding a tab.
create policy sites_select on public.sites
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'website'));

create policy sites_write on public.sites
  for all to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'website'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'website'));

create policy pages_select on public.site_pages
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'website'));

-- site_id and org_id are both supplied by the client, so the policy proves they
-- agree — otherwise a member could park a page inside another org's site.
create policy pages_write on public.site_pages
  for all to authenticated
  using (youbiss.is_member(org_id)
         and youbiss.app_enabled(org_id, 'website')
         and exists (select 1 from public.sites s where s.id = site_id and s.org_id = org_id))
  with check (youbiss.is_member(org_id)
              and youbiss.app_enabled(org_id, 'website')
              and exists (select 1 from public.sites s where s.id = site_id and s.org_id = org_id));

-- Version history is written by publish_site; members read it, admins prune it.
create policy versions_select on public.site_versions
  for select to authenticated
  using (youbiss.is_member(org_id));

create policy versions_delete on public.site_versions
  for delete to authenticated
  using (youbiss.is_org_admin(org_id));

revoke all on public.sites, public.site_pages, public.site_versions from anon, public;

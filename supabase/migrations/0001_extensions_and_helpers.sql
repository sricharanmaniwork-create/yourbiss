-- ============================================================================
-- Yourbiss — 0001: extensions and table-independent helpers
-- Apply in the Supabase SQL editor as a single transaction, in order.
--
-- Tenancy helper functions live in 0002, after the tables they read, so that
-- their bodies are validated eagerly at creation time.
-- ============================================================================

create schema if not exists youbiss;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Timestamp maintenance
-- ---------------------------------------------------------------------------
create or replace function youbiss.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Slug protection. These namespaces must never collide with platform routes,
-- and custom domains must not be hijackable.
-- ---------------------------------------------------------------------------
create or replace function youbiss.is_reserved_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_slug is null
     or p_slug !~ '^[a-z0-9]([a-z0-9\-]{0,58}[a-z0-9])?$'
     or lower(p_slug) in (
        'api','app','admin','auth','login','signup','signin','signout','logout','dashboard',
        'assets','static','public','cdn','docs','help','support','status','mail','www',
        'site','sites','form','forms','book','booking','bookings','embed','settings',
        'invite','invites','onboarding','favicon.ico','robots.txt','sitemap.xml',
        'favicon','_next','node_modules','preview','editor','account','billing','team'
     );
$$;

-- A page slug may not start with a dot or contain characters that break URLs.
create or replace function youbiss.is_valid_page_path(p_path text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_path ~ '^/[a-z0-9]([a-z0-9\-/]{0,94}[a-z0-9]|[a-z0-9\-]{0,94})$'
     or p_path = '/';
$$;

-- ---------------------------------------------------------------------------
-- JSON tree guard. Builder trees, form definitions and themes are stored as
-- jsonb; this keeps nulls and non-objects out of columns the app assumes are
-- objects, without re-implementing the whole schema in SQL.
-- ---------------------------------------------------------------------------
create or replace function youbiss.is_jsonb_object(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select p_value is not null and jsonb_typeof(p_value) = 'object';
$$;

create or replace function youbiss.is_jsonb_array(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select p_value is not null and jsonb_typeof(p_value) = 'array';
$$;

grant usage on schema youbiss to postgres, authenticated, anon, service_role;
grant execute on all functions in schema youbiss to postgres, authenticated, anon, service_role;
alter default privileges in schema youbiss
  grant execute on functions to postgres, authenticated, anon, service_role;

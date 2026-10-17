-- ============================================================================
-- Yourbiss — read-only diagnosis of the Inventory and Store screens
--
-- Nothing here writes. Paste it into Supabase → SQL editor → New query → Run and
-- send back the four result panes, in order.
--
-- WHY IT ASKS FOR THE TWO UUIDS
-- The screens call `inv_counts` and `inv_stock_map`, and both re-check who is
-- calling through `auth.uid()`, which is empty in the SQL editor. Setting the JWT
-- claims for one transaction is what lets the editor make exactly the call the
-- screen makes — and if the screen's failure is a database error, its real message
-- appears here instead of hiding behind React's minified "error #441".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Which app tables exist, whether RLS is on, and what the API roles may do
-- ---------------------------------------------------------------------------
-- `rls = false` or `api_select` empty on a table the app reads is the answer to a
-- screen that throws: RLS is never consulted before the table privilege, so a
-- missing grant fails as permission denied rather than as an empty list.
select
  c.relname as table_name,
  c.relrowsecurity as rls,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
  (select string_agg(distinct g.privilege_type, ',')
     from information_schema.role_table_grants g
    where g.table_name = c.relname and g.grantee = 'authenticated') as api_privileges
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname ~ '^(crm_|inv_|store_|doc_counters)'
order by 1;

-- ---------------------------------------------------------------------------
-- 2 · The RPC surface: the functions in `public` that the screens call by name
-- ---------------------------------------------------------------------------
-- PostgREST only exposes `public`, so a missing row here fails the screen even when
-- the `youbiss` body next to it exists.
select n.nspname as schema, p.proname as function,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'youbiss')
  and p.proname ~ '^(inv_|store_|crm_|next_document_number)'
order by 1, 2, 3;

-- ---------------------------------------------------------------------------
-- 3 · The columns and enums the newest migrations add
-- ---------------------------------------------------------------------------
select 'inv_items.sell_online' as object,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'inv_items' and column_name = 'sell_online') as present
union all
select 'inv_items.tax_rate_pct',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'inv_items' and column_name = 'tax_rate_pct')
union all
select 'type store_order_status', to_regtype('public.store_order_status') is not null
union all
select 'table store_settings', to_regclass('public.store_settings') is not null
union all
select 'table store_orders', to_regclass('public.store_orders') is not null
union all
select 'table store_order_lines', to_regclass('public.store_order_lines') is not null
order by 1;

-- ---------------------------------------------------------------------------
-- 4 · The two calls the Inventory hub makes, made as a real member
-- ---------------------------------------------------------------------------
-- Fill in the uuids from these first, then run this block:
--   select id, name, currency, timezone, locale from public.orgs;
--   select m.org_id, m.user_id, u.email, m.role
--     from public.org_members m join auth.users u on u.id = m.user_id;
--
-- It is wrapped in a transaction and rolled back, so the claims set here do not
-- leak into the rest of the session. If `inv_counts` or `inv_stock_map` raises, the
-- editor prints the database's own words — which is the message the screen never
-- shows.
--
-- These four statements are left commented out on purpose: pasted as they stand they
-- would fail on the placeholders, so the three reports above can be run in one go by
-- anybody. Paste your own uuids in, uncomment, and run them as a query of their own.
--
-- begin;
--
-- select set_config(
--   'request.jwt.claims',
--   jsonb_build_object('sub', '<PASTE USER UUID>', 'role', 'authenticated', 'aud', 'authenticated')::text,
--   true
-- );
--
-- -- Optional, and only if the project lets `postgres` become the API role. It changes
-- -- nothing about the two calls below, because both are SECURITY DEFINER and re-check
-- -- membership from the claims above rather than from the role.
-- -- set local role authenticated;
--
-- select public.inv_counts('<PASTE ORG UUID>'::uuid);
--
-- select * from public.inv_stock_map('<PASTE ORG UUID>'::uuid);
--
-- rollback;

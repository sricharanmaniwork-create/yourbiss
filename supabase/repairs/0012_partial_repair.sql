-- ============================================================================
-- Yourbiss — repair the half-applied 0012 before running it again
--
-- WHY THIS EXISTS
-- The Supabase SQL editor runs a script one statement at a time and does not wrap
-- it in a transaction. 0012 failed at `create table public.store_orders`, so every
-- statement before that line is already in the database and every statement after
-- it is not. Re-running the fixed 0012 would then stop at the first
-- "already exists". This file puts the database back to the state it was in before
-- 0012 was ever tried, so the fixed migration can be applied whole.
--
-- WHAT IS HALF-BUILT, AND WHY IT MATTERS NOW
-- `store_settings` exists as a bare table. The `enable row level security`, the
-- policies and the `revoke` that were supposed to protect it are all at the far end
-- of 0012, after the failure — so as things stand the table has RLS off, and
-- Supabase's default privileges hand `anon` and `authenticated` full access to
-- every new public table. Anyone with the project's publishable key can read and
-- write every workspace's shipping fee and checkout note right now. Run this file,
-- then run 0012.
--
-- HOW TO RUN
-- Supabase → SQL editor → New query → paste all of this → Run.
-- It is wrapped in one transaction: either every step lands or none does, and the
-- final `select` prints what is left, which should be no rows.
--
-- WHAT THIS DELETES
-- Only objects 0012 created, in only the two columns it added to Inventory's item
-- list. `sell_online` and `tax_rate_pct` are dropped with their contents: if an item
-- was switched on for the storefront between the failed run and this one, 0012
-- re-adds the columns and that one flag goes back to off. Nothing else in the
-- database refers to them.
-- ============================================================================

begin;

-- The order-status enum, and the three tables that would have used it. Cascade
-- because the triggers and policies below hang off them, and none of that exists
-- in a half-run either way.
drop table if exists public.store_order_lines;
drop table if exists public.store_orders;
drop table if exists public.store_settings;

drop type if exists public.store_order_status;

-- The two columns 0012 added to Inventory's list, and the partial index that reads
-- one of them. Dropping a column takes its own index and check with it, so the
-- index statement is here only to be explicit about what goes.
drop index if exists public.inv_items_org_storefront;
alter table public.inv_items drop column if exists sell_online;
alter table public.inv_items drop column if exists tax_rate_pct;

-- Proof, in the shape the failed run left behind. Every row this prints is a 0012
-- object the database still holds, so the correct answer is an empty result.
select 'table' as kind, t.name as object
from (values ('public.store_settings'), ('public.store_orders'), ('public.store_order_lines')) t(name)
where to_regclass(t.name) is not null
union all
select 'column', 'public.inv_items.' || c.name
from (values ('sell_online'), ('tax_rate_pct')) c(name)
where exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'inv_items' and column_name = c.name
)
union all
select 'type', 'public.store_order_status'
where to_regtype('public.store_order_status') is not null
union all
select 'index', 'public.inv_items_org_storefront'
where to_regclass('public.inv_items_org_storefront') is not null
order by 1, 2;

commit;

-- Next: run `supabase/migrations/0012_store.sql` whole, in one go. Paste it under a
-- `begin;` and above a `commit;` this time, so a statement that fails leaves nothing
-- half-built behind — that is what put the database in this state.

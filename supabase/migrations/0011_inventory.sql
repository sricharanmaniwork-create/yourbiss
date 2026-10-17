-- ============================================================================
-- Yourbiss — 0011: Inventory (items, a stock ledger, suppliers, purchase orders)
--
-- What this app is for
--
-- Website, Forms, Bookings and CRM all deal in promises to do something. Inventory
-- is the only app in the suite that has to answer "do we still have it". It also
-- gives Store something to sell: an item with a price and a quantity is the row a
-- cart line points at, so this migration is written with 0012 in mind and not as a
-- spreadsheet with extra steps.
--
-- Design, and the reasons:
--
--   * Every table carries org_id, so a policy is one membership test, exactly like
--     0002 through 0010. `anon` gets nothing: a stock level is not a public page,
--     and the product list a customer sees is rendered by the site, which reads the
--     item's price through the published-page path.
--
--   * Money is always the workspace's currency. `orgs.currency` (0002) is what a
--     studio bills in, and CRM already made that decision for deals: a per-row
--     currency column is how a total becomes meaningless. Same for quantities —
--     numeric(14,2), because stock is counted in pieces and in kilograms.
--
--   * Stock on hand is never a column. `inv_movements` is the only record of what
--     came in and went out, and on-hand is the sum of it — the same rule CRM learned
--     with a deal's state, which is that a second column that can disagree with the
--     first one is a bug waiting for a busy afternoon. It costs one grouped read to
--     show a whole list (`inv_stock_map`), and it buys the guarantee that a report
--     and a shelf can never tell different stories.
--
--   * The ledger is append-only. No UPDATE and no DELETE policy exists on
--     `inv_movements` and the privileges revoke them outright, so a mistake is
--     corrected by the opposite movement, which leaves both the mistake and the fix
--     visible. A stock count you can edit afterwards is not a count.
--
--   * A tracked item cannot go below zero. `track_stock` is what makes that rule
--     mean something: a product on a shelf has a floor of zero, while a service or a
--     drop-shipped line has no shelf to run out of, and its movements still count
--     because the ledger is a record of what happened, not a display preference.
--
--   * A purchase order is a document, so it gets a number the customer can quote and
--     a state machine it cannot leave. `doc_counters` is the one table nothing in the
--     browser reads — a counter is a mutex, not data — and 0012 will take its
--     sales-order and invoice numbers from the same upsert, which is why the kind is
--     free-form within a shape rather than an enum.
--
--   * Receiving is a function and not a checkbox. `inv_post_receipt` writes the
--     movement and the line's `received_qty` in one transaction with both rows
--     locked, because a half-received order is the state a warehouse lives in and a
--     double-clicked "receive" must not put stock on the shelf twice. The line then
--     carries a rule the table can check: goods received cannot exceed goods the
--     ledger says arrived.
--
--   * A sent order is not edited. Lines freeze once the order leaves draft, because
--     the supplier has a copy; you cancel it, or you order the difference. Cancelled
--     and received are final, and an order with goods already on the shelf cannot be
--     deleted — history is not a draft.
--
-- Privileges and the `public.` RPC wrappers live in this file for the reason 0008
-- and 0010 state: an applied migration is immutable, and a table with policies and
-- no grant looks exactly like a broken policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Why a pile of boxes moved. `sale` and `customer_return` are written by Store
-- (0012); the reasons Inventory itself writes are `opening`, `purchase` and
-- `adjustment`. Each one has a fixed sign, enforced by a CHECK below, so a row
-- cannot claim to be a sale while adding stock.
create type public.inv_movement_reason as enum (
  'opening', 'purchase', 'sale', 'customer_return', 'adjustment'
);
create type public.inv_item_kind   as enum ('product', 'service');
create type public.inv_item_status as enum ('active', 'archived');
-- draft → ordered → partially_received → received, and draft/ordered/
-- partially_received → cancelled. The trigger on the table refuses anything else.
create type public.inv_purchase_status as enum (
  'draft', 'ordered', 'partially_received', 'received', 'cancelled'
);

-- ===========================================================================
-- Document numbering
-- ===========================================================================

-- One row per workspace, per document kind, per year. The upsert is the lock: two
-- concurrent orders in the same workspace get two different numbers because the
-- second waits on the row, and the unique index on the document itself is what makes
-- a lost race impossible rather than merely unlikely.
create table public.doc_counters (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z]{2,16}$'),
  period     text not null check (period ~ '^[0-9]{4}$'),
  next_value bigint not null default 1 check (next_value >= 1),
  created_at timestamptz not null default now(),
  primary key (org_id, kind, period)
);

alter table public.doc_counters enable row level security;

-- No policy: a browser never reads or writes a counter. Only SECURITY DEFINER
-- functions reach it, and they re-check membership themselves.
revoke all on public.doc_counters from anon, public;
grant all on public.doc_counters to service_role, postgres;

-- ===========================================================================
-- Items — the thing list
-- ===========================================================================

create table public.inv_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 140),
  -- A stock code is how a shelf is read and how a supplier's invoice is matched, so
  -- it is unique per workspace when it is used at all. Blank is not a code.
  sku        text check (sku is null or sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  kind       public.inv_item_kind not null default 'product',
  status     public.inv_item_status not null default 'active',
  -- What one unit means: 'pcs', 'hrs', 'kg'. Free text on purpose — a print shop and
  -- a clinic do not share a unit list, and a fixed enum would be a guess.
  unit       text not null default 'pcs' check (unit ~ '^[A-Za-z0-9./ -]{1,24}$'),
  description text check (description is null or char_length(description) <= 1000),
  -- What it is sold for, and what it cost last. Both live in the workspace currency,
  -- and neither is a total: they are the numbers a document is filled in with.
  price      numeric(14, 2) not null default 0 check (price >= 0),
  cost       numeric(14, 2) not null default 0 check (cost >= 0),
  -- A service has no shelf. `track_stock` is the flag that says whether zero means
  -- anything for this row, which is why a service cannot be tracked.
  track_stock boolean not null default true,
  -- When the shelf reaches this, the hub says so. Null means nobody has decided.
  reorder_point numeric(14, 2) check (reorder_point is null or reorder_point >= 0),
  image_url  text check (image_url is null or image_url ~ '^https?://'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (track_stock = false or kind = 'product'),
  -- A reorder point on an item nobody counts is a number that never means anything.
  check (reorder_point is null or track_stock)
);

create unique index inv_items_org_sku on public.inv_items (org_id, upper(sku)) where sku is not null;
create unique index inv_items_org_name on public.inv_items (org_id, lower(name))
  where status = 'active';
create index inv_items_org_list on public.inv_items (org_id, status, lower(name));
create index inv_items_org_kind on public.inv_items (org_id, kind, track_stock);

-- ===========================================================================
-- Suppliers — who the orders go to
-- ===========================================================================

create table public.inv_suppliers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  contact    text check (contact is null or char_length(contact) between 1 and 120),
  email      citext,
  phone      text check (phone is null or char_length(phone) between 1 and 40),
  address    text check (address is null or char_length(address) <= 400),
  notes      text check (notes is null or char_length(notes) <= 1000),
  status     public.inv_item_status not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is null or char_length(email::text) <= 254)
);

-- Two rows for one supplier is how a payment ends up at the wrong address.
create unique index inv_suppliers_org_name on public.inv_suppliers (org_id, lower(name));
create index inv_suppliers_org_list on public.inv_suppliers (org_id, status, lower(name));

-- ===========================================================================
-- Purchase orders and their lines
-- ===========================================================================

create table public.inv_purchases (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  number        text not null,
  supplier_id   uuid not null references public.inv_suppliers (id) on delete restrict,
  status        public.inv_purchase_status not null default 'draft',
  -- When the order was placed, and when the goods were meant to arrive. Dates, not
  -- timestamps: nobody schedules a delivery to 14:37, and a due list reads as days.
  order_date    date not null default current_date,
  expected_date date,
  notes         text check (notes is null or char_length(notes) <= 1000),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (expected_date is null or expected_date >= order_date),
  -- The number is minted by youbiss.next_document_number and never retyped: a
  -- hand-written "PO-1" is how two orders end up with the same reference. The tail is
  -- four digits or more, so a busy workspace walks past 9999 instead of hitting a wall.
  check (number ~ '^[A-Z]{2,4}-[0-9]{4}-[0-9]{4,}$')
);

create unique index inv_purchases_org_number on public.inv_purchases (org_id, number);
create index inv_purchases_org_list on public.inv_purchases (org_id, status, order_date desc);
create index inv_purchases_supplier on public.inv_purchases (supplier_id, order_date desc);

-- A line prices itself: `total` is generated, so a quantity typed into a screen
-- cannot arrive with a total that disagrees with it.
create table public.inv_purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.inv_purchases (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  item_id      uuid not null references public.inv_items (id) on delete restrict,
  -- The item's name at the time of the order. A rename must not rewrite a document
  -- somebody already sent, which is the same reason an invoice line copies it.
  description  text not null check (char_length(description) between 1 and 140),
  qty          numeric(14, 2) not null check (qty > 0 and qty <= 100000000),
  unit_cost    numeric(14, 2) not null check (unit_cost >= 0 and unit_cost <= 100000000),
  received_qty numeric(14, 2) not null default 0 check (received_qty >= 0),
  total        numeric generated always as (round(qty * unit_cost, 2)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (received_qty <= qty)
);

create index inv_lines_purchase on public.inv_purchase_lines (purchase_id, created_at);
create index inv_lines_item on public.inv_purchase_lines (org_id, item_id);

-- ===========================================================================
-- The stock ledger
-- ===========================================================================

create table public.inv_movements (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  item_id    uuid not null references public.inv_items (id) on delete restrict,
  -- Signed. Positive means it arrived. Because on-hand is the sum of this column,
  -- one number carries both directions and nothing else has to agree with it.
  delta      numeric(14, 2) not null check (delta <> 0 and abs(delta) <= 100000000),
  reason     public.inv_movement_reason not null,
  -- What a unit cost when it arrived, kept on the row rather than read back off the
  -- item: the item's cost changes next month and this movement should not.
  unit_cost  numeric(14, 2) check (unit_cost is null or (unit_cost >= 0 and unit_cost <= 100000000)),
  reference  text check (reference is null or char_length(reference) <= 200),
  purchase_line_id uuid references public.inv_purchase_lines (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- The reason decides the sign. A row that says "sale" and adds stock is not a
  -- record of anything; an adjustment is the one entry whose direction is the whole
  -- point of it, so it is signed by whoever counts the shelf.
  check (
    (reason in ('opening', 'purchase', 'customer_return') and delta > 0)
    or (reason = 'sale' and delta < 0)
    or (reason = 'adjustment' and delta <> 0)
  )
);

create index inv_movements_item on public.inv_movements (item_id, created_at desc);
create index inv_movements_org  on public.inv_movements (org_id, created_at desc);
create index inv_movements_line on public.inv_movements (purchase_line_id) where purchase_line_id is not null;

-- ===========================================================================
-- Triggers
-- ===========================================================================

create trigger youbiss_inv_items_touch     before update on public.inv_items
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_inv_suppliers_touch before update on public.inv_suppliers
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_inv_purchases_touch before update on public.inv_purchases
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_inv_lines_touch     before update on public.inv_purchase_lines
  for each row execute function youbiss.touch_updated_at();

-- A stock movement is the one write in this app that changes a number people count
-- shelves by, so it is checked against the item it belongs to and against the shelf
-- it leaves.
--
-- The item row is locked first. Without it, two concurrent "last one out" movements
-- both read a quantity of one, both pass, and the shelf ends up at minus one — which
-- is exactly the kind of error no screen notices until somebody tries to sell it.
create or replace function youbiss.inv_movement_guard()
returns trigger
language plpgsql
as $$
declare
  v_item   public.inv_items;
  v_on_hand numeric;
begin
  select * into v_item from public.inv_items where id = new.item_id for update;
  if not found then
    raise exception 'that item does not exist' using errcode = 'P0002';
  end if;

  if v_item.org_id is distinct from new.org_id then
    raise exception 'a stock movement cannot change workspace' using errcode = '42501';
  end if;

  -- Only a tracked item has a floor. A service has no shelf to run out of, and its
  -- movements still belong in the ledger — the number is simply not a promise.
  if v_item.track_stock then
    select coalesce(sum(m.delta), 0) into v_on_hand
    from public.inv_movements m
    where m.item_id = new.item_id;

    if v_on_hand + new.delta < 0 then
      raise exception '“%” has % % in stock, so % % cannot go out',
        v_item.name, v_on_hand, v_item.unit, abs(new.delta), v_item.unit
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger youbiss_inv_movement
  before insert on public.inv_movements
  for each row execute function youbiss.inv_movement_guard();

-- What an item *is* cannot change once its shelf has a history: flipping a service
-- into a tracked product, or un-tracking an item that has been counted, would
-- silently rewrite what every past movement meant. Prices, the description and the
-- picture are free to change — they are facts about the market, not about the row.
create or replace function youbiss.inv_item_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'an item does not change workspace' using errcode = '42809';
  end if;

  if (new.kind is distinct from old.kind or new.track_stock is distinct from old.track_stock)
     and exists (select 1 from public.inv_movements m where m.item_id = old.id) then
    raise exception 'that item already has stock history — archive it and make a new one'
      using errcode = '42809';
  end if;

  return new;
end;
$$;

create trigger youbiss_inv_item_immutable
  before update on public.inv_items
  for each row execute function youbiss.inv_item_immutable();

-- A purchase order's supplier, and a line's item, must be rows of the same
-- workspace. The policies cannot see across two tables per row without turning every
-- list into a join, so the shape is checked where the row is written.
create or replace function youbiss.inv_purchase_target_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'a purchase order does not change workspace' using errcode = '42809';
  end if;

  if not exists (
    select 1 from public.inv_suppliers s
    where s.id = new.supplier_id and s.org_id = new.org_id
  ) then
    raise exception 'that supplier is not in this workspace' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger youbiss_inv_purchase_target
  before insert or update on public.inv_purchases
  for each row execute function youbiss.inv_purchase_target_guard();

-- An order only leaves draft with something on it, only reaches "received" when every
-- line says so, and never comes back once it has. This is what lets the hub print
-- `received` without re-adding up the lines, and it is why no action in the app has a
-- status dropdown: the transitions are the states, not a preference.
--
-- The same trigger holds the header still, because a state machine that lets the
-- document it guards be rewritten underneath it guards nothing.
create or replace function youbiss.inv_purchase_status_guard()
returns trigger
language plpgsql
as $$
declare
  v_lines    integer;
  v_received numeric;
  v_open     integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a new purchase order starts as a draft' using errcode = '42809';
    end if;
    return new;
  end if;

  -- The reference never changes, and neither do the terms once the order leaves
  -- draft. The lines freeze for the same reason — the supplier holds a copy — and an
  -- order whose date, supplier or note can be quietly moved afterwards is not a
  -- document, it is a draft that somebody forgot to delete.
  if new.number is distinct from old.number then
    raise exception 'a purchase order keeps the number it was given' using errcode = '42809';
  end if;

  if old.status <> 'draft' and (
       new.supplier_id is distinct from old.supplier_id
    or new.order_date is distinct from old.order_date
    or new.expected_date is distinct from old.expected_date
    or new.notes is distinct from old.notes
  ) then
    raise exception 'a purchase order that has been sent is not edited — cancel it or order the difference'
      using errcode = '42809';
  end if;

  if new.status is distinct from old.status then
    select count(*), coalesce(sum(l.received_qty), 0),
           count(*) filter (where l.received_qty < l.qty)
      into v_lines, v_received, v_open
      from public.inv_purchase_lines l
      where l.purchase_id = new.id;

    if old.status in ('received', 'cancelled') then
      raise exception 'a % purchase order is finished', old.status using errcode = '42809';
    end if;

    if new.status = 'ordered' and v_lines = 0 then
      raise exception 'an order needs at least one line before it is sent' using errcode = '42809';
    end if;

    if new.status = 'received' and v_open > 0 then
      raise exception 'that order still has goods outstanding' using errcode = '42809';
    end if;

    if new.status in ('partially_received', 'received') and v_received <= 0 then
      raise exception 'nothing has been received against that order yet' using errcode = '42809';
    end if;

    if new.status = 'partially_received' and v_open = 0 then
      raise exception 'every line is complete — that order has been received' using errcode = '42809';
    end if;
  end if;

  return new;
end;
$$;

create trigger youbiss_inv_purchase_status
  before update or insert on public.inv_purchases
  for each row execute function youbiss.inv_purchase_status_guard();

-- Lines are the part of an order a supplier holds a copy of, so they freeze when the
-- draft is sent. Receiving is the one change allowed afterwards, and it is bounded by
-- the ledger rather than by the screen: goods cannot be "received" beyond the
-- movements that actually put them on the shelf.
create or replace function youbiss.inv_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status public.inv_purchase_status;
  v_ledger numeric;
begin
  if tg_op = 'DELETE' then
    select p.status into v_status from public.inv_purchases p where p.id = old.purchase_id;
    if v_status is distinct from 'draft' then
      raise exception 'a purchase order that has been sent is not edited — cancel it or order the difference'
        using errcode = '42809';
    end if;
    return old;
  end if;

  if new.org_id is distinct from (
    select p.org_id from public.inv_purchases p where p.id = new.purchase_id
  ) then
    raise exception 'a line belongs to its order’s workspace' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.inv_items i
    where i.id = new.item_id and i.org_id = new.org_id
  ) then
    raise exception 'that item is not in this workspace' using errcode = '42501';
  end if;

  select p.status into v_status from public.inv_purchases p where p.id = new.purchase_id;

  if tg_op = 'UPDATE' then
    -- Only the receipt column may move once the order is out of draft. `updated_at`
    -- changes on its own through the touch trigger, so it is not part of the test.
    if new.qty is distinct from old.qty
       or new.unit_cost is distinct from old.unit_cost
       or new.item_id is distinct from old.item_id
       or new.description is distinct from old.description
       or new.purchase_id is distinct from old.purchase_id
       or new.org_id is distinct from old.org_id then
      if v_status is distinct from 'draft' then
        raise exception 'a purchase order that has been sent is not edited — cancel it or order the difference'
          using errcode = '42809';
      end if;
    end if;

    if new.received_qty is distinct from old.received_qty then
      select coalesce(sum(m.delta), 0) into v_ledger
      from public.inv_movements m
      where m.purchase_line_id = new.id and m.reason = 'purchase';

      if new.received_qty > v_ledger then
        raise exception 'goods are recorded as received by the stock ledger, not by an edit'
          using errcode = '42809';
      end if;
    end if;
  else
    if v_status is distinct from 'draft' then
      raise exception 'a purchase order that has been sent takes no new lines'
        using errcode = '42809';
    end if;
  end if;

  return new;
end;
$$;

create trigger youbiss_inv_line
  before insert or update or delete on public.inv_purchase_lines
  for each row execute function youbiss.inv_line_guard();

-- An order with goods already on the shelf is not deleted. Deleting it would leave
-- those movements pointing at nothing and make the stock they represent
-- unexplainable, which is the one thing a ledger must not do.
create or replace function youbiss.inv_purchase_deletable()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.inv_purchase_lines l where l.purchase_id = old.id and l.received_qty > 0) then
    raise exception 'that order has goods received against it — cancel it instead of deleting it'
      using errcode = '42809';
  end if;
  return old;
end;
$$;

create trigger youbiss_inv_purchase_deletable
  before delete on public.inv_purchases
  for each row execute function youbiss.inv_purchase_deletable();

-- An item that has been ordered or counted is not deleted either: the archive status
-- is the supported way out, and it keeps both documents and the shelf readable.
create or replace function youbiss.inv_item_deletable()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.inv_movements m where m.item_id = old.id) then
    raise exception 'that item has stock history — archive it instead of deleting it'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger youbiss_inv_item_deletable
  before delete on public.inv_items
  for each row execute function youbiss.inv_item_deletable();

-- ===========================================================================
-- Functions
-- ===========================================================================

-- The number on the front of a document. SECURITY DEFINER because it must write the
-- counter row, which no browser can reach; the caller's membership is re-checked
-- inside, exactly like every other definer body here.
--
-- `kind` is free within a shape rather than an enum so that Store's sales orders and
-- invoices take numbers from this function without a migration. The prefix is derived,
-- so `purchase` prints PO-2026-0001 and `invoice` prints IN-2026-0001.
create or replace function youbiss.next_document_number(p_org_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period text := to_char(now(), 'YYYY');
  v_value  bigint;
  v_prefix text;
begin
  if p_kind is null or p_kind !~ '^[a-z]{2,16}$' then
    raise exception 'a document kind is lower-case letters' using errcode = '22023';
  end if;
  if not youbiss.is_member(p_org_id) then
    raise exception 'only a member of this workspace can number its documents'
      using errcode = '42501';
  end if;

  insert into public.doc_counters (org_id, kind, period, next_value)
  values (p_org_id, p_kind, v_period, 1)
  on conflict (org_id, kind, period)
  do update set next_value = public.doc_counters.next_value + 1
  returning next_value into v_value;

  v_prefix := case
    when p_kind = 'purchase' then 'PO'
    when p_kind = 'invoice'  then 'IN'
    when p_kind = 'sales_order' then 'SO'
    else upper(left(p_kind, 2))
  end;

  return v_prefix || '-' || v_period || '-' || lpad(v_value::text, 4, '0');
end;
$$;

-- On-hand for one item, in the database, so a screen never re-derives it in
-- JavaScript and disagrees with the count the hub printed.
--
-- Both readers re-check who is calling. They are SECURITY DEFINER because the ledger
-- they add up is the thing a report must never under-read, and a definer body sees
-- rows RLS would hide — which is exactly why an organisation's uuid, or one of its
-- item ids, is not a permission.
create or replace function youbiss.inv_on_hand(p_item_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select i.org_id into v_org from public.inv_items i where i.id = p_item_id;
  if not found then
    raise exception 'that item is not in this workspace' using errcode = 'P0002';
  end if;
  if not (youbiss.is_member(v_org) and youbiss.app_enabled(v_org, 'inventory')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  return (select coalesce(sum(m.delta), 0) from public.inv_movements m where m.item_id = p_item_id);
end;
$$;

-- The whole shelf in one read. A list of two hundred items would otherwise be two
-- hundred grouped counts, and the answer is the same either way.
create or replace function youbiss.inv_stock_map(p_org_id uuid)
returns table (item_id uuid, on_hand numeric, movements integer, last_movement_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'inventory')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  return query
    select i.id,
           coalesce(sum(m.delta), 0),
           count(m.id)::integer,
           max(m.created_at)
    from public.inv_items i
    left join public.inv_movements m on m.item_id = i.id
    where i.org_id = p_org_id
    group by i.id;
end;
$$;

-- ===========================================================================
-- Receiving — the one way goods arrive against an order
--
-- Three writes that are one decision: a movement, the line's received quantity, and
-- the order's status. Both rows are locked because a warehouse scans the same line
-- twice, and a double scan that put stock on the shelf twice is a count nobody can
-- trust afterwards. SECURITY DEFINER for the same reason `crm_convert_lead` is: the
-- membership and app checks are inside it, because a definer body sees rows that RLS
-- would hide from the caller.
-- ===========================================================================
create or replace function youbiss.inv_post_receipt(p_line_id uuid, p_qty numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line     public.inv_purchase_lines;
  v_purchase public.inv_purchases;
  v_after    numeric;
  v_status   public.inv_purchase_status;
begin
  select * into v_line from public.inv_purchase_lines where id = p_line_id for update;
  if not found then
    raise exception 'that line is not in this workspace' using errcode = 'P0002';
  end if;

  if not (youbiss.is_member(v_line.org_id) and youbiss.app_enabled(v_line.org_id, 'inventory')) then
    raise exception 'only a member of this workspace can receive its goods'
      using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'a receipt has to be a quantity' using errcode = '22003';
  end if;

  select * into v_purchase from public.inv_purchases where id = v_line.purchase_id for update;

  if v_purchase.status not in ('ordered', 'partially_received') then
    raise exception 'only a purchase order that has been sent can be received'
      using errcode = '42809';
  end if;

  v_after := v_line.received_qty + p_qty;
  if v_after > v_line.qty then
    raise exception 'that order asked for % and already has % received', v_line.qty, v_line.received_qty
      using errcode = '23514';
  end if;

  -- The movement first, because the line's own guard bounds `received_qty` by it: the
  -- order of these two statements is the reason a hand-written edit of received_qty
  -- cannot invent stock.
  insert into public.inv_movements (org_id, item_id, delta, reason, unit_cost, reference, purchase_line_id, created_by)
  values (v_line.org_id, v_line.item_id, p_qty, 'purchase', v_line.unit_cost, v_purchase.number, p_line_id, auth.uid());

  update public.inv_purchase_lines set received_qty = v_after where id = p_line_id;

  -- Derived from the lines rather than typed: the order is finished when nothing on
  -- it is outstanding, and part-way when something is.
  select case
           when coalesce(sum(l.received_qty), 0) <= 0 then 'ordered'::public.inv_purchase_status
           when bool_or(l.received_qty >= l.qty) then 'received'::public.inv_purchase_status
           else 'partially_received'::public.inv_purchase_status
         end
    into v_status
    from public.inv_purchase_lines l
    where l.purchase_id = v_purchase.id;

  update public.inv_purchases set status = v_status where id = v_purchase.id;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (v_line.org_id, auth.uid(), 'inventory', 'inv_purchase', v_purchase.id::text, 'received',
          left('Received ' || p_qty || ' against ' || v_purchase.number, 500));

  return jsonb_build_object(
    'line_id', p_line_id,
    'purchase_id', v_purchase.id,
    'received_qty', v_after,
    'qty', v_line.qty,
    'status', v_status
  );
end;
$$;

-- ===========================================================================
-- Counts — the hub, the item list header and the dashboard in one read
--
-- The same shape as `crm_counts`: eleven questions the hub would otherwise ask as
-- eleven round trips, answered by one function that re-checks membership internally so
-- the numbers cannot be pulled out of a workspace that has no right to see them.
--
-- "Low" and "out" are asked of tracked items only: a service has no shelf, so a
-- negative number on it is not an emergency. Stock value is cost, not price — the
-- point of the figure is what is sitting on the floor.
-- ===========================================================================
create or replace function youbiss.inv_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'inventory')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with levels as (
    select i.id, i.kind, i.track_stock, i.reorder_point, i.cost,
           coalesce(sum(m.delta), 0) as on_hand
    from public.inv_items i
    left join public.inv_movements m on m.item_id = i.id
    where i.org_id = p_org_id and i.status = 'active'
    group by i.id, i.kind, i.track_stock, i.reorder_point, i.cost
  ),
  open_orders as (
    select p.id,
           coalesce(sum(l.qty * l.unit_cost), 0) as value,
           coalesce(sum(l.qty - l.received_qty), 0) as outstanding
    from public.inv_purchases p
    left join public.inv_purchase_lines l on l.purchase_id = p.id
    where p.org_id = p_org_id and p.status in ('draft', 'ordered', 'partially_received')
    group by p.id
  )
  select jsonb_build_object(
    'items',          (select count(*) from levels),
    'products',       (select count(*) from levels where kind = 'product'),
    'services',       (select count(*) from levels where kind = 'service'),
    'tracked',        (select count(*) from levels where track_stock),
    'low_stock',      (select count(*) from levels where track_stock and reorder_point is not null
                         and on_hand <= reorder_point),
    'out_of_stock',   (select count(*) from levels where track_stock and on_hand <= 0),
    'stock_value',    (select coalesce(sum(case when on_hand > 0 then on_hand * cost else 0 end), 0)
                         from levels where track_stock),
    'suppliers',      (select count(*) from public.inv_suppliers s
                        where s.org_id = p_org_id and s.status = 'active'),
    'purchases_open', (select count(*) from open_orders),
    'purchases_value',(select coalesce(sum(value), 0) from open_orders),
    'awaiting_goods', (select count(*) from open_orders where outstanding > 0),
    'receipts_30d',   (select count(*) from public.inv_movements m
                        where m.org_id = p_org_id and m.reason = 'purchase'
                          and m.created_at > now() - interval '30 days'),
    'movements_30d',  (select count(*) from public.inv_movements m
                        where m.org_id = p_org_id
                          and m.created_at > now() - interval '30 days')
  ) into out;

  return out;
end;
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.inv_items         enable row level security;
alter table public.inv_suppliers     enable row level security;
alter table public.inv_purchases     enable row level security;
alter table public.inv_purchase_lines enable row level security;
alter table public.inv_movements     enable row level security;

-- A member of the workspace runs a stockroom. Deleting an item, a supplier or an
-- order is the class of decision 0005 and 0010 already reserve for an owner or admin.
create policy inv_items_select on public.inv_items
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_items_write on public.inv_items
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_items_update on public.inv_items
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_items_delete on public.inv_items
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_suppliers_select on public.inv_suppliers
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_suppliers_insert on public.inv_suppliers
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_suppliers_update on public.inv_suppliers
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_suppliers_delete on public.inv_suppliers
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'inventory'));

-- Ordering stock is daily work; erasing an order is not.
create policy inv_purchases_select on public.inv_purchases
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_purchases_insert on public.inv_purchases
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_purchases_update on public.inv_purchases
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_purchases_delete on public.inv_purchases
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_lines_select on public.inv_purchase_lines
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_lines_insert on public.inv_purchase_lines
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_lines_update on public.inv_purchase_lines
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_lines_delete on public.inv_purchase_lines
  for delete to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_movements_select on public.inv_movements
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

create policy inv_movements_insert on public.inv_movements
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'inventory'));

-- Append-only on purpose: there is no update or delete policy here, and the privileges
-- below do not offer the columns either. A ledger that can be quietly rewritten is not
-- evidence of anything.

revoke all on public.inv_items, public.inv_suppliers, public.inv_purchases,
              public.inv_purchase_lines, public.inv_movements
  from anon, public;

-- ===========================================================================
-- Privileges
-- ===========================================================================
grant select, insert, update, delete on public.inv_items         to authenticated;
grant select, insert, update, delete on public.inv_suppliers     to authenticated;
grant select, insert, update, delete on public.inv_purchases     to authenticated;
grant select, insert, update, delete on public.inv_purchase_lines to authenticated;
grant select, insert on public.inv_movements to authenticated;

grant all on public.inv_items, public.inv_suppliers, public.inv_purchases,
               public.inv_purchase_lines, public.inv_movements
  to service_role, postgres;

grant execute on function youbiss.next_document_number(uuid, text) to authenticated, service_role;
grant execute on function youbiss.inv_on_hand(uuid) to authenticated, service_role;
grant execute on function youbiss.inv_stock_map(uuid) to authenticated, service_role;
grant execute on function youbiss.inv_post_receipt(uuid, numeric) to authenticated, service_role;
grant execute on function youbiss.inv_counts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The RPC surface, same as 0007 and 0010: PostgREST only exposes `public`, so a
-- callable function carries its own SECURITY INVOKER wrapper. `inv_stock_map` is
-- declared `returns table`, so the wrapper is a `select * from` rather than a scalar
-- pass-through.
-- ---------------------------------------------------------------------------
create or replace function public.next_document_number(p_org_id uuid, p_kind text)
returns text
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.next_document_number(p_org_id, p_kind);
$$;

create or replace function public.inv_on_hand(p_item_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.inv_on_hand(p_item_id);
$$;

create or replace function public.inv_stock_map(p_org_id uuid)
returns table (item_id uuid, on_hand numeric, movements integer, last_movement_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select * from youbiss.inv_stock_map(p_org_id);
$$;

create or replace function public.inv_post_receipt(p_line_id uuid, p_qty numeric)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.inv_post_receipt(p_line_id, p_qty);
$$;

create or replace function public.inv_counts(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.inv_counts(p_org_id);
$$;

revoke all on function public.next_document_number(uuid, text) from public;
revoke all on function public.inv_on_hand(uuid) from public;
revoke all on function public.inv_stock_map(uuid) from public;
revoke all on function public.inv_post_receipt(uuid, numeric) from public;
revoke all on function public.inv_counts(uuid) from public;

grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;
grant execute on function public.inv_on_hand(uuid) to authenticated, service_role;
grant execute on function public.inv_stock_map(uuid) to authenticated, service_role;
grant execute on function public.inv_post_receipt(uuid, numeric) to authenticated, service_role;
grant execute on function public.inv_counts(uuid) to authenticated, service_role;

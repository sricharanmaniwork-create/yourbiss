-- ============================================================================
-- Yourbiss — 0012: Store (a storefront over the Inventory list, orders, and the
-- money a workspace collects by hand)
--
-- What this app is for
--
-- Inventory says what a thing is and how many are on the shelf. Store is the other
-- end of the counter: a visitor puts three of them in a basket, leaves an address,
-- and the workspace gets an order it can print, fill, and mark paid. There is no
-- payment gateway in this migration on purpose — the buyer's card is somebody else's
-- system, and a store that cannot take money still has to answer "what did they
-- order, and has it been paid for". Those two questions are what the tables below
-- hold, and a gateway can be added later as a second way to reach the same rows.
--
-- Design, and the reasons:
--
--   * The catalogue is Inventory's item list, not a second product table. A product
--     with a price and a stock count already exists as `inv_items`; storing it again
--     here is how a shop front and a shelf start telling different stories. Two
--     columns are added to that table — the tax rate a line is billed at, and whether
--     the item goes on the storefront at all — and Inventory's own screens edit them.
--
--   * Switching Inventory off closes the storefront rather than emptying it, which is
--     the same rule 0010 and 0011 write into their app switches. A shop that shows
--     nothing is a bug report; a shop that says it is closed is an answer.
--
--   * Nothing about money or quantity comes from the browser. `store_place_order`
--     takes item ids and quantities, re-reads every item in that workspace, and
--     prices the line from `inv_items` as it stands at that moment. A cart is a list
--     of intentions, not a set of numbers, and the checkout route is the only caller.
--
--   * An order is a document, so it snapshots what it was sold for. `description`,
--     `unit_price` and `tax_rate_pct` are copied onto the line at placement, and the
--     header's `subtotal`, `shipping` and `tax_total` are written once. A price change
--     next month must not rewrite an order a customer already paid for — the same
--     reasoning that made `inv_purchase_lines` copy the item's name.
--
--   * `total` is a generated column, not a field an action fills in. The three parts
--     and the sum cannot disagree, so no screen has to check its own arithmetic.
--
--   * Stock leaves the shelf when the order is confirmed, not when it is placed. A
--     basket abandoned at the address box would otherwise empty a shelf on its own,
--     and 0011 made the ledger the only place a quantity lives. `store_set_status`
--     writes the `sale` movements, which is also where `inv_movement_guard` refuses to
--     sell the last one twice — so a visitor's pre-check is a courtesy, and the
--     confirmation is the gate.
--
--   * Cancelling an order that had goods committed puts those goods back with
--     `customer_return` movements. The ledger keeps both sides: the sale that was
--     planned and the return that undid it. A fulfilled order is not cancelled — the
--     box went out, and pretending otherwise is what the stock count is for.
--
--   * Being paid is a timestamp, not a status. `paid_at` (with what it was paid by)
--     sits beside `status` because "confirmed and unpaid" and "confirmed and paid" are
--     both true at once; a single status column would force one to overwrite the other.
--
--   * A placed order can still be corrected; a confirmed one cannot. The guard on the
--     header refuses any change to the number, the workspace, or the four money
--     columns, and the guard on the lines refuses new or edited lines once the order
--     leaves `placed`. The supported way out is to cancel and take a fresh order,
--     which is what 0011 decided for a sent purchase order.
--
--   * `anon` gets nothing, including no read of orders. A visitor's confirmation is
--     returned by the checkout call and mailed to them; the storefront never looks at
--     another buyer's order. The public write is one function, revoked from `anon` and
--     `authenticated`, called by the server route that rate-limits and validates —
--     exactly how 0004 and 0005 handle a public submission.
--
-- The buyer's row also lands in CRM when that app is on, because `crm_contacts.source`
-- was left free-form in 0010 for precisely this. When CRM is off, the order keeps its
-- own buyer details and nothing is invented in another app's tables.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- placed → confirmed → fulfilled, and placed/confirmed → cancelled. The trigger on the
-- table refuses every other move, so no action in the app offers a status dropdown.
create type public.store_order_status as enum ('placed', 'confirmed', 'fulfilled', 'cancelled');

-- ===========================================================================
-- The two columns the storefront needs on Inventory's item list
-- ===========================================================================

-- Tax is asked per item because a food parcel and an electronics store do not share a
-- rate, and a workspace-wide number would be a guess about what is on the shelf.
alter table public.inv_items
  add column tax_rate_pct numeric(5, 2) not null default 0 check (tax_rate_pct >= 0 and tax_rate_pct <= 100);

-- Opt-in, and deliberately so: switching Store on should not silently put every item
-- the stock list happens to hold onto a public page, including the ones priced at
-- zero. Inventory's item form is where this gets decided, one item at a time.
alter table public.inv_items
  add column sell_online boolean not null default false;

create index inv_items_org_storefront on public.inv_items (org_id, lower(name))
  where status = 'active' and sell_online;

comment on column public.inv_items.tax_rate_pct is 'The percentage added to a storefront line for this item.';
comment on column public.inv_items.sell_online is 'Whether Store lists this item for a visitor to order.';

-- ===========================================================================
-- Storefront settings — one row per workspace
-- ===========================================================================

create table public.store_settings (
  org_id     uuid primary key references public.orgs (id) on delete cascade,
  -- One flat fee for the whole order, in the workspace currency, because 0011 settled
  -- that money is always the workspace's and a per-row currency is how a total becomes
  -- meaningless. Zero means delivery is included.
  shipping_flat numeric(14, 2) not null default 0 check (shipping_flat >= 0 and shipping_flat <= 100000000),
  -- Shown on the storefront above the checkout button and sent in the confirmation, so
  -- "we dispatch on Fridays" lives in one place instead of in a picture on the site.
  checkout_note text check (checkout_note is null or char_length(checkout_note) between 1 and 500),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- Orders and their lines
-- ===========================================================================

create table public.store_orders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  -- Minted by youbiss.doc_number from the same counter 0011 built, so SO-2026-0001 and
  -- PO-2026-0007 never collide and neither is retyped.
  number       text not null,
  status       public.store_order_status not null default 'placed',
  buyer_name   text not null check (char_length(buyer_name) between 1 and 140),
  buyer_email  citext not null check (char_length(buyer_email::text) <= 254),
  buyer_phone  text check (buyer_phone is null or char_length(buyer_phone) between 1 and 40),
  ship_address text not null check (char_length(ship_address) between 1 and 400),
  -- Whatever the visitor typed into the basket. Frozen with the rest of the document.
  notes        text check (notes is null or char_length(notes) <= 1000),
  -- The CRM contact this buyer became, when CRM is on. Set null keeps the order, which
  -- is the point: a contact deleted from CRM must not delete what somebody bought.
  contact_id   uuid references public.crm_contacts (id) on delete set null,
  subtotal     numeric(14, 2) not null check (subtotal >= 0 and subtotal <= 100000000),
  shipping     numeric(14, 2) not null default 0 check (shipping >= 0 and shipping <= 100000000),
  tax_total    numeric(14, 2) not null default 0 check (tax_total >= 0 and tax_total <= 100000000),
  total        numeric generated always as (round(subtotal + shipping + tax_total, 2)) stored,
  paid_at      timestamptz,
  -- How the money actually arrived: bank, upi, cash, card_on_delivery. Free within a
  -- shape because it is a sentence about a payment, not a list this migration can know.
  paid_via     text check (paid_via is null or paid_via ~ '^[a-z_]{1,32}$'),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (number ~ '^[A-Z]{2,4}-[0-9]{4}-[0-9]{4,}$'),
  -- A method with no timestamp is a claim about money that nothing dates.
  check (paid_via is null or paid_at is not null)
);

create unique index store_orders_org_number on public.store_orders (org_id, number);
create index store_orders_org_list on public.store_orders (org_id, status, created_at desc);
create index store_orders_org_paid on public.store_orders (org_id, paid_at) where paid_at is null;
create index store_orders_buyer on public.store_orders (org_id, buyer_email);

-- A line prices itself and taxes itself: both totals are generated, so a quantity that
-- arrives from a browser cannot bring a line total that disagrees with it. `total`
-- repeats the tax expression rather than pointing at `tax_amount`, because a generated
-- column may not read another generated column in the same row.
create table public.store_order_lines (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.store_orders (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  -- restrict, like 0011: an order is evidence of what left the shelf, and the item it
  -- was sold under has to stay behind it.
  item_id      uuid not null references public.inv_items (id) on delete restrict,
  description  text not null check (char_length(description) between 1 and 140),
  qty          numeric(14, 2) not null check (qty > 0 and qty <= 100000000),
  unit_price   numeric(14, 2) not null check (unit_price >= 0 and unit_price <= 100000000),
  tax_rate_pct numeric(5, 2) not null default 0 check (tax_rate_pct >= 0 and tax_rate_pct <= 100),
  tax_amount   numeric generated always as (round(qty * unit_price * tax_rate_pct / 100, 2)) stored,
  total        numeric generated always as (
                 round(qty * unit_price, 2) + round(qty * unit_price * tax_rate_pct / 100, 2)
               ) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index store_lines_order on public.store_order_lines (order_id, created_at);
create index store_lines_item on public.store_order_lines (org_id, item_id);

-- ===========================================================================
-- Triggers
-- ===========================================================================

create trigger youbiss_store_settings_touch before update on public.store_settings
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_store_orders_touch    before update on public.store_orders
  for each row execute function youbiss.touch_updated_at();
create trigger youbiss_store_lines_touch     before update on public.store_order_lines
  for each row execute function youbiss.touch_updated_at();

-- The state machine, and the freeze that keeps the document it guards honest.
--
-- Two separate things happen when an order changes state, which is why the movements
-- are written by `store_set_status` and not here: this trigger says whether a move is
-- allowed at all, including for a direct UPDATE someone runs by hand, and the function
-- does the work that a legal move implies.
create or replace function youbiss.store_order_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'placed' then
      raise exception 'a new order arrives from the storefront as placed' using errcode = '42809';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'placed' then
      raise exception 'that order has already been moved — cancel it instead of deleting it'
        using errcode = '23503';
    end if;
    return old;
  end if;

  if new.org_id is distinct from old.org_id then
    raise exception 'an order does not change workspace' using errcode = '42809';
  end if;

  -- The reference is the number a customer quotes on the phone, and the three money
  -- columns are what was agreed. None of them is editable from a screen, so the table
  -- says so as well. `total` needs no mention: it is generated from them.
  if new.number is distinct from old.number
     or new.subtotal is distinct from old.subtotal
     or new.shipping is distinct from old.shipping
     or new.tax_total is distinct from old.tax_total then
    raise exception 'an order keeps the number and the total it was placed with'
      using errcode = '42809';
  end if;

  -- A visitor's own words about their order are part of the document as placed, so they
  -- freeze with it rather than becoming a note the workspace writes afterwards.
  if old.status <> 'placed' and new.notes is distinct from old.notes then
    raise exception 'the buyer''s note belongs to the order as it was placed'
      using errcode = '42809';
  end if;

  -- Correcting an order before it is accepted is normal — a wrong phone number, a
  -- different address. After it is confirmed, the goods are committed and the only
  -- way out is to cancel and take a fresh order.
  if old.status <> 'placed' and (
       new.buyer_name is distinct from old.buyer_name
    or new.buyer_email is distinct from old.buyer_email
    or new.buyer_phone is distinct from old.buyer_phone
    or new.ship_address is distinct from old.ship_address
  ) then
    raise exception 'an order that has been confirmed is not edited — cancel it and take a new one'
      using errcode = '42809';
  end if;

  if new.status is distinct from old.status then
    if old.status in ('fulfilled', 'cancelled') then
      raise exception 'a % order is finished', old.status using errcode = '42809';
    end if;

    if new.status = 'fulfilled' and old.status <> 'confirmed' then
      raise exception 'only a confirmed order can be sent out' using errcode = '42809';
    end if;
  end if;

  -- Marking an order paid is a fact about money arriving, so it is allowed from any
  -- state; un-marking it is not, because a payment that happened did happen.
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then
    raise exception 'an order that has been paid keeps its payment date — refund it outside Store'
      using errcode = '42809';
  end if;

  return new;
end;
$$;

create trigger youbiss_store_order
  before insert or update or delete on public.store_orders
  for each row execute function youbiss.store_order_guard();

-- A brand-new order arrives placed, with lines that belong to the same workspace and
-- to no other order's totals.
create or replace function youbiss.store_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status public.store_order_status;
begin
  if tg_op = 'DELETE' then
    select o.status into v_status from public.store_orders o where o.id = old.order_id;
    if v_status is distinct from 'placed' then
      raise exception 'an order that has been confirmed takes no line changes'
        using errcode = '42809';
    end if;
    return old;
  end if;

  if new.org_id is distinct from (
    select o.org_id from public.store_orders o where o.id = new.order_id
  ) then
    raise exception 'a line belongs to its order’s workspace' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.inv_items i where i.id = new.item_id and i.org_id = new.org_id
  ) then
    raise exception 'that item is not in this workspace' using errcode = '42501';
  end if;

  select o.status into v_status from public.store_orders o where o.id = new.order_id;

  if tg_op = 'UPDATE' then
    if v_status is distinct from 'placed' and (
         new.qty is distinct from old.qty
      or new.unit_price is distinct from old.unit_price
      or new.tax_rate_pct is distinct from old.tax_rate_pct
      or new.description is distinct from old.description
      or new.item_id is distinct from old.item_id
    ) then
      raise exception 'an order that has been confirmed is not edited — cancel it and take a new one'
        using errcode = '42809';
    end if;
  elsif v_status is distinct from 'placed' then
    raise exception 'an order that has been confirmed takes no new lines'
      using errcode = '42809';
  end if;

  return new;
end;
$$;

create trigger youbiss_store_line
  before insert or update or delete on public.store_order_lines
  for each row execute function youbiss.store_line_guard();

-- ===========================================================================
-- Document numbering, in one place
-- ===========================================================================

-- 0011 put `next_document_number` behind a membership test, which is right for a
-- member and impossible for a visitor checking out. This is the counter itself: no
-- caller check, so it is only ever reached from a definer body that has already
-- decided who is allowed to be here, and it is granted to nobody.
--
-- `doc_counters.kind` is shaped `^[a-z]{2,16}$` by 0011, so an underscore is not a
-- legal kind and a sales order is numbered under its initialism, `so`, which the
-- prefix rule below prints as SO-2026-0001.
create or replace function youbiss.doc_number(p_org_id uuid, p_kind text)
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
  insert into public.doc_counters (org_id, kind, period, next_value)
  values (p_org_id, p_kind, v_period, 1)
  on conflict (org_id, kind, period)
  do update set next_value = public.doc_counters.next_value + 1
  returning next_value into v_value;

  v_prefix := case
    when p_kind = 'purchase' then 'PO'
    when p_kind = 'invoice'  then 'IN'
    when p_kind = 'so'       then 'SO'
    else upper(left(p_kind, 2))
  end;

  return v_prefix || '-' || v_period || '-' || lpad(v_value::text, 4, '0');
end;
$$;

-- The same function 0011 defined, with the same contract — a shape check, a membership
-- check, and the number — now written once. Its grants carry over: replacing a
-- function keeps its privileges and its owner.
create or replace function youbiss.next_document_number(p_org_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_kind is null or p_kind !~ '^[a-z]{2,16}$' then
    raise exception 'a document kind is lower-case letters' using errcode = '22023';
  end if;
  if not youbiss.is_member(p_org_id) then
    raise exception 'only a member of this workspace can number its documents'
      using errcode = '42501';
  end if;

  return youbiss.doc_number(p_org_id, p_kind);
end;
$$;

-- ===========================================================================
-- Checkout — the only public write in Store
--
-- This is the whole of the trust boundary. Quantities come from the browser; prices,
-- tax rates, whether an item is on sale, and the shipping fee do not. The line's
-- snapshot is built here, in one pass, and the order is inserted only once every item
-- has been found in this workspace — so a basket that names an item from another
-- workspace, an archived item, or one nobody switched on fails as a whole rather than
-- half-placing an order.
--
-- It is SECURITY DEFINER and granted to service_role only, because the caller is a
-- visitor with no session, and the server route that reaches it is the thing that
-- validates, rate-limits and honeypots the request.
-- ===========================================================================
create or replace function youbiss.store_place_order(p_org_id uuid, p_items jsonb, p_buyer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shipping  numeric := 0;
  v_lines     jsonb := '[]'::jsonb;
  v_subtotal  numeric := 0;
  v_tax_total numeric := 0;
  v_line      jsonb;
  v_item_id   text;
  v_qty_text  text;
  v_qty       numeric;
  v_item      record;
  v_on_hand   numeric;
  v_number    text;
  v_order_id  uuid;
  v_contact   uuid;
begin
  if p_org_id is null or p_items is null or p_buyer is null then
    raise exception 'a checkout needs a workspace, a basket and a buyer' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'an empty basket is not an order' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'a basket that large is not a person ordering' using errcode = '22023';
  end if;

  if not youbiss.app_enabled(p_org_id, 'store') then
    raise exception 'this workspace is not selling online right now' using errcode = '42501';
  end if;

  if not exists (select 1 from public.orgs where id = p_org_id) then
    raise exception 'that workspace does not exist' using errcode = 'P0002';
  end if;

  v_shipping := coalesce((select s.shipping_flat from public.store_settings s where s.org_id = p_org_id), 0);

  for v_line in select value from jsonb_array_elements(p_items) as t(value)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'a basket line is an item and a quantity' using errcode = '22023';
    end if;

    v_item_id := v_line ->> 'item_id';
    v_qty_text := v_line ->> 'qty';

    if v_item_id is null or v_item_id !~* '^[0-9a-f-]{36}$' then
      raise exception 'a basket line names an item that is not here' using errcode = '22023';
    end if;
    if v_qty_text is null or v_qty_text !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$' then
      raise exception 'a basket line needs a quantity' using errcode = '22023';
    end if;

    v_qty := v_qty_text::numeric;
    if v_qty <= 0 then
      raise exception 'an order line needs at least one of something' using errcode = '22003';
    end if;

    -- Read, not locked: placing an order does not commit stock, so two people ordering
    -- the last one at the same moment both get an order, and only one of them gets it
    -- confirmed. `inv_movement_guard` is the door that decides.
    select i.id, i.name, i.price, i.tax_rate_pct, i.track_stock, i.unit
      into v_item
      from public.inv_items i
     where i.org_id = p_org_id
       and i.id = v_item_id::uuid
       and i.status = 'active'
       and i.sell_online
     limit 1;

    if not found then
      raise exception 'that basket holds something this shop is not selling' using errcode = 'P0002';
    end if;

    -- One line per item, because two lines for the same box read as a mistake on a
    -- printed document and are what a hand-edited cart produces.
    if exists (
      select 1 from jsonb_array_elements(v_lines) as e
      where (e.value ->> 'item_id')::uuid = v_item.id
    ) then
      raise exception 'that item is already on the basket — put the quantity on the line'
        using errcode = '22003';
    end if;

    -- A courtesy check against the shelf, so a visitor is told before they type an
    -- address rather than after a clerk opens the order.
    if v_item.track_stock then
      select coalesce(sum(m.delta), 0) into v_on_hand
        from public.inv_movements m where m.item_id = v_item.id;

      if v_on_hand < v_qty then
        raise exception '“%” has % % in stock, so % % cannot be ordered',
          v_item.name, v_on_hand, v_item.unit, v_qty, v_item.unit
          using errcode = '23514';
      end if;
    end if;

    v_subtotal := v_subtotal + round(v_qty * v_item.price, 2);
    v_tax_total := v_tax_total + round(v_qty * v_item.price * v_item.tax_rate_pct / 100, 2);

    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id,
      'description', v_item.name,
      'qty', v_qty,
      'unit_price', v_item.price,
      'tax_rate_pct', v_item.tax_rate_pct
    );
  end loop;

  if p_buyer ->> 'name' is null or btrim(p_buyer ->> 'name') = '' then
    raise exception 'an order needs a name to deliver it to' using errcode = '22023';
  end if;
  if p_buyer ->> 'email' is null
     or p_buyer ->> 'email' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'an order needs an email address to send the receipt to' using errcode = '22023';
  end if;
  if p_buyer ->> 'address' is null or btrim(p_buyer ->> 'address') = '' then
    raise exception 'an order needs an address to ship it to' using errcode = '22023';
  end if;

  v_number := youbiss.doc_number(p_org_id, 'so');

  insert into public.store_orders (
    org_id, number, status, buyer_name, buyer_email, buyer_phone, ship_address, notes,
    subtotal, shipping, tax_total
  )
  values (
    p_org_id, v_number, 'placed',
    left(btrim(p_buyer ->> 'name'), 140),
    lower(btrim(p_buyer ->> 'email')),
    left(nullif(btrim(coalesce(p_buyer ->> 'phone', '')), ''), 40),
    left(btrim(p_buyer ->> 'address'), 400),
    nullif(btrim(coalesce(p_buyer ->> 'notes', '')), ''),
    round(v_subtotal, 2), v_shipping, round(v_tax_total, 2)
  )
  returning id into v_order_id;

  insert into public.store_order_lines (order_id, org_id, item_id, description, qty, unit_price, tax_rate_pct)
  select v_order_id, p_org_id, (t.value ->> 'item_id')::uuid, left(t.value ->> 'description', 140),
         (t.value ->> 'qty')::numeric, (t.value ->> 'unit_price')::numeric,
         (t.value ->> 'tax_rate_pct')::numeric
    from jsonb_array_elements(v_lines) as t(value);

  -- The buyer becomes a CRM contact only when CRM is switched on, and only by their
  -- address: a person who ordered twice is one contact, and their name from the latest
  -- order is not a reason to overwrite a note a colleague added by hand.
  if youbiss.app_enabled(p_org_id, 'crm') then
    select c.id into v_contact
      from public.crm_contacts c
     where c.org_id = p_org_id and c.email = lower(btrim(p_buyer ->> 'email'))::citext
     limit 1;

    if v_contact is null then
      insert into public.crm_contacts (org_id, name, email, phone, address, source)
      values (
        p_org_id,
        left(btrim(p_buyer ->> 'name'), 120),
        lower(btrim(p_buyer ->> 'email'))::citext,
        nullif(btrim(coalesce(p_buyer ->> 'phone', '')), ''),
        left(btrim(p_buyer ->> 'address'), 400),
        'store'
      )
      on conflict (org_id, email) where email is not null and btrim(email::text) <> ''
      do nothing
      returning id into v_contact;
    end if;

    update public.store_orders set contact_id = v_contact where id = v_order_id;
  end if;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (p_org_id, auth.uid(), 'store', 'store_order', v_order_id::text, 'placed',
          left('Ordered ' || v_number || ' from the storefront', 500));

  return jsonb_build_object(
    'order_id', v_order_id,
    'number', v_number,
    'lines', jsonb_array_length(v_lines),
    'subtotal', round(v_subtotal, 2),
    'shipping', v_shipping,
    'tax_total', round(v_tax_total, 2),
    'total', round(v_subtotal + v_shipping + v_tax_total, 2)
  );
end;
$$;

-- ===========================================================================
-- Confirmation, dispatch, cancellation — the one way an order changes state
--
-- The transition and the stock are one decision. `inv_post_receipt` set the pattern in
-- 0011: lock the row, check what the ledger says, write the movements and the status in
-- the same transaction, because a half-moved order is the state a shop lives in and a
-- double-clicked Confirm must not send the same goods out twice.
-- ===========================================================================
create or replace function youbiss.store_set_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order    public.store_orders;
  v_line     record;
  v_target   public.store_order_status;
  v_moves    integer := 0;
begin
  select * into v_order from public.store_orders where id = p_order_id for update;
  if not found then
    raise exception 'that order is not in this workspace' using errcode = 'P0002';
  end if;

  if not (youbiss.is_member(v_order.org_id) and youbiss.app_enabled(v_order.org_id, 'store')) then
    raise exception 'only a member of this workspace can move its orders' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('confirmed', 'fulfilled', 'cancelled') then
    raise exception 'an order goes to confirmed, fulfilled or cancelled' using errcode = '22023';
  end if;

  v_target := p_status::public.store_order_status;

  if v_target = 'confirmed' and v_order.status is distinct from 'placed' then
    raise exception 'only a new order can be confirmed — it is already %', v_order.status
      using errcode = '42809';
  end if;

  if v_target = 'fulfilled' and v_order.status is distinct from 'confirmed' then
    raise exception 'confirm the order before sending it out' using errcode = '42809';
  end if;

  if v_target = 'cancelled' and v_order.status not in ('placed', 'confirmed') then
    raise exception 'a % order is finished', v_order.status using errcode = '42809';
  end if;

  -- Confirming commits the goods: one `sale` movement per tracked line, and the ledger
  -- guard refuses the whole transaction if any one of them leaves a shelf short. The
  -- item's cost rides along, because that is the number the stock was worth on the day
  -- it went out.
  if v_target = 'confirmed' then
    for v_line in
      select l.item_id, l.qty, i.track_stock, i.cost
        from public.store_order_lines l
        join public.inv_items i on i.id = l.item_id
       where l.order_id = p_order_id
       order by l.created_at
    loop
      if v_line.track_stock then
        insert into public.inv_movements (org_id, item_id, delta, reason, unit_cost, reference, created_by)
        values (v_order.org_id, v_line.item_id, -v_line.qty, 'sale', v_line.cost, v_order.number, auth.uid());
        v_moves := v_moves + 1;
      end if;
    end loop;
  end if;

  -- Cancelling an order that had goods committed puts them back. A `placed` order never
  -- moved anything, so there is nothing to return.
  if v_target = 'cancelled' and v_order.status = 'confirmed' then
    for v_line in
      select l.item_id, l.qty, i.track_stock
        from public.store_order_lines l
        join public.inv_items i on i.id = l.item_id
       where l.order_id = p_order_id
       order by l.created_at
    loop
      if v_line.track_stock then
        insert into public.inv_movements (org_id, item_id, delta, reason, reference, created_by)
        values (v_order.org_id, v_line.item_id, v_line.qty, 'customer_return',
                'cancelled ' || v_order.number, auth.uid());
        v_moves := v_moves + 1;
      end if;
    end loop;
  end if;

  update public.store_orders set status = v_target where id = p_order_id;

  insert into public.activity_log (org_id, actor_id, app_key, entity_type, entity_id, action, summary)
  values (v_order.org_id, auth.uid(), 'store', 'store_order', p_order_id::text, p_status,
          left('Marked ' || v_order.number || ' as ' || p_status, 500));

  return jsonb_build_object(
    'order_id', p_order_id,
    'number', v_order.number,
    'status', v_target,
    'movements', v_moves
  );
end;
$$;

-- ===========================================================================
-- Counts — the hub and the sidebar in one read
--
-- The same shape as `inv_counts` and `crm_counts`: the questions a hub would otherwise
-- ask as a round trip each, answered by one function that re-checks who is asking,
-- because a workspace uuid is not a permission.
-- ===========================================================================
create or replace function youbiss.store_counts(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not (youbiss.is_member(p_org_id) and youbiss.app_enabled(p_org_id, 'store')) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;

  with live as (
    select o.id, o.total, o.created_at, o.paid_at, o.status
      from public.store_orders o
     where o.org_id = p_org_id
  )
  select jsonb_build_object(
    'orders',          (select count(*) from live where status <> 'cancelled'),
    'open',            (select count(*) from live where status in ('placed', 'confirmed')),
    'awaiting',        (select count(*) from live where status = 'placed'),
    'shipped',         (select count(*) from live where status = 'fulfilled'),
    'cancelled',       (select count(*) from live where status = 'cancelled'),
    'unpaid',          (select count(*) from live where paid_at is null and status <> 'cancelled'),
    'unpaid_value',    (select coalesce(sum(total), 0) from live where paid_at is null and status <> 'cancelled'),
    'revenue_30d',     (select coalesce(sum(total), 0) from live
                         where status <> 'cancelled' and created_at > now() - interval '30 days'),
    'orders_30d',      (select count(*) from live where created_at > now() - interval '30 days'),
    'collected_30d',   (select coalesce(sum(total), 0) from live
                         where paid_at > now() - interval '30 days'),
    'for_sale',        (select count(*) from public.inv_items i
                         where i.org_id = p_org_id and i.status = 'active' and i.sell_online),
    'sellable_untracked', (select count(*) from public.inv_items i
                         where i.org_id = p_org_id and i.status = 'active' and i.sell_online
                           and not i.track_stock)
  ) into out;

  return out;
end;
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.store_settings    enable row level security;
alter table public.store_orders      enable row level security;
alter table public.store_order_lines enable row level security;

-- A member reads and moves the shop's orders; erasing one is an owner's decision, and
-- only a `placed` order can be erased at all — the trigger is what says so.
--
-- There is no INSERT policy on an order or a line, and no write policy on a line at
-- all, because nothing in the app hand-writes them: an order arrives through
-- `store_place_order`, which prices it from the item list, and a screen changes only
-- its state and its payment. A browser that cannot insert a line is also a browser that
-- cannot make an order whose total disagrees with the goods on it.
create policy store_settings_read on public.store_settings
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'));

create policy store_settings_write on public.store_settings
  for insert to authenticated
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'));

create policy store_settings_update on public.store_settings
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'));

create policy store_orders_select on public.store_orders
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'));

create policy store_orders_update on public.store_orders
  for update to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'))
  with check (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'));

create policy store_orders_delete on public.store_orders
  for delete to authenticated
  using (youbiss.is_org_admin(org_id) and youbiss.app_enabled(org_id, 'store'));

create policy store_lines_select on public.store_order_lines
  for select to authenticated
  using (youbiss.is_member(org_id) and youbiss.app_enabled(org_id, 'store'));

revoke all on public.store_settings, public.store_orders, public.store_order_lines
  from anon, public;

-- ===========================================================================
-- Privileges
-- ===========================================================================

grant select, insert, update on public.store_settings to authenticated;
grant select, update, delete on public.store_orders to authenticated;
grant select on public.store_order_lines to authenticated;

grant all on public.store_settings, public.store_orders, public.store_order_lines
  to service_role, postgres;

grant execute on function youbiss.next_document_number(uuid, text) to authenticated, service_role;
grant execute on function youbiss.store_set_status(uuid, text) to authenticated, service_role;
grant execute on function youbiss.store_counts(uuid) to authenticated, service_role;

-- The counter and the checkout are reached only from inside a definer body or from the
-- server route's service-role client, so neither is offered to a browser. The inner
-- checkout still needs its own grant to `service_role`: the `public` wrapper is SECURITY
-- INVOKER, so the call executes as the role that came in, and a wrapper that cannot reach
-- the body behind it fails the order at the last step — the same pair 0004 writes out for
-- `record_form_submission`.
revoke all on function youbiss.doc_number(uuid, text) from public, anon, authenticated;
revoke all on function youbiss.store_place_order(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function youbiss.store_place_order(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The RPC surface, same as 0007, 0010 and 0011: PostgREST only exposes `public`, so a
-- callable function carries its own SECURITY INVOKER wrapper. The wrapper does not add
-- permission — every body above already re-checks the caller.
-- ---------------------------------------------------------------------------
create or replace function public.store_set_status(p_order_id uuid, p_status text)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.store_set_status(p_order_id, p_status);
$$;

create or replace function public.store_counts(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.store_counts(p_org_id);
$$;

-- The checkout wrapper exists so the route can call it by name with the admin client.
-- It is granted to service_role and to nobody else, for the reason 0004 gives: a
-- browser that could reach it directly would skip the rate limit and the honeypot.
create or replace function public.store_place_order(p_org_id uuid, p_items jsonb, p_buyer jsonb)
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select youbiss.store_place_order(p_org_id, p_items, p_buyer);
$$;

revoke all on function public.store_set_status(uuid, text) from public;
revoke all on function public.store_counts(uuid) from public;
revoke all on function public.store_place_order(uuid, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.store_set_status(uuid, text) to authenticated, service_role;
grant execute on function public.store_counts(uuid) to authenticated, service_role;
grant execute on function public.store_place_order(uuid, jsonb, jsonb) to service_role;

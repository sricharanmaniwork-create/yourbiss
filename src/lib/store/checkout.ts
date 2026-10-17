import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/mail';
import { mailBase, storeOrderConfirmation, teamNewOrder } from '@/lib/mail/templates';
import { formatAmount, formatDateInZone, formatInZone } from '@/lib/utils';
import type { InvItem, StoreOrder, StoreOrderLine } from '@/lib/types';

/**
 * The storefront's own reads and the only road into `store_orders`.
 *
 * A cart is a list of intentions, not a set of numbers. Everything a visitor sends is
 * an item id and a quantity; prices, tax rates, whether the item is on sale at all and
 * the delivery fee are read back from this workspace by `store_place_order`, which is
 * the single writer of an order. So the total shown in a basket is the shop's answer to
 * "what would this cost", and the total on the document is the shop's answer to "what
 * did it cost" — and only the second one is kept.
 *
 * Mail is a delivery after the fact. An order whose receipt could not be sent is still
 * an order, so nothing in `notifyOrder` is allowed to fail the checkout.
 */

export interface Storefront {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  currency: string;
  locale: string;
  timezone: string;
  storeEnabled: boolean;
  inventoryEnabled: boolean;
  shipping_flat: number;
  checkout_note: string | null;
}

export interface BasketLine {
  item_id: string;
  qty: number;
}

export interface PlacedOrder {
  order: StoreOrder;
  lines: StoreOrderLine[];
}

/** Thrown when the database refused the basket. `message` is already written for the visitor. */
export class PlaceRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceRejected';
  }
}

export async function findStorefront(orgId: string): Promise<Storefront | null> {
  if (!orgId) return null;
  const supabase = createAdminClient();

  const [orgResult, switches, settingsResult] = await Promise.all([
    supabase
      .from('orgs')
      .select('id, name, slug, owner_id, currency, locale, timezone')
      .eq('id', orgId)
      .maybeSingle(),
    supabase.from('org_apps').select('app_key, status').eq('org_id', orgId),
    // Best-effort, for the reason 0011 gives for the product list: a deploy can arrive
    // before the migration does, and a shop that cannot read its delivery fee is not a
    // reason to tell a visitor their basket is broken.
    supabase.from('store_settings').select('shipping_flat, checkout_note').eq('org_id', orgId).maybeSingle(),
  ]);

  if (orgResult.error) throw new Error(orgResult.error.message);
  if (switches.error) throw new Error(switches.error.message);
  if (!orgResult.data) return null;

  const enabled = new Set(
    ((switches.data ?? []) as { app_key: string; status: string }[])
      .filter((row) => row.status === 'enabled')
      .map((row) => row.app_key),
  );

  const settings = (settingsResult.data ?? null) as { shipping_flat: string | number; checkout_note: string | null } | null;
  const org = orgResult.data as {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    currency: string;
    locale: string;
    timezone: string;
  };

  return {
    ...org,
    storeEnabled: enabled.has('store'),
    inventoryEnabled: enabled.has('inventory'),
    shipping_flat: Number(settings?.shipping_flat ?? 0),
    checkout_note: settings?.checkout_note ?? null,
  };
}

export async function placeOrder(input: {
  storefront: Storefront;
  items: BasketLine[];
  buyer: { name: string; email: string; phone: string; address: string; notes: string };
}): Promise<PlacedOrder> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('store_place_order', {
    p_org_id: input.storefront.id,
    p_items: input.items.map((line) => ({ item_id: line.item_id, qty: line.qty })),
    p_buyer: {
      name: input.buyer.name,
      email: input.buyer.email,
      phone: input.buyer.phone,
      address: input.buyer.address,
      notes: input.buyer.notes,
    },
  });

  if (error) throw new PlaceRejected(describe(error.code, error.message));

  const placed = data as { order_id: string } | null;
  if (!placed?.order_id) throw new PlaceRejected('Your order could not be recorded. Please try again.');

  return readOrder(placed.order_id);
}

/**
 * The order and its lines as the database wrote them — never as the browser sent them.
 *
 * The items come along because a receipt that says "3 × Widget" needs the unit the
 * workspace set on the item, and reading it from the browser would be reading the
 * shopper's guess about somebody else's catalogue.
 */
async function readOrder(orderId: string): Promise<PlacedOrder> {
  const supabase = createAdminClient();
  const [orderResult, linesResult] = await Promise.all([
    supabase.from('store_orders').select('*').eq('id', orderId).maybeSingle(),
    supabase.from('store_order_lines').select('*').eq('order_id', orderId).order('created_at'),
  ]);
  if (orderResult.error) throw new Error(orderResult.error.message);
  if (linesResult.error) throw new Error(linesResult.error.message);
  if (!orderResult.data) throw new PlaceRejected('Your order could not be recorded. Please try again.');

  const lines = (linesResult.data ?? []) as unknown as StoreOrderLine[];
  const itemIds = [...new Set(lines.map((line) => line.item_id))];

  let items = new Map<string, Pick<InvItem, 'id' | 'name' | 'unit' | 'sku' | 'track_stock' | 'sell_online'>>();
  if (itemIds.length > 0) {
    const itemsResult = await supabase
      .from('inv_items')
      .select('id, name, unit, sku, track_stock, sell_online')
      .in('id', itemIds);
    if (itemsResult.error) throw new Error(itemsResult.error.message);
    items = new Map(
      ((itemsResult.data ?? []) as unknown as Pick<InvItem, 'id' | 'name' | 'unit' | 'sku' | 'track_stock' | 'sell_online'>[]).map(
        (item) => [item.id, item],
      ),
    );
  }

  return {
    order: orderResult.data as unknown as StoreOrder,
    lines: lines.map((line) => ({ ...line, item: items.get(line.item_id) ?? null })),
  };
}

function describe(code: string | undefined, message: string): string {
  if (code === '23514') return message;
  if (code === 'P0002') return 'Something in that basket is no longer on sale. Take another look and try again.';
  if (code === '42501') return 'This shop is not taking orders right now.';
  if (code === '22023' || code === '22003') return message;
  console.error('[yourbiss] storefront checkout refused', { code, message });
  return 'Your order could not be placed. Please try again.';
}

// --- receipts ----------------------------------------------------------------

export function money(storefront: Storefront, value: number): string {
  return formatAmount(value, storefront.currency, storefront.locale);
}

/** The one sentence a basket and a receipt both use, so they cannot disagree out loud. */
export function lineLabel(line: StoreOrderLine, unit: string): string {
  return `${trimNumber(line.qty)} ${unit} × ${line.description}`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * The buyer's receipt and the owner's copy.
 *
 * The owner is who a new order reaches, because confirming it is somebody's job and an
 * order that nobody was told about is how a shop becomes famous for not replying.
 */
export async function notifyOrder(input: {
  storefront: Storefront;
  placed: PlacedOrder;
  origin: string;
}): Promise<{ receipt: boolean; notice: boolean; error?: string }> {
  const { storefront, placed } = input;
  const base = mailBase(storefront.name);
  const total = money(storefront, Number(placed.order.total));

  const lines = placed.lines.map((line) => ({
    label: lineLabel(line, line.item?.unit ?? 'pcs'),
    amount: money(storefront, Number(line.total)),
  }));

  const placedAt = `${formatDateInZone(placed.order.created_at, storefront.timezone)} · ${formatInZone(
    placed.order.created_at,
    storefront.timezone,
    { hour: '2-digit', minute: '2-digit' },
  )}`;

  let receipt = false;
  let notice = false;
  let error: string | undefined;

  const buyerMail = storeOrderConfirmation(base, {
    customerName: placed.order.buyer_name,
    number: placed.order.number,
    placedAt,
    lines,
    subtotal: money(storefront, Number(placed.order.subtotal)),
    shipping: money(storefront, Number(placed.order.shipping)),
    taxTotal: money(storefront, Number(placed.order.tax_total)),
    total,
    address: placed.order.ship_address,
    note: placed.order.notes ?? undefined,
    instructions: storefront.checkout_note ?? undefined,
  });

  const receiptOutcome = await sendMail({
    orgId: storefront.id,
    to: placed.order.buyer_email,
    mail: buyerMail,
    template: 'store_order_confirmation',
    relatedType: 'store_order',
    relatedId: placed.order.id,
    tokens: {
      order_number: placed.order.number,
      customer_name: placed.order.buyer_name,
      total,
      lines: lines.map((line) => `${line.label}: ${line.amount}`).join('\n'),
      address: placed.order.ship_address,
      org_name: storefront.name,
    },
  });
  receipt = receiptOutcome.delivered;
  if (!receipt && receiptOutcome.error) error = receiptOutcome.error;

  const owner = await ownerEmail(storefront.owner_id);
  if (owner) {
    const teamMail = teamNewOrder(base, {
      orgName: storefront.name,
      number: placed.order.number,
      customerName: placed.order.buyer_name,
      customerEmail: placed.order.buyer_email,
      total,
      lines: lines.map((line) => `${line.label} — ${line.amount}`).join('\n'),
      address: placed.order.ship_address,
      orderUrl: `${input.origin}/app/store/orders/${placed.order.id}`,
    });

    const noticeOutcome = await sendMail({
      orgId: storefront.id,
      to: owner,
      mail: teamMail,
      template: 'team_new_order',
      relatedType: 'store_order',
      relatedId: placed.order.id,
      tokens: {
        order_number: placed.order.number,
        customer_name: placed.order.buyer_name,
        customer_email: placed.order.buyer_email,
        total,
        order_url: `${input.origin}/app/store/orders/${placed.order.id}`,
        org_name: storefront.name,
      },
    });
    notice = noticeOutcome.delivered;
    if (!notice && noticeOutcome.error) error = noticeOutcome.error;
  }

  return { receipt, notice, error };
}

async function ownerEmail(userId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('user_profiles').select('email').eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  return (data as { email: string | null }).email ?? null;
}

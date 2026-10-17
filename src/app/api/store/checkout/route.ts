import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { findStorefront, notifyOrder, PlaceRejected, placeOrder } from '@/lib/store/checkout';
import { requestOrigin } from '@/lib/app-url';
import { clientKey, consume, rateHeaders } from '@/lib/rate-limit';

/**
 * Where a storefront basket becomes an order document.
 *
 * The cart is a list of intentions, so this route accepts item ids and quantities and
 * nothing else. A price, a tax rate, a delivery fee or a total sent from the browser is
 * refused by `parseBody` before it is read, because the numbers on an order belong to the
 * workspace, not the shopper: `store_place_order` re-reads every item from
 * `inv_items` under `status = 'active' and sell_online`, applies the item's own tax rate
 * and the shop's own shipping fee, and writes the document in one transaction. That is
 * also what makes an archived or unlisted item impossible to buy by guessing at an old
 * cart.
 *
 * `store_orders` and `store_order_lines` have no INSERT policy for any client role, which
 * is what makes this route the only door. The service-role client reaches the RPC, and the
 * rows it writes are constrained by the function's own validation rather than a policy this
 * file would have to remember.
 *
 * Payment is deliberately absent. There is no gateway here, so an order lands as `placed`
 * with `paid_at` empty and the owner marks it paid in Store once the money actually moves.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
/** The same ceiling `store_place_order` puts on a basket, so the route never accepts a cart the function will refuse. */
const MAX_LINES = 100;

function bad(message: string, status = 400, fields?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message, fields: fields ?? {} }, { status });
}

/**
 * Same-origin only, exactly as a form submit and a booking are. The cart block lives on a
 * published page of this same app, so a browser always arrives with a matching Origin, and
 * one that is present but foreign is a forged post while an absent one is a script.
 */
function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get('host')?.toLowerCase();
  if (!host) return false;
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Deliberately narrow: no field in here can hold money. */
const checkoutSchema = z.object({
  org: z.string().uuid('This shop is not on the list'),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid('That item is not on the list'),
        /**
         * Two decimals, because an item sold by the kilogram is a legitimate basket line
         * and `store_place_order` reads the quantity as text. Rounding here rather than
         * rejecting is deliberate: `0.1 + 0.2` in a browser is `0.30000000000000004`, and
         * handing that to a column of `numeric(14,2)` would blame the shopper for the
         * arithmetic of the cart they were handed.
         */
        qty: z.coerce
          .number()
          .gt(0, 'An order line needs at least one of something')
          .max(9999, 'That quantity is more than a basket holds')
          .transform((value) => Math.round(value * 100) / 100),
      }),
    )
    .min(1, 'There is nothing in the cart')
    .max(MAX_LINES, 'A basket that large is not a person ordering'),
  buyer: z.object({
    name: z.string().trim().min(1, 'A name is needed to deliver to').max(140),
    email: z.string().trim().min(1, 'An email address is needed').max(254).email('Enter a real email address'),
    phone: z.string().trim().max(40, 'That phone number is too long').default(''),
    address: z.string().trim().min(1, 'An address is needed to ship to').max(400),
    notes: z.string().trim().max(1000).default(''),
  }),
});

function fieldMap(issues: z.ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length >= 2 ? `${String(issue.path[0])}.${String(issue.path[1])}` : String(issue.path[0] ?? 'checkout');
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return bad('This cart can only be checked out from its own page.', 403);

  let payload: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return bad('That order is too large.', 413);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('Send the order as a JSON object.');
    payload = parsed as Record<string, unknown>;
  } catch {
    return bad('The request could not be read.');
  }

  // A filled-in field no human can see. The bot is thanked so it does not learn it was
  // caught and start again with a different basket.
  const honeypot = typeof payload.company === 'string' ? payload.company.trim() : '';
  if (honeypot !== '') {
    return NextResponse.json({ ok: true, number: null, total: 0, message: 'Thanks — your order is in.' }, { status: 201 });
  }

  const body = checkoutSchema.safeParse(payload);
  if (!body.success) return bad('Some details need another look.', 422, fieldMap(body.error.issues));

  const order = body.data;
  const limiter = await consume(`store:${order.org}:${clientKey(request.headers)}`, 10, 300);
  if (!limiter.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many orders at once. Please wait a minute and try again.' },
      { status: 429, headers: rateHeaders(limiter) },
    );
  }

  let storefront;
  try {
    storefront = await findStorefront(order.org);
  } catch (error) {
    console.error('[yourbiss] checkout could not read the shop', {
      org_id: order.org.slice(0, 16),
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('This shop could not take your order. Please try again.', 500);
  }

  if (!storefront) return bad('This shop is not open.', 404);
  // Checked here as well as inside the RPC so a shop that switched off mid-checkout gets
  // a sentence a visitor can read instead of a permission error.
  if (!storefront.storeEnabled) return bad('This shop is not taking orders right now.', 410);
  if (!storefront.inventoryEnabled) {
    return bad('This shop has turned its catalogue off, so it cannot price a basket.', 410);
  }

  let placed;
  try {
    placed = await placeOrder({ storefront, items: order.items, buyer: order.buyer });
  } catch (error) {
    if (error instanceof PlaceRejected) {
      // The database wrote these sentences and they already name the item and the quantity.
      return bad(error.message, httpStatusOf(error.message));
    }
    console.error('[yourbiss] checkout failed', {
      org_id: order.org.slice(0, 16),
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('Your order could not be recorded. Please try again.', 500);
  }

  // Mail after the fact. The order is already written, so a receipt that cannot be sent
  // is a note for the owner rather than a failed checkout — answering 500 here would
  // invite the shopper to order twice.
  const mails = await notifyOrder({ storefront, placed, origin: await requestOrigin() }).catch((error: unknown) => {
    console.error('[yourbiss] order mail failed', {
      order_id: placed.order.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { receipt: false, notice: false };
  });

  return NextResponse.json(
    {
      ok: true,
      order_id: placed.order.id,
      number: placed.order.number,
      total: Number(placed.order.total),
      currency: storefront.currency,
      message: `Order ${placed.order.number} is in. ${
        mails.receipt ? `A receipt is on its way to ${placed.order.buyer_email}.` : 'We will confirm the details by email.'
      }`,
    },
    { status: 201, headers: rateHeaders(limiter) },
  );
}

/**
 * Which HTTP status a refusal deserves. The basket was rejected by a rule inside the
 * transaction, so the message is the only thing to go on — and "the shelf is short" is a
 * conflict a shopper can resolve by editing the quantity, while "this is not a uuid" is a
 * request they cannot fix at all.
 */
function httpStatusOf(message: string): number {
  if (message.includes('in stock')) return 409;
  if (message.includes('not selling') || message.includes('no longer on sale')) return 409;
  if (message.includes('not taking orders')) return 410;
  return 422;
}

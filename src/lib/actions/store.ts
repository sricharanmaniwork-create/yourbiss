'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import type { ActionState, StoreOrderStatus } from '@/lib/types';

/**
 * Every write Store makes from a screen.
 *
 * Three things are deliberately missing, because the database does them better. An
 * order's money is not one of them in the sense that no action here can set it: an
 * order arrives only through the checkout, priced from the item list, and the guard on
 * the table refuses a change to the number, the lines or the total afterwards. What a
 * screen may do is move an order through its states, mark the money as arrived, and —
 * for an owner — erase an order that was never accepted.
 *
 * Moving a state is an RPC and not an UPDATE, because confirming also takes goods off
 * the shelf: `store_set_status` writes the ledger entries and the status in one
 * transaction, which is what makes a double-clicked Confirm empty a shelf once.
 */

const uuid = z.string().uuid();
const PAID_VIA = ['bank', 'upi', 'cash', 'card_on_delivery', 'cheque', 'other'] as const;

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function storeError(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '42501') return 'This workspace’s Store does not allow that change';
  if (error.code === '23503') return 'Something else still points at this order — cancel it instead';
  // 42809, 23514, 22023 and P0002 come from the guards with a sentence already written
  // for the person at the screen — including the ledger's own "has 4 pcs in stock, so
  // 6 pcs cannot go out", which no message invented here could improve on.
  return error.message || fallback;
}

function revalidateStore(ids: { order?: string } = {}) {
  revalidatePath('/app/store');
  revalidatePath('/app/store/orders');
  revalidatePath('/app/store/settings');
  if (ids.order) revalidatePath(`/app/store/orders/${ids.order}`);
}

/** Loads a Store row through the caller's own session, so RLS answers before we act. */
async function loadOrder(orderId: string) {
  if (!uuid.safeParse(orderId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('store_orders')
    .select('id, org_id, number, status, paid_at')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string; org_id: string; number: string; status: StoreOrderStatus; paid_at: string | null } | null) ?? null;
}

// --- storefront settings -----------------------------------------------------

const settingsSchema = z.object({
  shipping_flat: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? '0' : value),
    z.coerce.number().min(0, 'A delivery fee cannot be negative').max(100000000, 'That number is too large to charge'),
  ),
  checkout_note: z.string().trim().max(500, 'Keep the note above the checkout button short').default(''),
});

export async function saveStoreSettings(orgId: string, input: unknown): Promise<ActionState> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can set up its storefront' };

  const { error } = await supabase.from('store_settings').upsert(
    {
      org_id: orgId,
      shipping_flat: parsed.data.shipping_flat,
      checkout_note: parsed.data.checkout_note === '' ? null : parsed.data.checkout_note,
      updated_by: actor.userId,
    },
    { onConflict: 'org_id' },
  );
  if (error) return { ok: false, error: storeError(error, 'Those settings could not be saved') };

  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'store',
    entityType: 'store_settings',
    entityId: orgId,
    action: 'updated',
    summary: `Set the delivery fee to ${parsed.data.shipping_flat} and saved the checkout note`,
  });

  revalidateStore();
  return { ok: true };
}

// --- orders ------------------------------------------------------------------

const TRANSITIONS = ['confirmed', 'fulfilled', 'cancelled'] as const;

/**
 * The one way an order changes state.
 *
 * `placed` is never passed: an order arrives from the storefront and no screen can put
 * one back into the basket.
 */
export async function moveStoreOrder(orderId: string, transition: unknown): Promise<ActionState> {
  const parsed = z.enum(TRANSITIONS).safeParse(transition);
  if (!parsed.success) return { ok: false, error: 'That is not a state an order can be moved to' };

  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: 'That order is not in this workspace' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('store_set_status', { p_order_id: orderId, p_status: parsed.data });
  if (error) return { ok: false, error: storeError(error, 'That order could not be moved') };

  // The RPC wrote the ledger entries, the status and the activity row in the one
  // transaction that moved the order — logging again here would be two records of a
  // single click.
  revalidateStore({ order: orderId });
  return { ok: true };
}

const paidSchema = z.object({
  paid_via: z.enum(PAID_VIA).default('other'),
});

/**
 * Money that arrived outside the app.
 *
 * A payment is a timestamp, not a status: an order can be confirmed and unpaid, or
 * confirmed and paid, and both are true at once. There is no un-marking it — the table
 * refuses, because a payment that happened did happen.
 */
export async function markStoreOrderPaid(orderId: string, input: unknown): Promise<ActionState> {
  const parsed = paidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: 'That order is not in this workspace' };
  if (order.paid_at) return { ok: false, error: 'This order is already marked paid, and a payment that happened keeps its date' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, order.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can mark an order paid' };

  const { error } = await supabase
    .from('store_orders')
    .update({ paid_at: new Date().toISOString(), paid_via: parsed.data.paid_via })
    .eq('id', orderId);
  if (error) return { ok: false, error: storeError(error, 'That payment could not be recorded') };

  await logActivity(supabase, {
    orgId: order.org_id,
    actorId: actor.userId,
    appKey: 'store',
    entityType: 'store_order',
    entityId: orderId,
    action: 'paid',
    summary: `Marked ${order.number} paid by ${parsed.data.paid_via.replace(/_/g, ' ')}`,
  });

  revalidateStore({ order: orderId });
  return { ok: true };
}

/** Only an order nobody accepted can be erased; anything else is cancelled, and stays. */
export async function deleteStoreOrder(orderId: string): Promise<ActionState> {
  const order = await loadOrder(orderId);
  if (!order) return { ok: false, error: 'That order is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, order.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can remove an order' };

  const { error } = await supabase.from('store_orders').delete().eq('id', orderId);
  if (error) return { ok: false, error: storeError(error, 'That order could not be removed') };

  await logActivity(supabase, {
    orgId: order.org_id,
    actorId: actor.userId,
    appKey: 'store',
    entityType: 'store_order',
    entityId: orderId,
    action: 'deleted',
    summary: `Removed the unaccepted order ${order.number}`,
  });

  revalidateStore();
  return { ok: true };
}

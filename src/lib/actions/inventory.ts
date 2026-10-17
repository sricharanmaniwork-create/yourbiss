'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import type { ActionState, InvPurchaseStatus } from '@/lib/types';

/**
 * Every write Inventory makes.
 *
 * Two numbers are deliberately absent from this file, because the database computes
 * them better: what is on a shelf (`inv_movements` is the only record of it, so an
 * action that "adjusted stock" by writing a column would create a second opinion
 * about the same pile of boxes) and where a purchase order stands
 * (`inv_purchase_status_guard` decides what a transition means, and
 * `inv_post_receipt` writes the movement, the line and the order together or not at
 * all — which is what makes a double-clicked Receive put goods on the shelf once).
 *
 * The messages that come back from those guards are already written for the person
 * who triggered them — ““A4 Poster” has 45 pcs in stock, so 60 pcs cannot go out” is
 * a better sentence than anything this file could invent — so `inventoryError` passes
 * them through and only translates the codes that arrive as SQL.
 */

const uuid = z.string().uuid();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** A blank box means "no answer", which is a null and not a zero. */
const optionalCount = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.union([z.null(), z.coerce.number().min(0, 'That cannot be negative').max(100000000, 'That is more than one item can hold')]),
);

const money = z.coerce.number().min(0, 'A price cannot be less than nothing').max(99999999, 'That number is too large to count');

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Give the item a name').max(140),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/-]{1,40}$/, 'A stock code is letters, numbers and . _ / -')
    .or(z.literal(''))
    .default(''),
  kind: z.enum(['product', 'service']).default('product'),
  unit: z.string().trim().regex(/^[A-Za-z0-9./ -]{1,24}$/, 'Keep the unit short, like pcs, hrs or kg').default('pcs'),
  description: z.string().trim().max(1000).default(''),
  price: money.default(0),
  cost: money.default(0),
  track_stock: z.boolean().default(true),
  reorder_point: optionalCount.nullable().default(null),
  image_url: z
    .string()
    .trim()
    .regex(/^https:\/\/.+$/, 'Use a full https picture address')
    .or(z.literal(''))
    .default(''),
});

/** What the two table checks insist on, decided before the insert instead of refused by it. */
function itemColumns(input: z.infer<typeof itemSchema>) {
  const tracked = input.kind === 'product' ? input.track_stock : false;
  return {
    name: input.name,
    sku: input.sku === '' ? null : input.sku,
    kind: input.kind,
    unit: input.unit,
    description: input.description === '' ? null : input.description,
    price: input.price,
    cost: input.cost,
    track_stock: tracked,
    reorder_point: tracked && input.reorder_point !== null ? input.reorder_point : null,
    image_url: input.image_url === '' ? null : input.image_url,
  };
}

const movementSchema = z.object({
  // `purchase` is missing on purpose: goods against an order arrive through the
  // receipt function, which is the only road that also moves the line and the order.
  reason: z.enum(['opening', 'adjustment', 'sale', 'customer_return']),
  quantity: z.coerce.number().gt(0, 'Count at least one').max(100000000, 'That is more than one movement can hold'),
  direction: z.enum(['in', 'out']).default('in'),
  reference: z.string().trim().max(200).default(''),
  unit_cost: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.union([z.null(), money]),
  ).nullable().default(null),
});

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Give the supplier a name').max(120),
  contact: z.string().trim().max(120).default(''),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'That email address is too long')
    .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), 'Enter a real email address')
    .default(''),
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(400).default(''),
  notes: z.string().trim().max(1000).default(''),
});

const purchaseSchema = z.object({
  supplier_id: uuid,
  order_date: z.string().trim().regex(DATE, 'Use a real date'),
  expected_date: z
    .string()
    .trim()
    .regex(DATE, 'Use a real date')
    .or(z.literal(''))
    .default(''),
  notes: z.string().trim().max(1000).default(''),
});

const lineSchema = z.object({
  item_id: uuid,
  description: z.string().trim().max(140).default(''),
  qty: z.coerce.number().gt(0, 'Order at least one').max(100000000, 'That quantity is too large'),
  unit_cost: money,
});

const RECEIPT_QTY = z.coerce.number().gt(0, 'Receive at least one').max(100000000, 'That quantity is too large');

/** `''` means "nobody"; the column stores null. */
function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

function inventoryError(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '23505') return 'This workspace already has a row with that name or code';
  if (error.code === '42501') return 'This workspace’s Inventory does not allow that change';
  if (error.code === '23503') return 'Something else still points at this record — archive it instead';
  // 42809, 23514, 22003 and P0002 are raised by the guards with a sentence written for
  // the person standing in front of the screen, so the database gets the last word.
  return error.message || fallback;
}

function revalidateInventory(ids: { item?: string; supplier?: string; purchase?: string } = {}) {
  revalidatePath('/app/inventory');
  revalidatePath('/app/inventory/items');
  revalidatePath('/app/inventory/purchases');
  revalidatePath('/app/inventory/suppliers');
  if (ids.item) revalidatePath(`/app/inventory/items/${ids.item}`);
  if (ids.supplier) revalidatePath(`/app/inventory/suppliers/${ids.supplier}`);
  if (ids.purchase) revalidatePath(`/app/inventory/purchases/${ids.purchase}`);
}

/** Loads an Inventory row through the caller's own session, so RLS answers before we act. */
async function load<T extends object>(table: string, id: string, columns: string): Promise<T | null> {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as T | null) ?? null;
}

interface OrgRef {
  id: string;
  org_id: string;
}

// --- items -------------------------------------------------------------------

export async function createInvItem(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add an item' };

  const { data, error } = await supabase
    .from('inv_items')
    .insert({ ...itemColumns(parsed.data), org_id: orgId, created_by: actor.userId })
    .select('id, name')
    .single();
  if (error) return { ok: false, error: inventoryError(error, 'That item could not be added') };

  const item = data as unknown as { id: string; name: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_item',
    entityId: item.id,
    action: 'created',
    summary: `Added ${item.name} to the item list`,
  });

  revalidateInventory({ item: item.id });
  return { ok: true, id: item.id };
}

export async function updateInvItem(itemId: string, input: unknown): Promise<ActionState> {
  const item = await load<OrgRef & { name: string; track_stock: boolean }>('inv_items', itemId, 'id, org_id, name, track_stock');
  if (!item) return { ok: false, error: 'That item is not in this workspace' };

  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, item.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit an item' };

  const { error } = await supabase.from('inv_items').update(itemColumns(parsed.data)).eq('id', itemId);
  if (error) return { ok: false, error: inventoryError(error, 'That item could not be saved') };

  await logActivity(supabase, {
    orgId: item.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_item',
    entityId: itemId,
    action: 'updated',
    summary: `Saved the item ${parsed.data.name}`,
  });

  revalidateInventory({ item: itemId });
  return { ok: true };
}

/**
 * Archive, or bring back. An item that has been counted is never deleted — the
 * ledger would keep pointing at a row nobody can name — so this is the road the app
 * offers, and `deleteInvItem` is the exception an admin has to mean.
 */
export async function setInvItemStatus(itemId: string, status: unknown): Promise<ActionState> {
  const parsed = z.enum(['active', 'archived']).safeParse(status);
  if (!parsed.success) return { ok: false, error: 'That is not an item status' };

  const item = await load<OrgRef & { name: string }>('inv_items', itemId, 'id, org_id, name');
  if (!item) return { ok: false, error: 'That item is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, item.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can archive an item' };

  const { error } = await supabase.from('inv_items').update({ status: parsed.data }).eq('id', itemId);
  if (error) return { ok: false, error: inventoryError(error, 'That item could not be updated') };

  await logActivity(supabase, {
    orgId: item.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_item',
    entityId: itemId,
    action: parsed.data === 'archived' ? 'archived' : 'restored',
    summary: `${parsed.data === 'archived' ? 'Archived' : 'Brought back'} ${item.name}`,
  });

  revalidateInventory({ item: itemId });
  return { ok: true };
}

export async function deleteInvItem(itemId: string): Promise<ActionState> {
  const item = await load<OrgRef & { name: string }>('inv_items', itemId, 'id, org_id, name');
  if (!item) return { ok: false, error: 'That item is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, item.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can remove an item' };

  const { error } = await supabase.from('inv_items').delete().eq('id', itemId);
  if (error) return { ok: false, error: inventoryError(error, 'That item could not be removed') };

  await logActivity(supabase, {
    orgId: item.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_item',
    entityId: itemId,
    action: 'deleted',
    summary: `Removed the item ${item.name}`,
  });

  revalidateInventory();
  return { ok: true };
}

// --- the ledger ---------------------------------------------------------------

/**
 * One entry in the stock ledger.
 *
 * The reason decides the sign, exactly as the table's own check does it: an opening
 * count and a return come in, a sale goes out, and an adjustment is the one entry
 * where the person counting the shelf chooses the direction — because that is what an
 * adjustment is for, a miscount in either direction.
 */
export async function recordInvMovement(itemId: string, input: unknown): Promise<ActionState> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const item = await load<OrgRef & { name: string; track_stock: boolean }>('inv_items', itemId, 'id, org_id, name, track_stock');
  if (!item) return { ok: false, error: 'That item is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, item.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can count its stock' };

  const going = parsed.data.reason === 'sale' ? false : parsed.data.reason === 'adjustment' ? parsed.data.direction === 'in' : true;
  const delta = going ? parsed.data.quantity : -parsed.data.quantity;

  const { error } = await supabase.from('inv_movements').insert({
    org_id: item.org_id,
    item_id: itemId,
    delta,
    reason: parsed.data.reason,
    unit_cost: parsed.data.unit_cost,
    reference: blankToNull(parsed.data.reference),
    created_by: actor.userId,
  });
  if (error) return { ok: false, error: inventoryError(error, 'That movement could not be recorded') };

  await logActivity(supabase, {
    orgId: item.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_item',
    entityId: itemId,
    action: 'movement',
    summary: `Recorded ${parsed.data.reason} of ${Math.abs(delta)} for ${item.name}`,
    meta: { delta: String(delta) },
  });

  revalidateInventory({ item: itemId });
  return { ok: true };
}

// --- suppliers ----------------------------------------------------------------

export async function createInvSupplier(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a supplier' };

  const { data, error } = await supabase
    .from('inv_suppliers')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      contact: blankToNull(parsed.data.contact),
      email: blankToNull(parsed.data.email),
      phone: blankToNull(parsed.data.phone),
      address: blankToNull(parsed.data.address),
      notes: blankToNull(parsed.data.notes),
      created_by: actor.userId,
    })
    .select('id, name')
    .single();
  if (error) return { ok: false, error: inventoryError(error, 'That supplier could not be added') };

  const supplier = data as unknown as { id: string; name: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_supplier',
    entityId: supplier.id,
    action: 'created',
    summary: `Added ${supplier.name} as a supplier`,
  });

  revalidateInventory({ supplier: supplier.id });
  return { ok: true, id: supplier.id };
}

export async function updateInvSupplier(supplierId: string, input: unknown): Promise<ActionState> {
  const supplier = await load<OrgRef & { name: string }>('inv_suppliers', supplierId, 'id, org_id, name');
  if (!supplier) return { ok: false, error: 'That supplier is not in this workspace' };

  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, supplier.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit a supplier' };

  const { error } = await supabase
    .from('inv_suppliers')
    .update({
      name: parsed.data.name,
      contact: blankToNull(parsed.data.contact),
      email: blankToNull(parsed.data.email),
      phone: blankToNull(parsed.data.phone),
      address: blankToNull(parsed.data.address),
      notes: blankToNull(parsed.data.notes),
    })
    .eq('id', supplierId);
  if (error) return { ok: false, error: inventoryError(error, 'That supplier could not be saved') };

  revalidateInventory({ supplier: supplierId });
  return { ok: true };
}

export async function setInvSupplierStatus(supplierId: string, status: unknown): Promise<ActionState> {
  const parsed = z.enum(['active', 'archived']).safeParse(status);
  if (!parsed.success) return { ok: false, error: 'That is not a supplier status' };

  const supplier = await load<OrgRef & { name: string }>('inv_suppliers', supplierId, 'id, org_id, name');
  if (!supplier) return { ok: false, error: 'That supplier is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, supplier.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can archive a supplier' };

  const { error } = await supabase.from('inv_suppliers').update({ status: parsed.data }).eq('id', supplierId);
  if (error) return { ok: false, error: inventoryError(error, 'That supplier could not be updated') };

  revalidateInventory({ supplier: supplierId });
  return { ok: true };
}

export async function deleteInvSupplier(supplierId: string): Promise<ActionState> {
  const supplier = await load<OrgRef & { name: string }>('inv_suppliers', supplierId, 'id, org_id, name');
  if (!supplier) return { ok: false, error: 'That supplier is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, supplier.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can remove a supplier' };

  // An order points at this supplier with `on delete restrict`, so a workspace with a
  // purchase history hears "something else still points at this record". That is the
  // correct answer: a supplier a document names is not a row to be cleared away.
  const { error } = await supabase.from('inv_suppliers').delete().eq('id', supplierId);
  if (error) return { ok: false, error: inventoryError(error, 'That supplier could not be removed') };

  await logActivity(supabase, {
    orgId: supplier.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_supplier',
    entityId: supplierId,
    action: 'deleted',
    summary: `Removed the supplier ${supplier.name}`,
  });

  revalidateInventory();
  return { ok: true };
}

// --- purchase orders ------------------------------------------------------------

/**
 * A new order, as a draft with nothing on it.
 *
 * The number is minted by the database — `next_document_number` takes it from a
 * counter no browser can read, so two people writing an order in the same minute get
 * two references — and the lines are added on the order's own screen, where each one
 * can be checked against the item it names before the order leaves the building.
 */
export async function createInvPurchase(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can raise a purchase order' };

  const { data: numbered, error: numberError } = await supabase.rpc('next_document_number', {
    p_org_id: orgId,
    p_kind: 'purchase',
  });
  if (numberError) return { ok: false, error: inventoryError(numberError, 'The order number could not be drawn') };
  const number = String(numbered ?? '');
  if (number === '') return { ok: false, error: 'The order number could not be drawn' };

  const { data, error } = await supabase
    .from('inv_purchases')
    .insert({
      org_id: orgId,
      number,
      supplier_id: parsed.data.supplier_id,
      order_date: parsed.data.order_date,
      expected_date: blankToNull(parsed.data.expected_date),
      notes: blankToNull(parsed.data.notes),
      created_by: actor.userId,
    })
    .select('id, number')
    .single();
  if (error) return { ok: false, error: inventoryError(error, 'That order could not be started') };

  const purchase = data as unknown as { id: string; number: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_purchase',
    entityId: purchase.id,
    action: 'created',
    summary: `Started purchase order ${purchase.number}`,
  });

  revalidateInventory({ purchase: purchase.id });
  return { ok: true, id: purchase.id };
}

export async function updateInvPurchase(purchaseId: string, input: unknown): Promise<ActionState> {
  const purchase = await load<OrgRef & { status: InvPurchaseStatus; number: string }>(
    'inv_purchases',
    purchaseId,
    'id, org_id, status, number',
  );
  if (!purchase) return { ok: false, error: 'That order is not in this workspace' };
  if (purchase.status !== 'draft') {
    return { ok: false, error: `${purchase.number} has been sent — a supplier holds a copy of it` };
  }

  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, purchase.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit its orders' };

  const { error } = await supabase
    .from('inv_purchases')
    .update({
      supplier_id: parsed.data.supplier_id,
      order_date: parsed.data.order_date,
      expected_date: blankToNull(parsed.data.expected_date),
      notes: blankToNull(parsed.data.notes),
    })
    .eq('id', purchaseId);
  if (error) return { ok: false, error: inventoryError(error, 'That order could not be saved') };

  revalidateInventory({ purchase: purchaseId });
  return { ok: true };
}

/**
 * Send or call off. There is no status dropdown anywhere in this app because the
 * state machine is the point: an order leaves draft only with lines on it, and a
 * finished one never comes back, which is what the trigger decides.
 */
export async function moveInvPurchase(purchaseId: string, transition: unknown): Promise<ActionState> {
  const key = z.enum(['send', 'cancel']).safeParse(transition);
  if (!key.success) return { ok: false, error: 'That is not a move an order can make' };
  const status: InvPurchaseStatus = key.data === 'send' ? 'ordered' : 'cancelled';

  const purchase = await load<OrgRef & { status: InvPurchaseStatus; number: string }>(
    'inv_purchases',
    purchaseId,
    'id, org_id, status, number',
  );
  if (!purchase) return { ok: false, error: 'That order is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, purchase.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can move its orders' };

  const { error } = await supabase.from('inv_purchases').update({ status }).eq('id', purchaseId);
  if (error) return { ok: false, error: inventoryError(error, 'That order could not be updated') };

  await logActivity(supabase, {
    orgId: purchase.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_purchase',
    entityId: purchaseId,
    action: status,
    summary: status === 'ordered' ? `Sent ${purchase.number} to the supplier` : `Called off ${purchase.number}`,
  });

  revalidateInventory({ purchase: purchaseId });
  return { ok: true };
}

export async function deleteInvPurchase(purchaseId: string): Promise<ActionState> {
  const purchase = await load<OrgRef & { number: string }>('inv_purchases', purchaseId, 'id, org_id, number');
  if (!purchase) return { ok: false, error: 'That order is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, purchase.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can remove a purchase order' };

  const { error } = await supabase.from('inv_purchases').delete().eq('id', purchaseId);
  if (error) return { ok: false, error: inventoryError(error, 'That order could not be removed') };

  await logActivity(supabase, {
    orgId: purchase.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_purchase',
    entityId: purchaseId,
    action: 'deleted',
    summary: `Removed purchase order ${purchase.number}`,
  });

  revalidateInventory();
  return { ok: true };
}

// --- lines and receiving ------------------------------------------------------------

/**
 * A line on a draft order.
 *
 * The description defaults to what the item is called today and the cost to what it
 * cost last, because those are the two answers a person filling in an order means —
 * and both are then stored on the line, so a rename next month does not rewrite a
 * document somebody already sent.
 */
export async function addInvLine(purchaseId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const purchase = await load<OrgRef & { status: InvPurchaseStatus; number: string }>(
    'inv_purchases',
    purchaseId,
    'id, org_id, status, number',
  );
  if (!purchase) return { ok: false, error: 'That order is not in this workspace' };

  const item = await load<OrgRef & { name: string; cost: number; unit: string }>(
    'inv_items',
    parsed.data.item_id,
    'id, org_id, name, cost, unit',
  );
  if (!item) return { ok: false, error: 'That item is not in this workspace' };
  if (item.org_id !== purchase.org_id) return { ok: false, error: 'That item belongs to another workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, purchase.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can write its orders' };

  const { data, error } = await supabase
    .from('inv_purchase_lines')
    .insert({
      purchase_id: purchaseId,
      org_id: purchase.org_id,
      item_id: parsed.data.item_id,
      description: parsed.data.description === '' ? `${item.name} (${item.unit})` : parsed.data.description,
      qty: parsed.data.qty,
      unit_cost: parsed.data.unit_cost,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: inventoryError(error, 'That line could not be added') };

  const line = data as unknown as { id: string };
  await logActivity(supabase, {
    orgId: purchase.org_id,
    actorId: actor.userId,
    appKey: 'inventory',
    entityType: 'inv_purchase',
    entityId: purchaseId,
    action: 'lined',
    summary: `Added ${parsed.data.qty} of ${item.name} to ${purchase.number}`,
    meta: { line_id: line.id },
  });

  revalidateInventory({ purchase: purchaseId });
  return { ok: true, id: line.id };
}

export async function updateInvLine(lineId: string, input: unknown): Promise<ActionState> {
  const line = await load<OrgRef & { purchase_id: string }>('inv_purchase_lines', lineId, 'id, org_id, purchase_id');
  if (!line) return { ok: false, error: 'That line is not in this workspace' };

  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, line.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit its orders' };

  const { error } = await supabase
    .from('inv_purchase_lines')
    .update({
      item_id: parsed.data.item_id,
      description: parsed.data.description,
      qty: parsed.data.qty,
      unit_cost: parsed.data.unit_cost,
    })
    .eq('id', lineId);
  if (error) return { ok: false, error: inventoryError(error, 'That line could not be saved') };

  revalidateInventory({ purchase: line.purchase_id });
  return { ok: true };
}

export async function deleteInvLine(lineId: string): Promise<ActionState> {
  const line = await load<OrgRef & { purchase_id: string }>('inv_purchase_lines', lineId, 'id, org_id, purchase_id');
  if (!line) return { ok: false, error: 'That line is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, line.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit its orders' };

  const { error } = await supabase.from('inv_purchase_lines').delete().eq('id', lineId);
  if (error) return { ok: false, error: inventoryError(error, 'That line could not be removed') };

  revalidateInventory({ purchase: line.purchase_id });
  return { ok: true };
}

/**
 * Count goods in against a line.
 *
 * One call, one transaction: `inv_post_receipt` writes the movement, the line's
 * received quantity and the order's status, and locks both rows on the way through.
 * Nothing here re-checks the quantity against the order, which is the function's job
 * and the reason a second screen scanning the same pallet cannot put it on the shelf
 * twice.
 */
export async function receiveInvLine(lineId: string, qty: unknown): Promise<ActionState & { status?: string }> {
  const parsed = RECEIPT_QTY.safeParse(qty);
  if (!parsed.success) return { ok: false, error: 'Type how many actually arrived' };

  const line = await load<OrgRef & { purchase_id: string }>('inv_purchase_lines', lineId, 'id, org_id, purchase_id');
  if (!line) return { ok: false, error: 'That line is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, line.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can receive its goods' };

  const { data, error } = await supabase.rpc('inv_post_receipt', { p_line_id: lineId, p_qty: parsed.data });
  if (error) return { ok: false, error: inventoryError(error, 'Those goods could not be received') };

  const result = (data ?? {}) as { status?: string; purchase_id?: string };
  revalidateInventory({ purchase: result.purchase_id ?? line.purchase_id });
  return { ok: true, status: result.status };
}

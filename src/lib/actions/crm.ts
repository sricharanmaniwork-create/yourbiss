'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import type { ActionState } from '@/lib/types';

/**
 * Every write the CRM makes.
 *
 * Two things are deliberately absent from this file, because the database does them
 * better: a deal's open/won/lost state and a lead's conversion. `moveCrmDeal` writes
 * a stage id and the trigger decides what that means for `won_at` and `lost_at`, and
 * `convertCrmLead` calls the one function allowed to stamp a lead — which is what
 * makes a double-clicked Convert button produce one contact instead of two.
 *
 * Ownership is checked twice on purpose. `assertMembership` turns a stranger into a
 * readable error instead of an empty result, and RLS is still the last word: an
 * action that guesses an `org_id` cannot reach a row it has no business touching.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const uuid = z.string().uuid();

/** Sources that name another app's row; the table requires the foreign key with them. */
const RESERVED_SOURCES = new Set(['website_form', 'booking']);

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const personSchema = z.object({
  name: z.string().trim().min(1, 'A name is needed').max(120),
  company: z.string().trim().max(120).default(''),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'That email address is too long')
    .refine((value) => value === '' || EMAIL.test(value), 'Enter a real email address')
    .default(''),
  phone: z.string().trim().max(40).default(''),
  owner_id: z.string().trim().optional().default(''),
  source: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z_]{1,32}$/, 'Use lowercase letters for a source')
    .refine((value) => !RESERVED_SOURCES.has(value), 'That source is set by the app the record came from')
    .default('manual'),
});

const leadExtraSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'unqualified']).default('new'),
  reason: z.string().trim().max(1000).default(''),
});

const contactExtraSchema = z.object({
  address: z.string().trim().max(400).default(''),
  tags: z
    .array(z.string().trim().min(1, 'A tag cannot be empty').max(32, 'Keep a tag under 32 characters'))
    .max(20, 'Twenty tags is the limit')
    .default([]),
});

const dealSchema = z.object({
  title: z.string().trim().min(1, 'Give the deal a title').max(140),
  stage_id: uuid,
  contact_id: z.string().trim().optional().default(''),
  lead_id: z.string().trim().optional().default(''),
  owner_id: z.string().trim().optional().default(''),
  amount: z.coerce.number().min(0, 'A deal cannot be worth less than nothing').max(999999999999).default(0),
  expected_close: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a real date')
    .optional()
    .default(''),
  lost_reason: z.string().trim().max(500).default(''),
});

const activitySchema = z.object({
  kind: z.enum(['note', 'call', 'meeting', 'task']),
  subject: z.string().trim().max(200).default(''),
  body: z.string().trim().max(4000).default(''),
  owner_id: z.string().trim().optional().default(''),
  due_at: z.string().trim().optional().default(''),
});

const stageSchema = z.object({
  name: z.string().trim().min(1, 'Give the stage a name').max(60),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Pick a colour'),
});

/** `''` means "nobody"; the column stores null so the owner trigger has nothing to check. */
function ownerOrNull(value: string): string | null {
  return value === '' ? null : value;
}

function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

function crmError(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '23505') return 'This workspace already has that record';
  if (error.code === '42501') return 'This workspace’s CRM does not allow that change';
  if (error.code === '23503') return 'Something else still points at this record';
  return error.message || fallback;
}

function revalidateCrm(ids: { lead?: string; contact?: string; deal?: string } = {}) {
  revalidatePath('/app/crm');
  revalidatePath('/app/crm/leads');
  revalidatePath('/app/crm/contacts');
  revalidatePath('/app/crm/deals');
  revalidatePath('/app/crm/pipeline');
  if (ids.lead) revalidatePath(`/app/crm/leads/${ids.lead}`);
  if (ids.contact) revalidatePath(`/app/crm/contacts/${ids.contact}`);
  if (ids.deal) revalidatePath(`/app/crm/deals/${ids.deal}`);
}

/** Loads a CRM row through the caller's own session, so RLS answers before we act. */
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

// --- pipeline ---------------------------------------------------------------

export async function seedCrmPipeline(orgId: string): Promise<ActionState & { added?: number }> {
  const orgIdResult = uuid.safeParse(orgId);
  if (!orgIdResult.success) return { ok: false, error: 'That workspace does not exist' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can open its pipeline' };

  const { data, error } = await supabase.rpc('crm_seed_stages', { p_org_id: orgId });
  if (error) return { ok: false, error: crmError(error, 'The pipeline could not be created') };

  const added = Number(data ?? 0);
  revalidateCrm();
  return { ok: true, added };
}

export async function createCrmStage(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can change the pipeline' };

  // One gap of ten below the lowest stage: a new stage always lands at the end,
  // and a later reorder still has room between any two of them.
  const { data: last } = await supabase
    .from('crm_stages')
    .select('position')
    .eq('org_id', orgId)
    .eq('kind', 'open')
    .order('position', { ascending: false })
    .limit(1);
  const rowsSeen = (last ?? []) as unknown as { position: number }[];
  const position = (rowsSeen[0]?.position ?? 0) + 10;

  const { data, error } = await supabase
    .from('crm_stages')
    .insert({ org_id: orgId, name: parsed.data.name, color: parsed.data.color, position, kind: 'open' })
    .select('id')
    .single();
  if (error) return { ok: false, error: crmError(error, 'That stage could not be added') };

  const stage = data as unknown as { id: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_stage',
    entityId: stage.id,
    action: 'created',
    summary: `Added “${parsed.data.name}” to the pipeline`,
  });

  revalidateCrm();
  return { ok: true, id: stage.id };
}

export async function updateCrmStage(stageId: string, input: unknown): Promise<ActionState> {
  const stage = await load<OrgRef & { kind: string }>('crm_stages', stageId, 'id, org_id, kind');
  if (!stage) return { ok: false, error: 'That stage is not in this workspace' };

  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, stage.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can change the pipeline' };

  const { error } = await supabase.from('crm_stages').update({ name: parsed.data.name, color: parsed.data.color }).eq('id', stageId);
  if (error) return { ok: false, error: crmError(error, 'That stage could not be renamed') };

  revalidateCrm();
  return { ok: true };
}

export async function deleteCrmStage(stageId: string): Promise<ActionState> {
  const stage = await load<OrgRef>('crm_stages', stageId, 'id, org_id');
  if (!stage) return { ok: false, error: 'That stage is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, stage.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can remove a pipeline stage' };

  // The trigger refuses a stage that holds deals and refuses the two closing
  // stages; a clear message here would only duplicate what it already says.
  const { error } = await supabase.from('crm_stages').delete().eq('id', stageId);
  if (error) return { ok: false, error: crmError(error, 'That stage could not be removed') };

  await logActivity(supabase, {
    orgId: stage.org_id,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_stage',
    entityId: stageId,
    action: 'deleted',
    summary: 'Removed a pipeline stage',
  });

  revalidateCrm();
  return { ok: true };
}

export async function reorderCrmStages(orgId: string, orderedIds: string[]): Promise<ActionState> {
  if (!uuid.safeParse(orgId).success || !Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { ok: false, error: 'That pipeline could not be reordered' };
  }

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can change the pipeline' };

  const { data: existing } = await supabase.from('crm_stages').select('id, kind').eq('org_id', orgId);
  const stages = (existing ?? []) as unknown as { id: string; kind: string }[];
  const openById = new Map(stages.filter((s) => s.kind === 'open').map((s) => [s.id, s]));
  if (orderedIds.some((id) => !openById.has(id))) return { ok: false, error: 'That pipeline has changed. Reload the list.' };

  let index = 0;
  for (const id of orderedIds) {
    index += 1;
    const { error } = await supabase.from('crm_stages').update({ position: index * 10 }).eq('id', id).eq('org_id', orgId);
    if (error) return { ok: false, error: crmError(error, 'That pipeline could not be reordered') };
  }

  revalidateCrm();
  return { ok: true };
}

// --- leads ------------------------------------------------------------------

export async function createCrmLead(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = personSchema.merge(leadExtraSchema).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a lead' };

  const { data, error } = await supabase
    .from('crm_leads')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      company: blankToNull(parsed.data.company),
      email: blankToNull(parsed.data.email),
      phone: blankToNull(parsed.data.phone),
      owner_id: ownerOrNull(parsed.data.owner_id),
      source: parsed.data.source,
      status: parsed.data.status,
      reason: blankToNull(parsed.data.reason),
      created_by: actor.userId,
    })
    .select('id, name')
    .single();
  if (error) return { ok: false, error: crmError(error, 'That lead could not be added') };

  const lead = data as unknown as { id: string; name: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_lead',
    entityId: lead.id,
    action: 'created',
    summary: `Added ${lead.name} as a lead`,
  });

  revalidateCrm({ lead: lead.id });
  return { ok: true, id: lead.id };
}

export async function updateCrmLead(leadId: string, input: unknown): Promise<ActionState> {
  const lead = await load<OrgRef & { status: string; name: string }>('crm_leads', leadId, 'id, org_id, status, name');
  if (!lead) return { ok: false, error: 'That lead is not in this workspace' };

  const parsed = personSchema.merge(leadExtraSchema).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, lead.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit leads' };

  // A converted lead is the record of a conversion: the identity columns are frozen
  // by the database, so the only editable thing left is who owns it and the note.
  const patch: Record<string, unknown> =
    lead.status === 'converted'
      ? { owner_id: ownerOrNull(parsed.data.owner_id), reason: blankToNull(parsed.data.reason) }
      : {
          name: parsed.data.name,
          company: blankToNull(parsed.data.company),
          email: blankToNull(parsed.data.email),
          phone: blankToNull(parsed.data.phone),
          owner_id: ownerOrNull(parsed.data.owner_id),
          status: parsed.data.status,
          reason: blankToNull(parsed.data.reason),
        };

  const { error } = await supabase.from('crm_leads').update(patch).eq('id', leadId);
  if (error) return { ok: false, error: crmError(error, 'That lead could not be saved') };

  revalidateCrm({ lead: leadId });
  return { ok: true };
}

export async function setCrmLeadStatus(leadId: string, status: unknown, reason?: unknown): Promise<ActionState> {
  const parsed = z.enum(['new', 'contacted', 'qualified', 'unqualified']).safeParse(status);
  if (!parsed.success) return { ok: false, error: 'That is not a lead status' };
  const note = z.string().trim().max(1000).safeParse(typeof reason === 'string' ? reason : '');
  if (!note.success) return { ok: false, error: 'That note is too long' };

  const lead = await load<OrgRef & { status: string; name: string }>('crm_leads', leadId, 'id, org_id, status, name');
  if (!lead) return { ok: false, error: 'That lead is not in this workspace' };
  if (lead.status === 'converted') return { ok: false, error: 'A converted lead keeps the status it was converted with' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, lead.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change a lead' };

  const { error } = await supabase
    .from('crm_leads')
    .update({ status: parsed.data, ...(note.data === '' ? {} : { reason: note.data }) })
    .eq('id', leadId);
  if (error) return { ok: false, error: crmError(error, 'That lead could not be updated') };

  revalidateCrm({ lead: leadId });
  return { ok: true };
}

export async function convertCrmLead(input: {
  leadId: string;
  stageId?: string;
  createDeal: boolean;
  dealTitle?: string;
  amount?: number;
}): Promise<ActionState & { contactId?: string; dealId?: string }> {
  const leadId = uuid.safeParse(input.leadId);
  if (!leadId.success) return { ok: false, error: 'That lead is not in this workspace' };

  const stageId = input.stageId ? uuid.safeParse(input.stageId) : null;
  if (input.createDeal && (!stageId || !stageId.success)) {
    return { ok: false, error: 'Pick the pipeline stage the new deal starts on' };
  }

  const amount = z.coerce.number().min(0).safeParse(input.amount ?? 0);
  if (!amount.success) return { ok: false, error: 'A deal cannot be worth less than nothing' };

  const supabase = await createClient();
  const lead = await load<OrgRef & { name: string }>('crm_leads', input.leadId, 'id, org_id, name');
  if (!lead) return { ok: false, error: 'That lead is not in this workspace' };
  const actor = await assertMembership(supabase, lead.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can convert a lead' };

  const { data, error } = await supabase.rpc('crm_convert_lead', {
    p_lead_id: input.leadId,
    p_stage_id: stageId?.success ? stageId.data : null,
    p_create_deal: input.createDeal,
    p_deal_title: input.dealTitle ?? null,
    p_amount: amount.data,
  });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'This workspace already has a contact with that address. Add the deal to that contact instead.' };
    }
    return { ok: false, error: crmError(error, 'That lead could not be converted') };
  }

  const first = (data ?? [])[0] as unknown as { contact_id: string; deal_id: string | null } | undefined;
  if (!first) return { ok: false, error: 'That lead could not be converted' };

  await logActivity(supabase, {
    orgId: lead.org_id,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_contact',
    entityId: first.contact_id,
    action: 'created_from_lead',
    summary: `Converted ${lead.name} into a contact`,
  });

  revalidateCrm({ lead: input.leadId, contact: first.contact_id, deal: first.deal_id ?? undefined });
  return { ok: true, contactId: first.contact_id, dealId: first.deal_id ?? undefined };
}

export async function deleteCrmLead(leadId: string): Promise<ActionState> {
  const lead = await load<OrgRef & { name: string }>('crm_leads', leadId, 'id, org_id, name');
  if (!lead) return { ok: false, error: 'That lead is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, lead.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can delete a lead' };

  const { error } = await supabase.from('crm_leads').delete().eq('id', leadId);
  if (error) return { ok: false, error: crmError(error, 'That lead could not be deleted') };

  await logActivity(supabase, {
    orgId: lead.org_id,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_lead',
    entityId: leadId,
    action: 'deleted',
    summary: `Deleted the lead “${lead.name}”`,
  });

  revalidateCrm();
  return { ok: true };
}

// --- contacts ---------------------------------------------------------------

export async function createCrmContact(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = personSchema.merge(contactExtraSchema).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a contact' };

  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      company: blankToNull(parsed.data.company),
      email: blankToNull(parsed.data.email),
      phone: blankToNull(parsed.data.phone),
      owner_id: ownerOrNull(parsed.data.owner_id),
      source: parsed.data.source,
      address: blankToNull(parsed.data.address),
      tags: [...new Set(parsed.data.tags)],
      created_by: actor.userId,
    })
    .select('id, name')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'This workspace already has a contact with that address' };
    return { ok: false, error: crmError(error, 'That contact could not be added') };
  }

  const contact = data as unknown as { id: string; name: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_contact',
    entityId: contact.id,
    action: 'created',
    summary: `Added ${contact.name} as a contact`,
  });

  revalidateCrm({ contact: contact.id });
  return { ok: true, id: contact.id };
}

export async function updateCrmContact(contactId: string, input: unknown): Promise<ActionState> {
  const contact = await load<OrgRef & { name: string }>('crm_contacts', contactId, 'id, org_id, name');
  if (!contact) return { ok: false, error: 'That contact is not in this workspace' };

  const parsed = personSchema.merge(contactExtraSchema).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, contact.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit contacts' };

  const { error } = await supabase
    .from('crm_contacts')
    .update({
      name: parsed.data.name,
      company: blankToNull(parsed.data.company),
      email: blankToNull(parsed.data.email),
      phone: blankToNull(parsed.data.phone),
      owner_id: ownerOrNull(parsed.data.owner_id),
      address: blankToNull(parsed.data.address),
      tags: [...new Set(parsed.data.tags)],
    })
    .eq('id', contactId);
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'This workspace already has a contact with that address' };
    return { ok: false, error: crmError(error, 'That contact could not be saved') };
  }

  revalidateCrm({ contact: contactId });
  return { ok: true };
}

export async function deleteCrmContact(contactId: string): Promise<ActionState> {
  const contact = await load<OrgRef & { name: string }>('crm_contacts', contactId, 'id, org_id, name');
  if (!contact) return { ok: false, error: 'That contact is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, contact.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can delete a contact' };

  const { error } = await supabase.from('crm_contacts').delete().eq('id', contactId);
  if (error) return { ok: false, error: crmError(error, 'That contact could not be deleted') };

  await logActivity(supabase, {
    orgId: contact.org_id,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_contact',
    entityId: contactId,
    action: 'deleted',
    summary: `Deleted ${contact.name} and their history`,
  });

  revalidateCrm();
  return { ok: true };
}

// --- deals ------------------------------------------------------------------

/** A deal names a contact, a lead, or both — never nobody. The table says so too. */
function dealTargets(parsed: z.infer<typeof dealSchema>): { contact_id: string | null; lead_id: string | null } | string {
  const contactId = parsed.contact_id === '' ? null : parsed.contact_id;
  const leadId = parsed.lead_id === '' ? null : parsed.lead_id;
  if (!contactId && !leadId) return 'Say who this deal is with';
  return { contact_id: contactId, lead_id: leadId };
}

export async function createCrmDeal(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const targets = dealTargets(parsed.data);
  if (typeof targets === 'string') return { ok: false, error: targets };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a deal' };

  const org = await load<{ currency: string }>('orgs', orgId, 'currency');

  const { data, error } = await supabase
    .from('crm_deals')
    .insert({
      org_id: orgId,
      title: parsed.data.title,
      stage_id: parsed.data.stage_id,
      ...targets,
      owner_id: ownerOrNull(parsed.data.owner_id),
      amount: parsed.data.amount,
      currency: org?.currency ?? 'INR',
      expected_close: blankToNull(parsed.data.expected_close),
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: crmError(error, 'That deal could not be added') };

  const deal = data as unknown as { id: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_deal',
    entityId: deal.id,
    action: 'created',
    summary: `Opened the deal “${parsed.data.title}”`,
  });

  revalidateCrm({ deal: deal.id });
  return { ok: true, id: deal.id };
}

export async function updateCrmDeal(dealId: string, input: unknown): Promise<ActionState> {
  const deal = await load<OrgRef>('crm_deals', dealId, 'id, org_id');
  if (!deal) return { ok: false, error: 'That deal is not in this workspace' };

  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const targets = dealTargets(parsed.data);
  if (typeof targets === 'string') return { ok: false, error: targets };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, deal.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit deals' };

  const { error } = await supabase
    .from('crm_deals')
    .update({
      title: parsed.data.title,
      stage_id: parsed.data.stage_id,
      ...targets,
      owner_id: ownerOrNull(parsed.data.owner_id),
      amount: parsed.data.amount,
      expected_close: blankToNull(parsed.data.expected_close),
      lost_reason: blankToNull(parsed.data.lost_reason),
    })
    .eq('id', dealId);
  if (error) return { ok: false, error: crmError(error, 'That deal could not be saved') };

  revalidateCrm({ deal: dealId });
  return { ok: true };
}

/**
 * Moving a card is the whole of the daily action, so it takes a stage and nothing
 * else. The trigger decides whether the move closes the deal, and clearing a lost
 * reason on the way back to an open stage happens in the same statement.
 */
export async function moveCrmDeal(dealId: string, stageId: unknown): Promise<ActionState> {
  const parsedStage = uuid.safeParse(stageId);
  if (!parsedStage.success) return { ok: false, error: 'Pick a pipeline stage' };

  const deal = await load<OrgRef & { title: string }>('crm_deals', dealId, 'id, org_id, title');
  if (!deal) return { ok: false, error: 'That deal is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, deal.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can move a deal' };

  const { error } = await supabase.from('crm_deals').update({ stage_id: parsedStage.data }).eq('id', dealId);
  if (error) return { ok: false, error: crmError(error, 'That deal could not be moved') };

  await logActivity(supabase, {
    orgId: deal.org_id,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_deal',
    entityId: dealId,
    action: 'moved',
    summary: `Moved “${deal.title}” along the pipeline`,
  });

  revalidateCrm({ deal: dealId });
  return { ok: true };
}

export async function deleteCrmDeal(dealId: string): Promise<ActionState> {
  const deal = await load<OrgRef & { title: string }>('crm_deals', dealId, 'id, org_id, title');
  if (!deal) return { ok: false, error: 'That deal is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, deal.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can delete a deal' };

  const { error } = await supabase.from('crm_deals').delete().eq('id', dealId);
  if (error) return { ok: false, error: crmError(error, 'That deal could not be deleted') };

  await logActivity(supabase, {
    orgId: deal.org_id,
    actorId: actor.userId,
    appKey: 'crm',
    entityType: 'crm_deal',
    entityId: dealId,
    action: 'deleted',
    summary: `Deleted the deal “${deal.title}”`,
  });

  revalidateCrm();
  return { ok: true };
}

// --- activities -------------------------------------------------------------

export async function addCrmActivity(
  target: { contactId?: string; leadId?: string; dealId?: string },
  input: unknown,
): Promise<ActionState & { id?: string }> {
  const ids = [target.contactId, target.leadId, target.dealId].filter((id): id is string => !!id);
  if (ids.length !== 1) return { ok: false, error: 'That activity has no record to attach to' };
  const validId = uuid.safeParse(ids[0] as string);
  if (!validId.success) return { ok: false, error: 'That record is not in this workspace' };

  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  if (parsed.data.subject === '' && parsed.data.body === '') {
    return { ok: false, error: 'Write something — a note with no words helps nobody later' };
  }
  if (parsed.data.kind !== 'task' && parsed.data.due_at !== '') {
    return { ok: false, error: 'Only a task can be due' };
  }

  const supabase = await createClient();
  const column = target.contactId ? 'contact_id' : target.dealId ? 'deal_id' : 'lead_id';
  const { data: parent, error: parentError } = await supabase
    .from(target.contactId ? 'crm_contacts' : target.dealId ? 'crm_deals' : 'crm_leads')
    .select('id, org_id')
    .eq('id', validId.data)
    .maybeSingle();
  if (parentError) return { ok: false, error: crmError(parentError, 'That record could not be read') };
  const org = parent as unknown as OrgRef | null;
  if (!org) return { ok: false, error: 'That record is not in this workspace' };

  const actor = await assertMembership(supabase, org.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can write here' };

  // A task with no assignee belongs to whoever wrote it — an open task that nobody
  // owns is a task nobody does.
  const ownerId = parsed.data.owner_id === '' ? actor.userId : parsed.data.owner_id;
  const dueAt = parsed.data.due_at === '' ? null : new Date(parsed.data.due_at).toISOString();

  const { data, error } = await supabase
    .from('crm_activities')
    .insert({
      org_id: org.org_id,
      kind: parsed.data.kind,
      subject: blankToNull(parsed.data.subject),
      body: blankToNull(parsed.data.body),
      [column]: validId.data,
      owner_id: ownerId,
      due_at: dueAt,
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: crmError(error, 'That entry could not be added') };

  revalidateCrm({
    contact: target.contactId,
    lead: target.leadId,
    deal: target.dealId,
  });
  return { ok: true, id: (data as unknown as { id: string }).id };
}

export async function setCrmTaskDone(activityId: string, done: unknown): Promise<ActionState> {
  if (!uuid.safeParse(activityId).success) return { ok: false, error: 'That task is not in this workspace' };
  const parsed = z.boolean().safeParse(done);
  if (!parsed.success) return { ok: false, error: 'That task is not in this workspace' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('crm_activities')
    .update({ done_at: parsed.data ? new Date().toISOString() : null })
    .eq('id', activityId)
    .eq('kind', 'task')
    .select('id, org_id, contact_id, lead_id, deal_id')
    .maybeSingle();
  if (error) return { ok: false, error: crmError(error, 'That task could not be updated') };
  const task = data as unknown as (OrgRef & { contact_id: string | null; lead_id: string | null; deal_id: string | null }) | null;
  if (!task) return { ok: false, error: 'That task is not in this workspace' };

  revalidateCrm({ contact: task.contact_id ?? undefined, lead: task.lead_id ?? undefined, deal: task.deal_id ?? undefined });
  return { ok: true };
}

export async function deleteCrmActivity(activityId: string): Promise<ActionState> {
  const activity = await load<OrgRef>('crm_activities', activityId, 'id, org_id');
  if (!activity) return { ok: false, error: 'That entry is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, activity.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can remove an entry' };

  const { error } = await supabase.from('crm_activities').delete().eq('id', activityId);
  if (error) {
    // The policy lets the author or an admin delete; RLS answers "no rows" for both
    // other cases, so the difference is shown here rather than guessed at.
    return { ok: false, error: crmError(error, 'That entry could not be removed') };
  }

  revalidateCrm();
  return { ok: true };
}

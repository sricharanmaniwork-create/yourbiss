'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import { isValidSlug, slugify } from '@/lib/utils';
import {
  formFieldSchema,
  formSettingsSchema,
  formThemeSchema,
  validateFieldSemantics,
  type FormFieldDef,
} from '@/lib/forms/types';
import type { ActionState } from '@/lib/types';

/**
 * Every write the Forms app makes.
 *
 * A draft is allowed to be incomplete — a form two fields into being built has to
 * survive a save, or the browser tab closing loses the work. The same validation
 * runs again on publish, where an empty form or a field whose logic points at
 * nothing does block, because that is the moment it becomes something a customer
 * can submit.
 */

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least two characters')
  .max(60)
  .refine((v) => /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(v), 'Use lowercase letters, numbers and single dashes')
  .refine((v) => isValidSlug(v), 'That address is reserved');

const definitionSchema = z.object({
  title: z.string().trim().min(1, 'Give the form a title').max(140),
  description: z.string().max(2000).default(''),
  slug: slugField,
  fields: z.array(formFieldSchema).max(120),
  settings: formSettingsSchema,
  theme: formThemeSchema,
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const privateSchema = z.object({
  notify_emails: z.array(z.string().trim().toLowerCase().regex(EMAIL, 'Enter a real email address').max(320)).max(20),
  notify_recipient: z.boolean().default(false),
  confirmation_subject: z.string().max(200).default(''),
  confirmation_html: z.string().max(20000).default(''),
  redirect_url: z
    .string()
    .max(600)
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Use a full https:// address')
    .default(''),
  webhook_url: z
    .string()
    .max(600)
    .refine((v) => v === '' || /^https:\/\//.test(v), 'Use a full https:// address')
    .default(''),
  /** Sent only when it changes; an empty string from the form means "keep" unless `clear_secret` is set. */
  webhook_secret: z.string().max(200).default(''),
  clear_secret: z.boolean().default(false),
});

interface FormRef {
  id: string;
  org_id: string;
  title: string;
  slug: string;
  status: string;
}

/** Reads the form the caller claims, through their own session, so RLS decides. */
async function loadForm(formId: string): Promise<FormRef | null> {
  if (!z.string().uuid().safeParse(formId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('forms')
    .select('id, org_id, title, slug, status')
    .eq('id', formId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormRef | null) ?? null;
}

function revalidateForm(form: FormRef) {
  revalidatePath(`/app/forms/${form.id}`);
  revalidatePath('/app/forms');
}

// --- creating ---------------------------------------------------------------

export async function createForm(
  input: { orgId: string; title: string; slug?: string },
): Promise<ActionState & { id?: string; slug?: string }> {
  const title = z.string().trim().min(1, 'Give the form a title').max(140).safeParse(input.title);
  const orgId = z.string().uuid().safeParse(input.orgId);
  if (!title.success || !orgId.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields',
      fields: { ...fieldErrors(title.success ? [] : title.error.issues), ...fieldErrors(orgId.success ? [] : orgId.error.issues) },
    };
  }

  const supabase = await createClient();
  const actor = await assertMembership(supabase, input.orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a form' };

  const requested = input.slug && input.slug.trim() !== '' ? slugify(input.slug, 'form') : slugify(title.data, 'form');
  let slug = requested;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data: clash } = await supabase.from('forms').select('id').eq('org_id', input.orgId).eq('slug', slug).maybeSingle();
    if (!clash) break;
    slug = `${requested.slice(0, 52)}-${attempt + 2}`;
  }

  const { data, error } = await supabase
    .from('forms')
    .insert({
      org_id: input.orgId,
      title: title.data,
      slug,
      status: 'draft',
      // An empty form is a legal draft. The canvas analogy is the blank page:
      // nothing invented, nothing to delete.
      fields: [],
      settings: {},
      theme: {},
    })
    .select('id, slug')
    .single();

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'This workspace already has a form at that address' : error.message,
    };
  }

  const created = data as unknown as { id: string; slug: string };
  await logActivity(supabase, {
    orgId: input.orgId,
    actorId: actor.userId,
    appKey: 'forms',
    entityType: 'form',
    entityId: created.id,
    action: 'created',
    summary: `Created the form “${title.data}”`,
  });

  return { ok: true, id: created.id, slug: created.slug };
}

// --- saving the definition --------------------------------------------------

export async function saveFormDefinition(formId: string, definition: unknown): Promise<ActionState> {
  const form = await loadForm(formId);
  if (!form) return { ok: false, error: 'That form is not in this workspace' };

  const parsed = definitionSchema.safeParse(definition);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const fields = parsed.data.fields as FormFieldDef[];
  const semantic = validateFieldSemantics(fields);
  if (semantic) return { ok: false, error: semantic };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, form.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can edit forms' };

  const { error } = await supabase
    .from('forms')
    .update({
      title: parsed.data.title,
      description: parsed.data.description || null,
      slug: parsed.data.slug,
      fields,
      settings: parsed.data.settings,
      theme: parsed.data.theme,
    })
    .eq('id', formId);

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'Another form in this workspace already uses that address' : error.message,
    };
  }

  revalidateForm(form);
  return { ok: true };
}

// --- publishing -------------------------------------------------------------

export async function setFormStatus(formId: string, status: 'draft' | 'published' | 'archived'): Promise<ActionState> {
  const form = await loadForm(formId);
  if (!form) return { ok: false, error: 'That form is not in this workspace' };

  const supabase = await createClient();
  const actor =
    status === 'archived'
      ? await assertAdmin(supabase, form.org_id).catch(() => null)
      : await assertMembership(supabase, form.org_id).catch(() => null);
  if (!actor) return { ok: false, error: status === 'archived' ? 'Only an admin can archive a form' : 'Only a member can change this form' };

  if (status === 'published') {
    const check = await validateForPublish(formId);
    if (!check.ok) return check;
  }

  const { error } = await supabase.from('forms').update({ status }).eq('id', formId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: form.org_id,
    actorId: actor.userId,
    appKey: 'forms',
    entityType: 'form',
    entityId: form.id,
    action: status === 'published' ? 'published' : status,
    summary:
      status === 'published'
        ? `Published “${form.title}” so it can take responses`
        : status === 'archived'
          ? `Archived “${form.title}”`
          : `Took “${form.title}” back to draft`,
  });

  revalidateForm(form);
  return { ok: true };
}

/**
 * What a form must satisfy before a stranger can submit it. `form_privates` is not
 * checked here: a form with no notification addresses is still a working form,
 * the answers simply only ever land in the responses table.
 */
async function validateForPublish(formId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('forms')
    .select('title, fields, settings, status')
    .eq('id', formId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const row = data as unknown as { title: string; fields: unknown; settings: unknown; status: string } | null;
  if (!row) return { ok: false, error: 'That form is not in this workspace' };

  const fields = z.array(formFieldSchema).max(120).safeParse(row.fields ?? []);
  if (!fields.success) return { ok: false, error: 'The stored field list cannot be read. Re-save the form.' };

  const list = fields.data as FormFieldDef[];
  if (list.length === 0) return { ok: false, error: `“${row.title}” has no fields yet. Add at least one question.` };

  // A form made entirely of headings collects nothing, so "at least one field"
  // has to mean at least one field that takes an answer.
  const collects = list.filter((field) => !['section', 'heading', 'note', 'divider', 'spacer'].includes(field.type));
  if (collects.length === 0) return { ok: false, error: `“${row.title}” asks nothing. Add a field that collects an answer.` };

  const semantic = validateFieldSemantics(list);
  if (semantic) return { ok: false, error: semantic };

  const settings = formSettingsSchema.safeParse(row.settings ?? {});
  if (!settings.success) return { ok: false, error: 'The form settings cannot be read. Re-save the form.' };

  return { ok: true };
}

export async function deleteForm(formId: string): Promise<ActionState> {
  const form = await loadForm(formId);
  if (!form) return { ok: false, error: 'That form is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, form.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can delete a form' };

  // Responses hang off the form, so the row going means every answer goes with it.
  const { error } = await supabase.from('forms').delete().eq('id', formId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: form.org_id,
    actorId: actor.userId,
    appKey: 'forms',
    entityType: 'form',
    entityId: form.id,
    action: 'deleted',
    summary: `Deleted “${form.title}” and every response to it`,
  });

  revalidatePath('/app/forms');
  return { ok: true };
}

// --- notifications, confirmation, webhook -----------------------------------

export async function saveFormPrivates(formId: string, input: unknown): Promise<ActionState> {
  const form = await loadForm(formId);
  if (!form) return { ok: false, error: 'That form is not in this workspace' };

  const parsed = privateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, form.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can change who gets notified' };

  // The trigger guarantees the row exists; this makes the write work even for a
  // form created before the mirror ran.
  const patch: Record<string, unknown> = {
    form_id: formId,
    org_id: form.org_id,
    notify_emails: [...new Set(parsed.data.notify_emails)],
    notify_recipient: parsed.data.notify_recipient,
    confirmation_subject: parsed.data.confirmation_subject || null,
    confirmation_html: parsed.data.confirmation_html || null,
    redirect_url: parsed.data.redirect_url || null,
    webhook_url: parsed.data.webhook_url || null,
  };
  if (parsed.data.clear_secret) patch.webhook_secret = null;
  else if (parsed.data.webhook_secret !== '') patch.webhook_secret = parsed.data.webhook_secret;

  const { error } = await supabase.from('form_privates').upsert(patch, { onConflict: 'form_id' });
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: form.org_id,
    actorId: actor.userId,
    appKey: 'forms',
    entityType: 'form',
    entityId: form.id,
    action: 'settings',
    summary: `Changed where responses for “${form.title}” are sent`,
  });

  revalidateForm(form);
  return { ok: true };
}

// --- response triage --------------------------------------------------------

const STATE = z.enum(['new', 'read', 'replied', 'spam']);

export async function setSubmissionState(submissionId: string, state: unknown): Promise<ActionState> {
  if (!z.string().uuid().safeParse(submissionId).success) return { ok: false, error: 'That response is not in this workspace' };
  const parsed = STATE.safeParse(state);
  if (!parsed.success) return { ok: false, error: 'Unknown response state' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('form_submissions')
    .update({ state: parsed.data })
    .eq('id', submissionId)
    .select('id, form_id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'That response is not in this workspace' };

  const formId = (data as { form_id: string }).form_id;
  revalidatePath(`/app/forms/${formId}`);
  return { ok: true };
}

export async function deleteSubmission(submissionId: string): Promise<ActionState & { formId?: string }> {
  if (!z.string().uuid().safeParse(submissionId).success) return { ok: false, error: 'That response is not in this workspace' };

  const supabase = await createClient();
  const read = await supabase.from('form_submissions').select('id, form_id, org_id').eq('id', submissionId).maybeSingle();
  if (read.error) return { ok: false, error: read.error.message };
  const row = read.data as unknown as { id: string; form_id: string; org_id: string } | null;
  if (!row) return { ok: false, error: 'That response is not in this workspace' };

  const actor = await assertAdmin(supabase, row.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can delete a response' };

  const { error } = await supabase.from('form_submissions').delete().eq('id', submissionId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: row.org_id,
    actorId: actor.userId,
    appKey: 'forms',
    entityType: 'form_submission',
    entityId: submissionId,
    action: 'deleted',
    summary: 'Deleted a form response',
  });

  revalidatePath(`/app/forms/${row.form_id}`);
  return { ok: true, formId: row.form_id };
}

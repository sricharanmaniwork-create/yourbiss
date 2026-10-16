import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { formSettingsSchema, formThemeSchema, formFieldSchema, type FormFieldDef, type FormSettings, type FormTheme } from './types';

/**
 * Reads for a form a visitor reaches without signing in — the shared link and the
 * embed frame on a published page.
 *
 * `anon` holds no table privileges, so RLS cannot serve these rows. This module is
 * the deliberate exception, exactly like the published-site reader: it uses the
 * service-role client, replaces the policy with explicit filters (a published
 * form in an active workspace), and returns the definition only. Notification
 * addresses, the webhook secret and stored responses are never reachable from
 * here — those need `form_privates`, which no anonymous path reads.
 *
 * Turning the Forms app off in settings hides the builder but does not take a
 * shared link offline: a form already printed on a flyer or embedded on a page
 * must keep working until the owner deletes it.
 */

export interface PublicForm {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  title: string;
  description: string | null;
  slug: string;
  fields: FormFieldDef[];
  settings: FormSettings;
  theme: FormTheme;
  /** Set by `close_at`; the page shows a closed notice instead of the form. */
  closesAt: string | null;
}

interface FormShape extends Record<string, unknown> {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  slug: string;
  fields: unknown;
  settings: unknown;
  theme: unknown;
  status: string;
  orgs: { id: string; name: string; slug: string } | null;
}

/**
 * A jsonb column can hold anything a hand-edited row once put there, so the
 * definition is re-parsed on the way out rather than trusted. A form whose stored
 * document has become unreadable shows as unavailable instead of throwing on
 * someone's live page.
 */
function toPublicForm(row: FormShape | null): PublicForm | null {
  if (!row || !row.orgs) return null;

  const fields = formFieldSchema.array().max(120).safeParse(row.fields);
  const settings = formSettingsSchema.safeParse(row.settings ?? {});
  const theme = formThemeSchema.safeParse(row.theme ?? {});
  if (!fields.success || !settings.success || !theme.success) return null;

  return {
    id: row.id,
    orgId: row.org_id,
    orgName: row.orgs.name,
    orgSlug: row.orgs.slug,
    title: row.title,
    description: row.description,
    slug: row.slug,
    fields: fields.data,
    settings: settings.data as FormSettings,
    theme: theme.data as FormTheme,
    closesAt: (settings.data as FormSettings).close_at,
  };
}

const SELECT =
  'id, org_id, title, description, slug, fields, settings, theme, status, orgs!inner(id, name, slug, status)';

export async function findFormBySlug(orgSlug: string, formSlug: string): Promise<PublicForm | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('forms')
    .select(SELECT)
    .eq('slug', formSlug)
    .eq('orgs.slug', orgSlug)
    .eq('status', 'published')
    .eq('orgs.status', 'active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return toPublicForm((data ?? null) as FormShape | null);
}

/** The embed frame addresses a form by id, which is unique across the product. */
export async function findFormById(formId: string): Promise<PublicForm | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('forms')
    .select(SELECT)
    .eq('id', formId)
    .eq('status', 'published')
    .eq('orgs.status', 'active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return toPublicForm((data ?? null) as FormShape | null);
}

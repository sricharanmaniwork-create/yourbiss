'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import { validateTree } from '@/lib/blocks/validate';
import { emptyPage, pageTreeSchema, type PageTree } from '@/lib/blocks/types';
import { makeBlockId } from '@/lib/blocks/tree';
import { isValidPagePath, isValidSlug, slugify } from '@/lib/utils';
import type { ActionState, BlockIssue, DraftSaveResult } from '@/lib/types';

/**
 * Every write the website app makes.
 *
 * Each handler reads the target row with the member's own session first, so a
 * site another org owns is simply not found — RLS decides, not a comparison we
 * could forget. Only `publish_site` and `restore_site_version` reach Postgres
 * for the real work, because those two are atomic multi-row transactions.
 */

function fields(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH = /^\d{1,4}(\.\d+)?(px|rem|%)$/;

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least two characters')
  .max(60)
  .refine((v) => /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(v), 'Use letters, numbers and single dashes')
  .refine((v) => isValidSlug(v), 'That address is reserved');

const pathField = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '/' || v.startsWith('/'), 'Page addresses start with /')
  .refine((v) => isValidPagePath(v), 'Use lowercase letters, numbers and dashes');

const siteSchema = z.object({
  name: z.string().trim().min(1, 'The site needs a name').max(80),
  slug: slugField,
  favicon_url: z.union([z.literal(''), z.string().regex(/^https?:\/\//, 'Use a full https address')]),
});

const pageSchema = z.object({
  title: z.string().trim().min(1, 'Give the page a title').max(120),
  path: pathField,
  seo_title: z.string().trim().max(70).optional().default(''),
  seo_description: z.string().trim().max(200).optional().default(''),
  og_image_url: z.union([z.literal(''), z.string().regex(/^https?:\/\//)]).optional().default(''),
});

const themeSchema = z.object({
  colors: z.object({
    primary: z.string().regex(HEX, 'Use a hex colour like #2E6BE6'),
    surface: z.string().regex(HEX, 'Use a hex colour like #FFFFFF'),
    background: z.string().regex(HEX, 'Use a hex colour like #F7F8FA'),
    text: z.string().regex(HEX, 'Use a hex colour like #111827'),
    muted: z.string().regex(HEX, 'Use a hex colour like #6B7280'),
    border: z.string().regex(HEX, 'Use a hex colour like #E5E7EB'),
  }),
  fonts: z.object({
    heading: z.string().trim().min(1).max(48),
    body: z.string().trim().min(1).max(48),
  }),
  radius: z.string().regex(LENGTH, 'Use a length like 10px'),
  max_width: z.string().regex(LENGTH, 'Use a length like 1200px'),
  section_gap: z.string().regex(LENGTH, 'Use a length like 48px'),
});

interface SiteRef {
  id: string;
  org_id: string;
  slug: string;
  name: string;
}

/** Reads the site the caller claims to own, through RLS. Null means "not yours". */
async function loadSite(siteId: string): Promise<SiteRef | null> {
  if (!z.string().uuid().safeParse(siteId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from('sites').select('id, org_id, slug, name').eq('id', siteId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SiteRef | null) ?? null;
}

async function loadPage(pageId: string) {
  if (!z.string().uuid().safeParse(pageId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages')
    .select('id, site_id, org_id, title, path, is_home, status')
    .eq('id', pageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    (data as
      | { id: string; site_id: string; org_id: string; title: string; path: string; is_home: boolean; status: string }
      | null) ?? null
  );
}

async function orgSlugOf(orgId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('orgs').select('slug').eq('id', orgId).maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { slug: string } | null)?.slug ?? null) as string | null;
}

function revalidateSite(orgSlug: string | null, siteSlug: string) {
  if (!orgSlug) return;
  revalidatePath(`/s/${orgSlug}/${siteSlug}`, 'layout');
}

// --- sites ------------------------------------------------------------------

export async function createSite(
  input: { orgId: string; name: string; slug?: string },
): Promise<ActionState & { id?: string; pageId?: string }> {
  const name = z.string().trim().min(1, 'The site needs a name').max(80).safeParse(input.name);
  const orgId = z.string().uuid().safeParse(input.orgId);
  if (!name.success || !orgId.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: { ...fields(name.success ? [] : name.error.issues), ...fields(orgId.success ? [] : orgId.error.issues) } };
  }

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, input.orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can add a site to this workspace' };

  const requested = input.slug && input.slug.trim() !== '' ? slugify(input.slug, 'site') : slugify(name.data, 'site');
  const taken = new Set<string>();
  let slug = requested;

  // One try per suffix, up to thirty. The citext unique index is the real gate.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data: clash } = await supabase.from('sites').select('id').eq('org_id', input.orgId).eq('slug', slug).maybeSingle();
    if (!clash) break;
    taken.add(slug);
    slug = `${requested.slice(0, 54)}-${attempt + 2}`;
    if (taken.has(slug)) slug = `${requested.slice(0, 50)}-${Date.now().toString(36).slice(-5)}`;
  }

  const { data: site, error } = await supabase
    .from('sites')
    .insert({
      org_id: input.orgId,
      name: name.data,
      slug,
      theme: {
        colors: { primary: '#2E6BE6', surface: '#FFFFFF', background: '#F7F8FA', text: '#111827', muted: '#6B7280', border: '#E5E7EB' },
        fonts: { heading: 'Inter', body: 'Inter' },
        radius: '10px',
        max_width: '1200px',
        section_gap: '48px',
      },
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'This workspace already has a site at that address' : error.message };
  }

  const siteId = (site as { id: string }).id;
  const home = emptyPage(makeBlockId('page'));
  const { data: homePage, error: pageError } = await supabase
    .from('site_pages')
    .insert({
      site_id: siteId,
      org_id: input.orgId,
      title: 'Home',
      path: '/',
      is_home: true,
      status: 'draft',
      draft_tree: home,
      sort_order: 0,
    })
    .select('id')
    .single();

  if (pageError) {
    await supabase.from('sites').delete().eq('id', siteId);
    return { ok: false, error: pageError.message };
  }

  await logActivity(supabase, {
    orgId: input.orgId,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'site',
    entityId: siteId,
    action: 'created',
    summary: `Created the site “${name.data}”`,
  });

  revalidatePath('/app/websites');
  // Opening the canvas straight away needs both ids, so they come back with the answer.
  return { ok: true, id: siteId, pageId: (homePage as unknown as { id: string }).id };
}

export async function updateSite(siteId: string, input: z.input<typeof siteSchema>): Promise<ActionState> {
  const site = await loadSite(siteId);
  if (!site) return { ok: false, error: 'That site is not in this workspace' };

  const parsed = siteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fields(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, site.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can change site settings' };

  const { error } = await supabase
    .from('sites')
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      favicon_url: parsed.data.favicon_url === '' ? null : parsed.data.favicon_url,
    })
    .eq('id', siteId);

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'Another site already uses that address' : error.message };
  }

  await logActivity(supabase, {
    orgId: site.org_id,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'site',
    entityId: siteId,
    action: 'updated',
    summary: `Site settings saved for “${parsed.data.name}”`,
  });

  revalidateSite(await orgSlugOf(site.org_id), parsed.data.slug);
  revalidatePath('/app/websites');
  return { ok: true };
}

export async function updateTheme(siteId: string, theme: unknown): Promise<ActionState> {
  const site = await loadSite(siteId);
  if (!site) return { ok: false, error: 'That site is not in this workspace' };

  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) return { ok: false, error: 'Check the colours and sizes', fields: fields(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, site.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can change the site theme' };

  const { error } = await supabase.from('sites').update({ theme: parsed.data }).eq('id', siteId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: site.org_id,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'site',
    entityId: siteId,
    action: 'themed',
    summary: `Theme updated for “${site.name}”`,
  });

  revalidateSite(await orgSlugOf(site.org_id), site.slug);
  return { ok: true };
}

export async function archiveSite(siteId: string): Promise<ActionState> {
  const site = await loadSite(siteId);
  if (!site) return { ok: false, error: 'That site is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, site.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can delete a site' };

  const { error } = await supabase.from('sites').update({ status: 'archived' }).eq('id', siteId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: site.org_id,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'site',
    entityId: siteId,
    action: 'archived',
    summary: `Deleted the site “${site.name}”`,
  });

  revalidateSite(await orgSlugOf(site.org_id), site.slug);
  revalidatePath('/app/websites');
  return { ok: true };
}

// --- pages ------------------------------------------------------------------

export async function createPage(
  siteId: string,
  input: z.input<typeof pageSchema>,
): Promise<ActionState & { id?: string }> {
  const site = await loadSite(siteId);
  if (!site) return { ok: false, error: 'That site is not in this workspace' };

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fields(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, site.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can add pages' };

  const { count } = await supabase.from('site_pages').select('id', { count: 'exact', head: true }).eq('site_id', siteId).neq('status', 'archived');

  const { data: created, error } = await supabase
    .from('site_pages')
    .insert({
      site_id: siteId,
      org_id: site.org_id,
      title: parsed.data.title,
      path: parsed.data.path,
      seo_title: parsed.data.seo_title || null,
      seo_description: parsed.data.seo_description || null,
      status: 'draft',
      draft_tree: emptyPage(makeBlockId('page')),
      sort_order: count ?? 0,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'Another page already lives at that address' : error.message };
  }

  await logActivity(supabase, {
    orgId: site.org_id,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'page',
    entityId: parsed.data.path,
    action: 'created',
    summary: `Added the page “${parsed.data.title}” (${parsed.data.path})`,
  });

  revalidatePath(`/app/websites/${siteId}`);
  // The editor opens the new page straight away, so its id is part of the answer.
  return { ok: true, id: String((created as unknown as { id: string }).id) };
}

export async function updatePage(pageId: string, input: z.input<typeof pageSchema> & { make_home?: boolean }): Promise<ActionState> {
  const page = await loadPage(pageId);
  if (!page) return { ok: false, error: 'That page is not in this workspace' };

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fields(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, page.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can change pages' };

  if (input.make_home && !page.is_home) {
    const { error: unset } = await supabase.from('site_pages').update({ is_home: false }).eq('site_id', page.site_id).eq('is_home', true);
    if (unset) return { ok: false, error: unset.message };
  }

  const { error } = await supabase
    .from('site_pages')
    .update({
      title: parsed.data.title,
      path: parsed.data.path,
      seo_title: parsed.data.seo_title || null,
      seo_description: parsed.data.seo_description || null,
      og_image_url: parsed.data.og_image_url || null,
      is_home: input.make_home ? true : page.is_home,
    })
    .eq('id', pageId);

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'Another page already lives at that address' : error.message };
  }

  revalidatePath(`/app/websites/${page.site_id}`);
  return { ok: true };
}

export async function duplicatePage(pageId: string): Promise<ActionState> {
  const page = await loadPage(pageId);
  if (!page) return { ok: false, error: 'That page is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, page.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can duplicate pages' };

  const { data: full, error: readError } = await supabase.from('site_pages').select('draft_tree').eq('id', pageId).maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const source = pageTreeSchema.safeParse((full as { draft_tree?: unknown } | null)?.draft_tree);
  const copy: PageTree = source.success ? { ...source.data, id: makeBlockId('page') } : emptyPage(makeBlockId('page'));

  const base = page.path === '/' ? '/home' : page.path;
  let path = `${base}-copy`;
  for (let attempt = 2; attempt < 20; attempt += 1) {
    const { data: clash } = await supabase
      .from('site_pages')
      .select('id')
      .eq('site_id', page.site_id)
      .eq('path', path)
      .neq('status', 'archived')
      .maybeSingle();
    if (!clash) break;
    path = `${base}-copy-${attempt}`;
  }

  const { error } = await supabase.from('site_pages').insert({
    site_id: page.site_id,
    org_id: page.org_id,
    title: `${page.title} copy`.slice(0, 120),
    path,
    status: 'draft',
    draft_tree: copy,
    sort_order: 999,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/websites/${page.site_id}`);
  return { ok: true };
}

export async function archivePage(pageId: string): Promise<ActionState> {
  const page = await loadPage(pageId);
  if (!page) return { ok: false, error: 'That page is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, page.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can delete pages' };

  if (page.is_home) return { ok: false, error: 'Make another page the home page first — a site always needs one' };

  const { count } = await supabase
    .from('site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', page.site_id)
    .neq('status', 'archived');

  if ((count ?? 0) <= 1) return { ok: false, error: 'This is the last page on the site' };

  const { error } = await supabase
    .from('site_pages')
    .update({ status: 'archived', is_home: false, published_tree: null, published_at: null })
    .eq('id', pageId);

  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: page.org_id,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'page',
    entityId: pageId,
    action: 'archived',
    summary: `Deleted the page “${page.title}”`,
  });

  revalidatePath(`/app/websites/${page.site_id}`);
  return { ok: true };
}

/**
 * Autosave. A draft with an unfinished block still writes — losing half-typed
 * copy because a link is invalid is worse than a warning in the canvas. The same
 * validation runs again on publish, where it does block.
 */
export async function savePageDraft(pageId: string, tree: unknown): Promise<DraftSaveResult> {
  const page = await loadPage(pageId);
  if (!page) return { ok: false, error: 'That page is not in this workspace' };

  const check = validateTree(tree);
  if (check.fatal) return { ok: false, error: check.fatal };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, page.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can edit pages' };

  const { error } = await supabase.from('site_pages').update({ draft_tree: check.tree }).eq('id', pageId);
  if (error) return { ok: false, error: error.message };

  const issues: BlockIssue[] = check.errors;
  return { ok: true, issues, savedAt: new Date().toISOString() };
}

// --- publishing -------------------------------------------------------------

export async function publishSite(siteId: string, note?: string): Promise<ActionState> {
  const site = await loadSite(siteId);
  if (!site) return { ok: false, error: 'That site is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, site.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can publish' };

  const { data: pages, error: readError } = await supabase
    .from('site_pages')
    .select('id, title, draft_tree')
    .eq('site_id', siteId)
    .neq('status', 'archived');

  if (readError) return { ok: false, error: readError.message };

  const rows = (pages ?? []) as unknown as { id: string; title: string; draft_tree: unknown }[];
  if (rows.length === 0) return { ok: false, error: 'This site has no pages yet' };

  for (const row of rows) {
    const check = validateTree(row.draft_tree);
    if (check.fatal) return { ok: false, error: `“${row.title}”: ${check.fatal}` };
    if (check.errors.length > 0) {
      return { ok: false, error: `“${row.title}” has ${check.errors.length} block(s) that need attention before publishing` };
    }
  }

  const { data, error } = await supabase.rpc('publish_site', { p_site_id: siteId, p_note: note ?? null });
  if (error) return { ok: false, error: error.message };

  const result = (data ?? { version_number: 0, pages_published: 0 }) as { version_number: number; pages_published: number };

  await logActivity(supabase, {
    orgId: site.org_id,
    actorId: actor.userId,
    appKey: 'website',
    entityType: 'site',
    entityId: siteId,
    action: 'published',
    summary: `Published version ${result.version_number} (${result.pages_published} pages)`,
  });

  revalidateSite(await orgSlugOf(site.org_id), site.slug);
  revalidatePath(`/app/websites/${siteId}`);
  revalidatePath('/app/websites');
  return { ok: true };
}

export async function restoreSiteVersion(siteId: string, number: number): Promise<ActionState> {
  const site = await loadSite(siteId);
  if (!site) return { ok: false, error: 'That site is not in this workspace' };

  const parsed = z.coerce.number().int().min(1).safeParse(number);
  if (!parsed.success) return { ok: false, error: 'Choose a version to restore' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, site.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can roll a site back' };

  const { error } = await supabase.rpc('restore_site_version', { p_site_id: siteId, p_number: parsed.data });
  if (error) return { ok: false, error: error.message };

  revalidateSite(await orgSlugOf(site.org_id), site.slug);
  revalidatePath(`/app/websites/${siteId}`);
  return { ok: true };
}

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { pageTreeSchema, type PageTree } from '@/lib/blocks/types';
import { normalizeTheme } from '@/lib/blocks/style';
import type { EmbedEntity, RenderProduct } from '@/lib/blocks/render';
import type { SiteTheme } from '@/lib/types';
import { formatAmount } from '@/lib/utils';

/**
 * Reads for published pages, which an anonymous visitor sees.
 *
 * `anon` and `public` hold no table privileges at all, so RLS cannot serve these
 * rows. This module is the deliberate exception: it uses the service-role client
 * and replaces the policy with explicit filters — active org, published site,
 * published page, a page that actually has a tree. It returns content, never
 * drafts, and nothing here takes an org id from a caller.
 *
 * Disabling the website app hides the builder but does not take a live site
 * offline; a customer's website should not vanish because a workspace owner
 * flicked a switch in settings.
 */

export interface PublicSite {
  id: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  name: string;
  slug: string;
  theme: SiteTheme;
  favicon_url: string | null;
}

export interface PublishedPage {
  id: string;
  title: string;
  path: string;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  tree: PageTree;
}

/** Everything a live page's blocks may point at, read in one pass. */
export interface EmbedEntities {
  forms: Record<string, EmbedEntity>;
  services: Record<string, EmbedEntity>;
  staff: Record<string, EmbedEntity>;
  products: RenderProduct[];
}

export async function findPublishedSite(orgSlug: string, siteSlug: string): Promise<PublicSite | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('sites')
    .select('id, org_id, name, slug, favicon_url, theme, orgs!inner(slug, name, status)')
    .eq('orgs.slug', orgSlug)
    .eq('slug', siteSlug)
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw new Error(error.message);

  const row = data as unknown as
    | {
        id: string;
        org_id: string;
        name: string;
        slug: string;
        favicon_url: string | null;
        theme: unknown;
        orgs: { slug: string; name: string; status: string } | { slug: string; name: string; status: string }[] | null;
      }
    | null;

  if (!row) return null;
  const org = Array.isArray(row.orgs) ? row.orgs[0] : row.orgs;
  if (!org || org.status !== 'active') return null;

  return {
    id: row.id,
    orgId: row.org_id,
    orgSlug: org.slug,
    orgName: org.name,
    name: row.name,
    slug: row.slug,
    theme: normalizeTheme(row.theme),
    favicon_url: row.favicon_url,
  };
}

export async function findPublishedPage(siteId: string, path: string): Promise<PublishedPage | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('site_pages')
    .select('id, title, path, seo_title, seo_description, og_image_url, published_tree')
    .eq('site_id', siteId)
    .eq('path', path)
    .eq('status', 'published')
    .not('published_tree', 'is', null)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const row = data as unknown as
    | {
        id: string;
        title: string;
        path: string;
        seo_title: string | null;
        seo_description: string | null;
        og_image_url: string | null;
        published_tree: unknown;
      }
    | null;

  if (!row) return null;
  const parsed = pageTreeSchema.safeParse(row.published_tree);
  if (!parsed.success) return null;

  return {
    id: row.id,
    title: row.title,
    path: row.path,
    seo_title: row.seo_title,
    seo_description: row.seo_description,
    og_image_url: row.og_image_url,
    tree: parsed.data,
  };
}

export async function publishedPaths(siteId: string): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('site_pages')
    .select('path')
    .eq('site_id', siteId)
    .eq('status', 'published');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { path: string }[]).map((row) => row.path);
}

/**
 * Rows a `form_embed`, `booking_embed` or `product_grid` block points at. The frame
 * is only rendered when the id resolves here, so a deleted form cannot leave a broken
 * iframe on a live page.
 *
 * Products are the one list that can legitimately come back empty for a reason the
 * visitor should not see: Inventory may be switched off for this workspace, or its
 * tables may not exist yet on a deploy that has not been migrated. Neither is allowed
 * to take a customer's website down, so a failed product read is an empty shelf.
 */
export async function embedEntities(orgId: string): Promise<EmbedEntities> {
  const supabase = createAdminClient();

  const [forms, services, staff, org, products] = await Promise.all([
    supabase.from('forms').select('id, title, slug').eq('org_id', orgId).eq('status', 'published'),
    supabase.from('booking_services').select('id, name, slug').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('booking_staff').select('id, name, slug').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('orgs').select('apps, currency, locale').eq('id', orgId).maybeSingle(),
    supabase
      .from('inv_items')
      .select('id, name, description, price, image_url')
      .eq('org_id', orgId)
      .eq('kind', 'product')
      .eq('status', 'active')
      .order('lower(name)')
      .limit(24),
  ]);

  const toMap = (data: unknown, labelKey: 'title' | 'name'): Record<string, EmbedEntity> => {
    const out: Record<string, EmbedEntity> = {};
    for (const row of (data ?? []) as { id: string; slug: string }[]) {
      const label = String((row as unknown as Record<string, unknown>)[labelKey] ?? '');
      out[row.id] = { id: row.id, label, slug: row.slug };
    }
    return out;
  };

  if (forms.error) throw new Error(forms.error.message);
  if (services.error) throw new Error(services.error.message);
  if (staff.error) throw new Error(staff.error.message);
  if (org.error) throw new Error(org.error.message);

  const workspace = org.data as unknown as { apps: unknown; currency: string | null; locale: string | null } | null;
  const apps = (workspace?.apps ?? {}) as Record<string, unknown>;

  const shown: RenderProduct[] =
    apps.inventory === true && !products.error
      ? ((products.data ?? []) as unknown as InvProductRow[]).map((item) => ({
          id: item.id,
          name: item.name,
          price: formatAmount(Number(item.price), workspace?.currency ?? 'INR', workspace?.locale ?? 'en-IN'),
          body: item.description ?? '',
          image: item.image_url ?? '',
        }))
      : [];

  return {
    forms: toMap(forms.data, 'title'),
    services: toMap(services.data, 'name'),
    staff: toMap(staff.data, 'name'),
    products: shown,
  };
}

interface InvProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { pageTreeSchema, type PageTree } from '@/lib/blocks/types';
import { normalizeTheme } from '@/lib/blocks/style';
import type { EmbedEntity, RenderProduct, StoreCartItem, StorefrontItems } from '@/lib/blocks/render';
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

/**
 * A published page degrades to an empty list rather than a stack trace, because a
 * visitor cannot fix anything. That is only a good answer if the failure is written
 * down somewhere the person who can fix it will read it, so each degraded read is
 * logged with the database's own words — the same line Vercel → Logs → Runtime shows
 * for a thrown one, instead of a shop that looks like it has no products.
 */
function degraded(what: string, error: { message: string } | null): void {
  if (error) console.error('[yourbiss] published page read failed', { read: what, message: error.message });
}

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
  /** What a `store_cart` block sells, and what it charges on top. Empty when the shop is closed. */
  storefront: StorefrontItems;
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
 * Rows a `form_embed`, `booking_embed`, `product_grid` or `store_cart` block points at.
 * The frame is only rendered when the id resolves here, so a deleted form cannot leave a
 * broken iframe on a live page.
 *
 * Products are the one list that can legitimately come back empty for a reason the
 * visitor should not see: Inventory may be switched off for this workspace, or its
 * tables may not exist yet on a deploy that has not been migrated. Neither is allowed
 * to take a customer's website down, so a failed product read is an empty shelf.
 *
 * The app switches come from `org_apps`, not from a column on `orgs` — there never was
 * one — and a read that fails leaves them off rather than throwing, because a page of
 * prose and pictures has no business 500ing over a shop flag.
 */
export async function embedEntities(orgId: string): Promise<EmbedEntities> {
  const supabase = createAdminClient();

  const [forms, services, staff, org, switches, items] = await Promise.all([
    supabase.from('forms').select('id, title, slug').eq('org_id', orgId).eq('status', 'published'),
    supabase.from('booking_services').select('id, name, slug').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('booking_staff').select('id, name, slug').eq('org_id', orgId).eq('status', 'active'),
    supabase.from('orgs').select('currency, locale').eq('id', orgId).maybeSingle(),
    supabase.from('org_apps').select('app_key, status').eq('org_id', orgId),
    supabase
      .from('inv_items')
      .select('id, name, description, price, image_url')
      .eq('org_id', orgId)
      .eq('kind', 'product')
      .eq('status', 'active')
      .order('name')
      .limit(120),
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

  degraded('orgs', org.error);
  const workspace = (org.error ? null : org.data) as unknown as { currency: string | null; locale: string | null } | null;
  const currency = workspace?.currency ?? 'INR';
  const locale = workspace?.locale ?? 'en-IN';

  degraded('org_apps', switches.error);
  const enabled = new Set(
    switches.error
      ? []
      : ((switches.data ?? []) as unknown as { app_key: string; status: string }[])
          .filter((row) => row.status === 'enabled')
          .map((row) => row.app_key),
  );

  degraded('inv_items', items.error);
  const rows: InvProductRow[] = items.error ? [] : ((items.data ?? []) as unknown as InvProductRow[]);
  const label = (price: number) => formatAmount(Number(price), currency, locale);

  // A catalogue list and a shop window are different questions: the grid shows what this
  // workspace sells at all (and only while Inventory is switched on), the cart only what
  // it put on the shelf for the storefront. The two reads are separate because the grid's
  // is capped to a pageful of names, while a cart that quietly loses the items past its
  // cap would be a shop refusing to sell things it has for sale. Both format through the
  // same `label`, so a price cannot be written two ways on one page.
  const products: RenderProduct[] = enabled.has('inventory')
    ? rows.slice(0, 24).map((item) => ({
        id: item.id,
        name: item.name,
        price: label(Number(item.price)),
        body: item.description ?? '',
        image: item.image_url ?? '',
      }))
    : [];

  const storefront = await storefrontOf(orgId, {
    open: enabled.has('store') && enabled.has('inventory'),
    currency,
    locale,
    label,
  });

  return {
    forms: toMap(forms.data, 'title'),
    services: toMap(services.data, 'name'),
    staff: toMap(staff.data, 'name'),
    products,
    storefront,
  };
}

/**
 * The shop's own two numbers and the items it sells, read best-effort for the reason
 * above: a storefront whose delivery fee cannot be read is a page that still shows its
 * items, not a broken site.
 */
async function storefrontOf(
  orgId: string,
  input: {
    open: boolean;
    currency: string;
    locale: string;
    label: (price: number) => string;
  },
): Promise<StorefrontItems> {
  const closed: StorefrontItems = {
    enabled: false,
    orgId,
    currency: input.currency,
    locale: input.locale,
    shipping: input.label(0),
    shippingFlat: 0,
    checkoutNote: '',
    items: [],
  };

  if (!input.open) return closed;

  const supabase = createAdminClient();
  const [settings, onSale] = await Promise.all([
    supabase.from('store_settings').select('shipping_flat, checkout_note').eq('org_id', orgId).maybeSingle(),
    supabase
      .from('inv_items')
      .select('id, name, description, price, image_url, unit, tax_rate_pct')
      .eq('org_id', orgId)
      .eq('kind', 'product')
      .eq('status', 'active')
      .eq('sell_online', true)
      .order('name')
      .limit(200),
  ]);

  degraded('store_settings', settings.error);
  const row = (settings.error ? null : settings.data) as { shipping_flat: string | number; checkout_note: string | null } | null;
  const fee = Number(row?.shipping_flat ?? 0);

  degraded('inv_items for the storefront', onSale.error);
  const items: StoreCartItem[] = ((onSale.error ? [] : onSale.data ?? []) as unknown as InvStoreRow[])
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: input.label(Number(item.price)),
      amount: Number(item.price),
      taxPct: Number(item.tax_rate_pct),
      unit: item.unit,
      body: item.description ?? '',
      image: item.image_url ?? '',
    }));

  return {
    enabled: true,
    orgId,
    currency: input.currency,
    locale: input.locale,
    shipping: input.label(fee),
    shippingFlat: fee,
    checkoutNote: row?.checkout_note ?? '',
    items,
  };
}

interface InvProductRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}

/** The same row with the two columns only a cart reads, both of them `not null` in 0011/0012. */
interface InvStoreRow extends InvProductRow {
  unit: string;
  tax_rate_pct: number;
}

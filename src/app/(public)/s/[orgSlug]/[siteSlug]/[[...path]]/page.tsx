import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteTree } from '@/components/site/site-tree';
import { themeToVars } from '@/lib/blocks/style';
import type { RenderContext } from '@/lib/blocks/render';
import { embedEntities, findPublishedPage, findPublishedSite } from '@/lib/site/published';

/**
 * A published site, served to anyone.
 *
 * Dynamic on purpose: the answer depends on the org and site slugs in the URL
 * and on what the workspace published a moment ago, and a stale CDN copy of a
 * page is exactly what a customer notices first.
 */
export const dynamic = 'force-dynamic';

interface Params {
  orgSlug: string;
  siteSlug: string;
  path?: string[];
}

function pathOf(params: Params): string {
  const segments = (params.path ?? []).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return '/';
  return `/${segments.join('/')}`.toLowerCase();
}

async function load(params: Params) {
  const site = await findPublishedSite(params.orgSlug, params.siteSlug);
  if (!site) return null;
  const page = await findPublishedPage(site.id, pathOf(params));
  if (!page) return null;
  const embeds = await embedEntities(site.orgId);
  return { site, page, embeds };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const route = await params;
  const loaded = await load(route);
  if (!loaded) return { title: 'Not found' };

  const { site, page } = loaded;
  const basePath = `/s/${site.orgSlug}/${site.slug}`;
  const title = page.seo_title || page.title;
  const description = page.seo_description || undefined;
  const url = `${basePath}${page.path === '/' ? '' : page.path}`;

  return {
    title,
    description,
    // The app shell opts out of indexing; a customer's published site must not inherit that.
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: site.name,
      type: 'website',
      images: page.og_image_url ? [{ url: page.og_image_url }] : undefined,
    },
    twitter: { card: page.og_image_url ? 'summary_large_image' : 'summary', title, description },
  };
}

export default async function PublishedSitePage({ params }: { params: Promise<Params> }) {
  const route = await params;
  const loaded = await load(route);
  if (!loaded) notFound();

  const { site, page, embeds } = loaded;
  const ctx: RenderContext = {
    theme: site.theme,
    mode: 'live',
    basePath: `/s/${site.orgSlug}/${site.slug}`,
    forms: embeds.forms,
    services: embeds.services,
    staff: embeds.staff,
    products: embeds.products,
    storefront: embeds.storefront,
  };

  return (
    <div
      className="site-render min-h-screen"
      style={{
        ...themeToVars(site.theme),
        background: site.theme.colors?.background ?? '#F7F8FA',
        color: site.theme.colors?.text ?? '#111827',
      }}
    >
      <SiteTree tree={page.tree} ctx={ctx} />
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/workspace';
import { getPage, getSite, listPageSummaries } from '@/lib/repo';
import { embedEntities } from '@/lib/site/published';
import { pageTreeSchema } from '@/lib/blocks/types';
import { normalizeTheme } from '@/lib/blocks/style';
import { AdminOnly } from '@/components/settings/admin-only';
import { BuilderRoot, type BuilderInitial } from '@/components/builder/builder-root';
import type { EntityOptions } from '@/components/builder/control-view';
import { PageHeader } from '@/components/ui/card';

/**
 * The canvas for one page.
 *
 * Everything the editor needs arrives from the server: the page's own draft
 * tree, the site theme, the pages this site can link to, and the forms and
 * booking services its embed blocks may point at. Nothing here trusts the ids in
 * the URL — the site is read through RLS, then the page is checked to belong to
 * that site, so a page id from another site simply does not resolve.
 */
export const dynamic = 'force-dynamic';

interface Params {
  siteId: string;
  pageId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { pageId } = await params;
  const page = await getPage(pageId);
  return { title: page ? `Build · ${page.title}` : 'Build a page' };
}

export default async function PageBuilderRoute({ params }: { params: Promise<Params> }) {
  const { siteId, pageId } = await params;
  const workspace = await requireWorkspace();

  const site = await getSite(siteId);
  if (!site || site.org_id !== workspace.org.id || site.status === 'archived') notFound();

  if (workspace.role === 'member') {
    return (
      <>
        <PageHeader title={site.name} description="Every block on a page lives in the canvas, so only the owner and admins can change one." />
        <AdminOnly action="Editing a page" />
      </>
    );
  }

  const page = await getPage(pageId);
  if (!page || page.site_id !== site.id || page.status === 'archived') notFound();

  // A draft tree that does not parse is not repaired silently: the autosave
  // would overwrite whatever was actually in there.
  const parsed = pageTreeSchema.safeParse(page.draft_tree);
  if (!parsed.success) {
    return (
      <>
        <PageHeader title={site.name} description="This page could not be opened." />
        <div className="ui-card max-w-[640px] px-5 py-5">
          <p className="text-[13.5px] font-semibold text-ink">“{page.title}” holds content the builder cannot read</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            Its stored block tree is damaged, and opening the canvas would let a save replace it. The other pages of
            this site are unaffected — publish from the site page to keep whatever is live, then ask support to restore
            this page from a version.
          </p>
        </div>
      </>
    );
  }

  const basePath = `/s/${workspace.org.slug}/${site.slug}`;
  const [summaries, embeds] = await Promise.all([listPageSummaries(site.id), embedEntities(site.org_id)]);

  const options: EntityOptions = {
    forms: Object.values(embeds.forms).map((form) => ({ id: form.id, label: form.label })),
    services: Object.values(embeds.services).map((service) => ({ id: service.id, label: service.label })),
    staff: Object.values(embeds.staff).map((person) => ({ id: person.id, label: person.label })),
    // A page link stores its path, which is what the renderer resolves against
    // the site base — no second lookup needed when the page draws.
    pages: summaries.map((summary) => ({
      id: summary.path,
      label: summary.is_home ? `${summary.title} (home)` : summary.title,
    })),
  };

  const initial: BuilderInitial = {
    orgId: site.org_id,
    siteId: site.id,
    siteName: site.name,
    page: { ...page, draft_tree: parsed.data },
    theme: normalizeTheme(site.theme),
    basePath,
    options,
    embeds: { forms: embeds.forms, services: embeds.services, staff: embeds.staff, products: embeds.products, storefront: embeds.storefront },
    liveHref:
      page.status === 'published' && page.published_tree
        ? `${basePath}${page.path === '/' ? '' : page.path}`
        : null,
  };

  return <BuilderRoot initial={initial} />;
}

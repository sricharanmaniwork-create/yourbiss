import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/workspace';
import { getSite, listPages, listSiteVersions } from '@/lib/repo';
import { SiteOverview } from '@/components/site/site-overview';

/**
 * One site's control panel: pages, design, versions, settings.
 *
 * The site row is read through the member's own session, so RLS decides whether
 * it exists for them at all; the extra `org_id` comparison is only there to stop
 * a member of two workspaces from reaching a site of the other one by pasting its
 * id into the URL while the first workspace is selected.
 */
export const dynamic = 'force-dynamic';

interface Params {
  siteId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { siteId } = await params;
  const site = await getSite(siteId);
  return { title: site ? site.name : 'Website' };
}

export default async function SiteOverviewRoute({ params }: { params: Promise<Params> }) {
  const { siteId } = await params;
  const workspace = await requireWorkspace();

  const site = await getSite(siteId);
  if (!site || site.org_id !== workspace.org.id || site.status === 'archived') notFound();

  const pages = await listPages(site.id);
  const versions = await listSiteVersions(site.id);

  return (
    <SiteOverview
      site={site}
      pages={pages}
      versions={versions}
      orgId={workspace.org.id}
      orgSlug={workspace.org.slug}
      basePath={`/s/${workspace.org.slug}/${site.slug}`}
      timezone={workspace.org.timezone}
      canManage={workspace.role === 'owner' || workspace.role === 'admin'}
    />
  );
}

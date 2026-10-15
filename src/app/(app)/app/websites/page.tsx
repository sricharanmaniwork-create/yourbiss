import type { Metadata } from 'next';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listSites } from '@/lib/repo';
import { PageHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { NewSiteButton } from '@/components/site/new-site-button';
import { formatInZone } from '@/lib/utils';

export const metadata: Metadata = { title: 'Websites' };

export default async function WebsitesPage() {
  const workspace = await requireWorkspace();
  const sites = await listSites(workspace.org.id);

  return (
    <>
      <PageHeader
        title="Websites"
        description="Every site in this workspace, with the address its visitors use and the last time it was published."
        actions={workspace.role === 'member' ? undefined : <NewSiteButton orgId={workspace.org.id} orgSlug={workspace.org.slug} />}
      />

      {sites.length === 0 ? (
        <EmptyState
          icon={<Globe size={22} />}
          title="No sites yet"
          description="A new site opens on an empty canvas. Drag sections, headings and forms onto it, then publish when it looks right."
          action={
            workspace.role === 'member' ? (
              <p className="text-[12.5px] text-muted">An owner or admin of this workspace can add the first site.</p>
            ) : (
              <NewSiteButton orgId={workspace.org.id} orgSlug={workspace.org.slug} />
            )
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sites.map((site) => (
            <li key={site.id} className="ui-card">
              <Link
                href={`/app/websites/${site.id}`}
                className="block px-4 py-3.5 transition-colors hover:bg-raised"
                aria-label={`Open ${site.name}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[14px] font-semibold text-ink">{site.name}</p>
                  <StatusBadge state={site.status} />
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-muted">/s/{workspace.org.slug}/{site.slug}</p>
                <p className="mt-2 text-[12px] text-muted">
                  {site.published_at
                    ? `Published ${formatInZone(site.published_at, workspace.org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}`
                    : `Edited ${formatInZone(site.updated_at, workspace.org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {workspace.role === 'member' && (
        <p className="mt-4 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          You are a member of this workspace, so you can read these sites but not build them. Editing a canvas, changing
          pages and publishing are for the owner and admins.
        </p>
      )}
    </>
  );
}

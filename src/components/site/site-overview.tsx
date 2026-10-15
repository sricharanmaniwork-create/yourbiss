'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Globe, Rocket } from 'lucide-react';
import type { Site, SitePage, SiteVersion } from '@/lib/types';
import { publishSite } from '@/lib/actions/sites';
import { Badge, Button, ButtonLink, Field, Modal, PageHeader, StatusBadge, Tabs, Textarea, toast, type TabItem } from '@/components/ui';
import { formatInZone } from '@/lib/utils';
import { PagesTab } from './pages-tab';
import { ThemeTab } from './theme-tab';
import { VersionsTab } from './versions-tab';
import { SettingsTab } from './settings-tab';

type Panel = 'pages' | 'design' | 'versions' | 'settings';

/**
 * One site, four panels, and the publish button that moves every draft tree onto
 * the live address in one transaction.
 *
 * Publishing is all-or-nothing by design: `publish_site` refuses if any block on
 * any page is unreadable, so a live site is never half-updated.
 */
export function SiteOverview({
  site,
  pages,
  versions,
  orgId,
  orgSlug,
  basePath,
  timezone,
  canManage,
}: {
  site: Site;
  pages: SitePage[];
  versions: SiteVersion[];
  orgId: string;
  orgSlug: string;
  basePath: string;
  timezone: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('pages');
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A page is "ahead of live" when it has never been published, or when it has
  // been edited since. That is what the publish button actually changes.
  const changed = useMemo(
    () =>
      pages.filter(
        (page) =>
          page.status !== 'published' ||
          !page.published_at ||
          new Date(page.updated_at).getTime() > new Date(page.published_at).getTime(),
      ),
    [pages],
  );

  const tabs: TabItem[] = [
    { id: 'pages', label: 'Pages', badge: pages.length },
    { id: 'design', label: 'Design' },
    { id: 'versions', label: 'Versions', badge: versions.length },
    { id: 'settings', label: 'Settings' },
  ];

  const publish = () => {
    setError(null);
    startTransition(async () => {
      const result = await publishSite(site.id, note).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'Publishing failed',
      }));
      if (!result.ok) {
        setError(result.error ?? 'Publishing failed');
        return;
      }
      setPublishing(false);
      setNote('');
      toast.success('The site is live');
      router.refresh();
    });
  };

  return (
    <>
      <PageHeader
        back={{ href: '/app/websites', label: 'Websites' }}
        title={site.name}
        description={`Served from ${basePath} — the address visitors open once the site is published.`}
        actions={
          <>
            {site.published_at && (
              <ButtonLink href={basePath} target="_blank" rel="noopener noreferrer" variant="secondary">
                <ExternalLink size={14} />
                Live site
              </ButtonLink>
            )}
            {canManage && (
              <Button variant="primary" onClick={() => { setError(null); setPublishing(true); }}>
                <Rocket size={14} />
                Publish
              </Button>
            )}
          </>
        }
      />

      <div className="ui-card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-muted" />
          <span className="font-mono text-[11.5px] text-muted">{basePath}</span>
          <StatusBadge state={site.status} />
        </div>
        <p className="text-[12px] text-muted">
          {site.published_at
            ? `Published ${formatInZone(site.published_at, timezone, { dateStyle: 'medium', timeStyle: 'short' })}`
            : 'Never published'}
        </p>
        {canManage ? (
          changed.length === 0 ? (
            <Badge tone="success">Live matches the drafts</Badge>
          ) : (
            <Badge tone="warning">
              {changed.length} page{changed.length === 1 ? '' : 's'} not on the live site
            </Badge>
          )
        ) : (
          <Badge tone="neutral">Read-only</Badge>
        )}
      </div>

      <Tabs
        items={tabs.map((tab) =>
          !canManage && (tab.id === 'design' || tab.id === 'settings') ? { ...tab, disabled: true } : tab,
        )}
        value={panel}
        onChange={(id) => setPanel(id as Panel)}
        className="mb-4"
      />

      {panel === 'pages' && (
        <PagesTab siteId={site.id} pages={pages} timezone={timezone} canManage={canManage} basePath={basePath} />
      )}
      {panel === 'design' && <ThemeTab siteId={site.id} theme={site.theme} />}
      {panel === 'versions' && (
        <VersionsTab siteId={site.id} versions={versions} timezone={timezone} canManage={canManage} />
      )}
      {panel === 'settings' && <SettingsTab site={site} orgId={orgId} orgSlug={orgSlug} />}

      <Modal
        open={publishing}
        onClose={() => setPublishing(false)}
        title="Publish this site"
        description="Every page's draft becomes what visitors see, and the site keeps a snapshot you can roll back to."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishing(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={publish}>
              Publish now
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error && (
            <p role="alert" className="rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3 py-2 text-[12.5px] leading-relaxed text-[#a50f0f]">
              {error}
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {changed.length === 0
              ? 'Nothing has changed since the last publish. Publishing again keeps a fresh snapshot anyway.'
              : `${changed.length} page${changed.length === 1 ? '' : 's'} will go live: ${changed
                  .map((page) => page.title)
                  .join(', ')}.`}
          </p>
          <Field label="Version note" htmlFor="publish-note" hint="Optional, up to 200 characters. Shown in the Versions panel.">
            <Textarea
              id="publish-note"
              rows={3}
              value={note}
              maxLength={200}
              placeholder="Added the pricing table and fixed the footer"
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <p className="text-[12px] leading-relaxed text-muted">
            Publishing validates every block on every page first. If a block is missing something required, the whole
            publish stops and the live site keeps serving the previous version.
          </p>
        </div>
      </Modal>
    </>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { History, RotateCcw } from 'lucide-react';
import type { SiteVersion } from '@/lib/types';
import { restoreSiteVersion } from '@/lib/actions/sites';
import { Button, EmptyState, Modal, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatInZone } from '@/lib/utils';

/**
 * Publish snapshots, newest first.
 *
 * A restore writes the snapshot into both the draft and the live trees of every
 * page it holds, so the canvas shows exactly what visitors see afterwards. It
 * does not delete the newer versions — rolling back is another row, not an undo
 * of history — and it cannot bring back a page that was added after the
 * snapshot, because that page simply is not in it.
 */
export function VersionsTab({
  siteId,
  versions,
  timezone,
  canManage,
}: {
  siteId: string;
  versions: SiteVersion[];
  timezone: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<SiteVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const restore = (version: SiteVersion) => {
    setError(null);
    startTransition(async () => {
      const result = await restoreSiteVersion(siteId, version.number).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'The rollback failed',
      }));
      if (!result.ok) {
        setError(result.error ?? 'The rollback failed');
        setConfirming(null);
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  };

  if (versions.length === 0) {
    return (
      <EmptyState
        icon={<History size={22} />}
        title="No versions yet"
        description="Every time you publish, the site keeps a snapshot of all its pages. Those snapshots are what you can roll back to."
      />
    );
  }

  return (
    <div className="ui-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[13.5px] font-semibold text-ink">Version history</p>
          <p className="text-[12px] text-muted">
            {versions.length} snapshot{versions.length === 1 ? '' : 's'} kept. The newest is what is live now.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="border-b border-line bg-[#fcebea] px-4 py-2 text-[12.5px] text-[#a50f0f]">
          {error}
        </p>
      )}

      <Table>
        <THead>
          <TH>Version</TH>
          <TH>Note</TH>
          <TH align="center">Pages</TH>
          <TH>Published</TH>
          {canManage && <TH align="right">Roll back</TH>}
        </THead>
        <TBody>
          {versions.map((version, index) => (
            <TR key={version.id}>
              <TD>
                <span className="font-medium text-ink">v{version.number}</span>
                {index === 0 && (
                  <span className="ml-2 rounded-full bg-brand-soft px-1.5 py-[1px] text-[11px] font-medium text-brand-dark">
                    live
                  </span>
                )}
              </TD>
              <TD className="text-ink-soft">{version.note ?? <span className="text-muted">—</span>}</TD>
              <TD align="center">{version.page_count}</TD>
              <TD className="text-muted">{formatInZone(version.created_at, timezone, { dateStyle: 'medium', timeStyle: 'short' })}</TD>
              {canManage && (
                <TD align="right">
                  {index === 0 ? (
                    <span className="text-[12px] text-muted">Already live</span>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirming(version)}>
                      <RotateCcw size={13} />
                      Restore
                    </Button>
                  )}
                </TD>
              )}
            </TR>
          ))}
        </TBody>
      </Table>

      {!canManage && (
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-muted">
          Reading history is for everyone in the workspace; rolling a site back is for the owner and admins.
        </p>
      )}

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={`Restore version ${confirming?.number ?? ''}?`}
        description="This rewrites the pages of this site and publishes them straight away."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                if (confirming) restore(confirming);
              }}
            >
              Restore and publish
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Version {confirming?.number} was published on{' '}
          {confirming ? formatInZone(confirming.created_at, timezone, { dateStyle: 'full', timeStyle: 'short' }) : ''} with{' '}
          {confirming?.page_count ?? 0} page(s). Visitors start seeing it as soon as you restore it, and the work you
          have done since is replaced on the canvas.
        </p>
      </Modal>
    </div>
  );
}

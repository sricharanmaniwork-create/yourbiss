'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Home, Pencil, Plus, Trash, Copy } from 'lucide-react';
import type { SitePage } from '@/lib/types';
import { archivePage, createPage, duplicatePage, updatePage } from '@/lib/actions/sites';
import { Badge, Button, Field, Input, Modal, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatDateInZone, isValidPagePath, slugify } from '@/lib/utils';

/**
 * The page list for one site.
 *
 * Deleting here archives the row rather than dropping it, which is what keeps a
 * published version restorable; the home page cannot be deleted because a site
 * without an address would publish a homepage-less site.
 */
export function PagesTab({
  siteId,
  pages,
  timezone,
  canManage,
  basePath,
}: {
  siteId: string;
  pages: SitePage[];
  timezone: string;
  canManage: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [touchedPath, setTouchedPath] = useState(false);
  const [confirming, setConfirming] = useState<SitePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, then?: (id?: string) => void) => {
    setError(null);
    startTransition(async () => {
      const result: { ok: boolean; error?: string; id?: string } = await fn().catch((e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : 'That did not work',
      }));
      if (!result.ok) {
        setError(result.error ?? 'That did not work');
        return;
      }
      then?.(result.id);
      router.refresh();
    });
  };

  const add = () =>
    act(
      () => createPage(siteId, { title, path }),
      (id) => {
        setAdding(false);
        setTitle('');
        setPath('');
        setTouchedPath(false);
        if (id) router.push(`/app/websites/${siteId}/builder/${id}`);
      },
    );

  return (
    <div className="ui-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[13.5px] font-semibold text-ink">Pages</p>
          <p className="text-[12px] text-muted">
            {pages.length} page{pages.length === 1 ? '' : 's'} on this site. The home page answers {basePath}/.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} />
            New page
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="border-b border-line bg-[#fcebea] px-4 py-2 text-[12.5px] text-[#a50f0f]">
          {error}
        </p>
      )}

      <Table>
        <THead>
          <TH>Title</TH>
          <TH>Address</TH>
          <TH>State</TH>
          <TH>Edited</TH>
          <TH align="right">Actions</TH>
        </THead>
        <TBody>
          {pages.map((page) => (
            <TR key={page.id}>
              <TD>
                <span className="font-medium text-ink">{page.title}</span>
                {page.is_home && (
                  <Badge tone="brand" className="ml-2">
                    Home
                  </Badge>
                )}
              </TD>
              <TD>
                <span className="font-mono text-[11.5px] text-muted">
                  {basePath}
                  {page.path === '/' ? '' : page.path}
                </span>
              </TD>
              <TD>
                <Badge tone={page.status === 'published' ? 'success' : page.status === 'draft' ? 'neutral' : 'danger'}>
                  {page.published_at ? `live · ${formatDateInZone(page.published_at, timezone)}` : 'not published'}
                </Badge>
              </TD>
              <TD className="text-muted">{formatDateInZone(page.updated_at, timezone)}</TD>
              <TD align="right">
                <div className="flex items-center justify-end gap-1">
                  <Link
                    href={`/app/websites/${siteId}/builder/${page.id}`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-strong px-2 text-[12px] font-medium text-ink-soft hover:border-brand hover:text-brand-dark"
                  >
                    <Pencil size={12} />
                    Edit
                  </Link>
                  {page.status === 'published' && (
                    <a
                      href={`${basePath}${page.path === '/' ? '' : page.path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open the live page"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-muted hover:text-ink"
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                  {canManage && !page.is_home && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(() => updatePage(page.id, { title: page.title, path: page.path, make_home: true }))}
                        title="Make this the home page"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-muted hover:text-ink disabled:opacity-50"
                      >
                        <Home size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => act(() => duplicatePage(page.id))}
                        title="Duplicate"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-muted hover:text-ink disabled:opacity-50"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setConfirming(page)}
                        title="Delete this page"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-muted hover:border-[#f4c7c4] hover:bg-[#fcebea] hover:text-[#a50f0f] disabled:opacity-50"
                      >
                        <Trash size={12} />
                      </button>
                    </>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {!canManage && (
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-muted">
          Adding, renaming and deleting pages needs an owner or admin. You can still open a page to see how it is built.
        </p>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="New page"
        description="It opens as an empty canvas, ready to drag blocks onto."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={title.trim() === '' || !path.startsWith('/')} onClick={add}>
              Create and edit
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Page name" htmlFor="new-page-title">
            <Input
              id="new-page-title"
              autoFocus
              value={title}
              maxLength={120}
              placeholder="Pricing"
              onChange={(event) => {
                setTitle(event.target.value);
                if (!touchedPath) setPath(`/${slugify(event.target.value, 'page')}`);
              }}
            />
          </Field>
          <Field
            label="Address"
            htmlFor="new-page-path"
            error={path !== '' && !isValidPagePath(path) ? 'Use /, or /lower-case-words' : undefined}
          >
            <Input
              id="new-page-path"
              value={path}
              maxLength={160}
              placeholder="/pricing"
              onChange={(event) => {
                setTouchedPath(true);
                setPath(event.target.value.startsWith('/') ? event.target.value : `/${event.target.value}`);
              }}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={`Delete “${confirming?.title ?? ''}”?`}
        description="The page leaves the site the next time it is published. A published version can still be restored from the Versions tab."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                const page = confirming;
                if (!page) return;
                act(() => archivePage(page.id), () => setConfirming(null));
              }}
            >
              Delete page
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {basePath}
          {confirming?.path === '/' ? '' : confirming?.path} will stop answering visitors.
        </p>
      </Modal>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Copy, Trash } from 'lucide-react';
import type { BlockNode, BlockStyle } from '@/lib/blocks/types';
import { REGISTRY } from '@/lib/blocks/registry';
import { blockLabel } from '@/lib/blocks/render';
import type { SitePage } from '@/lib/types';
import { Field, Input, Textarea } from '@/components/ui';
import { ControlView, type EntityOptions } from './control-view';
import { ItemsEditor } from './items-editor';
import { StylePanel } from './style-panel';
import { cn } from '@/lib/utils';

/**
 * The right-hand properties panel: what the selected block can be told, and
 * where on the page it sits. With nothing selected it shows the page's own
 * settings, which is the same rule the rest of the product follows — the panel
 * describes the thing you are looking at.
 */

export interface PageSettings {
  page: SitePage;
  onSave: (patch: { title: string; path: string; seo_title: string; seo_description: string; og_image_url: string }) => void;
  saving: boolean;
  error?: string;
}

export function Inspector({
  node,
  options,
  setProps,
  setStyles,
  onDuplicate,
  onRemove,
  onPickImage,
  pageSettings,
}: {
  node: BlockNode | null;
  options: EntityOptions;
  setProps: (id: string, props: Record<string, unknown>) => void;
  setStyles: (id: string, styles: Partial<BlockStyle>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onPickImage: (apply: (url: string) => void) => void;
  pageSettings: PageSettings;
}) {
  const def = node ? REGISTRY[node.type] : undefined;
  const [tab, setTab] = useState<'content' | 'style'>('content');

  // A new selection should not keep the previous block's style tab open.
  const [tabOwner, setTabOwner] = useState(node?.id);
  if (tabOwner !== node?.id) {
    setTabOwner(node?.id);
    setTab('content');
  }

  if (!node || !def) return <PageSettingsForm {...pageSettings} />;

  const styleKeys = def.styleKeys ?? [];
  const items = def.items;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <p className="text-[13px] font-semibold text-ink">{blockLabel(node)}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{def.description}</p>
      </div>

      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        <TabButton active={tab === 'content'} onClick={() => setTab('content')} label="Content" />
        {styleKeys.length > 0 && <TabButton active={tab === 'style'} onClick={() => setTab('style')} label="Style" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'content' ? (
          <div className="grid gap-3">
            {def.controls.length === 0 && !def.items && (
              <p className="text-[12.5px] text-muted">
                This block has no settings of its own. Drop blocks inside it, or change its style.
              </p>
            )}
            {def.controls.map((control) => (
              <ControlView
                key={control.key}
                control={control}
                value={node.props[control.key]}
                onChange={(next) => setProps(node.id, { ...node.props, [control.key]: next })}
                options={options}
                onPickImage={onPickImage}
              />
            ))}
            {items && (
              <ItemsEditor
                items={items}
                value={node.props[items.key]}
                onChange={(next) => setProps(node.id, { ...node.props, [items.key]: next })}
                options={options}
                onPickImage={onPickImage}
              />
            )}
          </div>
        ) : (
          <StylePanel def={def} styles={node.styles} onChange={(patch) => setStyles(node.id, patch)} />
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => onDuplicate(node.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-ink-soft hover:bg-raised"
        >
          <Copy size={13} />
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => onRemove(node.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-[#a50f0f] hover:bg-[#fcebea]"
        >
          <Trash size={13} />
          Delete
        </button>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
        active ? 'bg-brand/10 text-brand-dark' : 'text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}

function PageSettingsForm({ page, onSave, saving, error }: PageSettings) {
  const [title, setTitle] = useState(page.title);
  const [path, setPath] = useState(page.path);
  const [seoTitle, setSeoTitle] = useState(page.seo_title ?? '');
  const [seoDescription, setSeoDescription] = useState(page.seo_description ?? '');
  const [ogImage, setOgImage] = useState(page.og_image_url ?? '');

  // Row reloads (publish, page switch) must not leave stale inputs behind.
  // Comparing the row's own values, rather than its identity, means typing here
  // never resets the form while nothing above actually changed.
  const row = `${page.id}|${page.title}|${page.path}|${page.seo_title ?? ''}|${page.seo_description ?? ''}|${page.og_image_url ?? ''}`;
  const [syncedRow, setSyncedRow] = useState(row);
  if (syncedRow !== row) {
    setSyncedRow(row);
    setTitle(page.title);
    setPath(page.path);
    setSeoTitle(page.seo_title ?? '');
    setSeoDescription(page.seo_description ?? '');
    setOgImage(page.og_image_url ?? '');
  }

  const badPath = !page.is_home && path !== '' && !path.startsWith('/');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <p className="text-[13px] font-semibold text-ink">Page settings</p>
        <p className="mt-0.5 text-[11.5px] text-muted">Nothing is selected, so these are the settings for this page.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ title, path, seo_title: seoTitle, seo_description: seoDescription, og_image_url: ogImage });
          }}
        >
          <Field label="Page name" htmlFor="page-title">
            <Input id="page-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field
            label="Address"
            htmlFor="page-path"
            hint={page.is_home ? 'Home page' : undefined}
            error={badPath ? 'Start with a slash, like /pricing' : undefined}
          >
            <Input
              id="page-path"
              value={path}
              maxLength={160}
              disabled={page.is_home}
              onChange={(event) => setPath(event.target.value)}
            />
          </Field>

          <div className="mt-1 border-t border-line pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">For search engines</p>
            <div className="grid gap-3">
              <Field label="Title tag" htmlFor="page-seo-title" hint={`${seoTitle.length}/70`}>
                <Input
                  id="page-seo-title"
                  value={seoTitle}
                  maxLength={70}
                  placeholder={title}
                  onChange={(event) => setSeoTitle(event.target.value)}
                />
              </Field>
              <Field label="Description" htmlFor="page-seo-description" hint={`${seoDescription.length}/200`}>
                <Textarea
                  id="page-seo-description"
                  rows={3}
                  maxLength={200}
                  value={seoDescription}
                  onChange={(event) => setSeoDescription(event.target.value)}
                />
              </Field>
              <Field label="Share image URL" htmlFor="page-og" hint="Shown when the page is posted">
                <Input
                  id="page-og"
                  value={ogImage}
                  placeholder="https://…"
                  onChange={(event) => setOgImage(event.target.value)}
                />
              </Field>
            </div>
          </div>

          {error && <p className="text-[12px] text-danger">{error}</p>}

          <button
            type="submit"
            disabled={saving || title.trim() === '' || badPath}
            className="mt-1 h-9 rounded-md bg-brand text-[13px] font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saving ? 'Saving…' : 'Save page settings'}
          </button>
        </form>

        <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
          These settings decide where the page lives, so they take effect for the site the next time it is published.
        </p>
      </div>
    </div>
  );
}

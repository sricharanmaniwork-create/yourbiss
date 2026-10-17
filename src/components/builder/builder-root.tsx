'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, MousePointerClick, Shapes } from 'lucide-react';
import type { BlockNode, BlockType, PageTree } from '@/lib/blocks/types';
import type { EmbedEntity, RenderContext, RenderProduct } from '@/lib/blocks/render';
import type { SitePage, SiteTheme } from '@/lib/types';
import { canContain, findBlock, indexOfChild, isContainer, parentOf } from '@/lib/blocks/tree';
import { createPage, savePageDraft, updatePage } from '@/lib/actions/sites';
import { toast } from '@/components/ui';
import { Canvas, type CanvasActions, type Device } from './canvas';
import { Inspector } from './inspector';
import { Outline } from './outline';
import { Palette, type PaletteTarget } from './palette';
import { Toolbar } from './toolbar';
import { MediaPicker } from './media-picker';
import { useBuilder } from './use-builder';
import { endDrag, type DragPayload } from './drag';
import type { EntityOptions } from './control-view';
import { cn } from '@/lib/utils';

/**
 * The editor shell: library on the left, canvas in the middle, properties on the
 * right, page actions across the top.
 *
 * One copy of the tree exists — the one in `useBuilder` — and autosave posts it
 * to `draft_tree`. Visitors read `published_tree`, so nothing typed here is
 * public until the site is published.
 */

const AUTOSAVE_AFTER_MS = 1200;

export interface BuilderInitial {
  orgId: string;
  siteId: string;
  siteName: string;
  page: SitePage;
  theme: SiteTheme;
  /** `/s/{orgSlug}/{siteSlug}` — what a relative link on the page resolves against. */
  basePath: string;
  options: EntityOptions;
  embeds: {
    forms: Record<string, EmbedEntity>;
    services: Record<string, EmbedEntity>;
    staff: Record<string, EmbedEntity>;
    products: RenderProduct[];
  };
  liveHref: string | null;
}

export function BuilderRoot({ initial }: { initial: BuilderInitial }) {
  const router = useRouter();
  const builder = useBuilder(initial.page.draft_tree);
  const { tree, selected, selectedId, issues, select, addBlock, moveBlock, setProps, setStyles, remove, duplicate, undo, redo, canUndo, canRedo, dirty, markSaved } =
    builder;

  const [device, setDevice] = useState<Device>('desktop');
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [sidePanel, setSidePanel] = useState<'blocks' | 'layers'>('blocks');
  const [media, setMedia] = useState<{ open: boolean; apply: (url: string) => void }>({ open: false, apply: () => undefined });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pageSaving, setPageSaving] = useState(false);
  const [pageError, setPageError] = useState<string | undefined>();

  const debounce = useRef<number | null>(null);
  // A save has to notice when a newer one superseded it, or a slow response for
  // an old tree can land last and quietly put the draft back.
  const revision = useRef(0);
  const inFlight = useRef(false);

  const ctx: RenderContext = useMemo(
    () => ({ theme: initial.theme, mode: 'canvas', basePath: initial.basePath, ...initial.embeds }),
    [initial.theme, initial.basePath, initial.embeds],
  );

  const write = useCallback(
    async (next: PageTree) => {
      const my = ++revision.current;
      inFlight.current = true;
      setSaving(true);
      const result = await savePageDraft(initial.page.id, next).catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : 'The draft could not be saved',
      }));
      if (my !== revision.current) return;
      inFlight.current = false;
      setSaving(false);
      if (!result.ok) {
        toast.error(result.error ?? 'The draft could not be saved');
        return;
      }
      setSavedAt(result.savedAt ?? new Date().toISOString());
      markSaved(result.issues);
    },
    [initial.page.id, markSaved],
  );

  useEffect(() => {
    if (!dirty) return;
    debounce.current = window.setTimeout(() => void write(tree), AUTOSAVE_AFTER_MS);
    return () => {
      if (debounce.current !== null) window.clearTimeout(debounce.current);
      debounce.current = null;
    };
  }, [dirty, tree, write]);

  // Leaving the tab mid-debounce loses the last couple of seconds of typing.
  useEffect(() => {
    if (!dirty && !inFlight.current) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const saveNow = useCallback(() => {
    if (debounce.current !== null) window.clearTimeout(debounce.current);
    void write(tree);
  }, [tree, write]);

  /** `columns` must hold exactly `count` containers, so the count field edits its children too. */
  const syncColumnCount = useCallback(
    (node: BlockNode, wanted: number) => {
      const count = Math.max(1, Math.min(6, Math.trunc(wanted) || 2));
      for (let index = node.children.length; index < count; index += 1) {
        addBlock('container', { parentId: node.id, index });
      }
      for (let index = node.children.length - 1; index >= count; index -= 1) {
        const child = node.children[index];
        if (child) remove(child.id);
      }
    },
    [addBlock, remove],
  );

  /**
   * The properties panel writes whole props, which keeps stale keys from
   * surviving a cleared field; column count is the one prop that is also a
   * structural promise, so it re-shapes the tree here.
   */
  const applyProps = useCallback(
    (id: string, props: Record<string, unknown>) => {
      const node = findBlock(tree, id);
      setProps(id, props);
      if (node?.type === 'columns') syncColumnCount(node, Number.parseInt(String(props.count ?? '2'), 10) || 2);
    },
    [setProps, syncColumnCount, tree],
  );

  /**
   * Where a click in the library lands: inside the selected container, beside
   * the selected block, or at the end of the page. Dragging onto a caret is
   * still the precise answer; this is the fast one.
   */
  const addFromPalette = useCallback(
    (type: BlockType) => {
      if (selected) {
        if (isContainer(selected.type) && canContain(selected.type, type)) {
          addBlock(type, { parentId: selected.id, index: selected.children.length });
          return;
        }
        const parentId = parentOf(tree, selected.id);
        const parentType = !parentId ? null : parentId === tree.id ? 'page' : findBlock(tree, parentId)?.type ?? null;
        if (parentId && parentType && canContain(parentType, type)) {
          addBlock(type, { parentId, index: indexOfChild(tree, parentId, selected.id) + 1 });
          return;
        }
      }
      addBlock(type, { parentId: tree.id, index: tree.children.length });
    },
    [addBlock, selected, tree],
  );

  const target: PaletteTarget = useMemo(() => {
    if (!selected) return 'page';
    if (isContainer(selected.type)) return selected.type as PaletteTarget;
    const parentId = parentOf(tree, selected.id);
    if (!parentId || parentId === tree.id) return 'page';
    return (findBlock(tree, parentId)?.type ?? 'container') as PaletteTarget;
  }, [selected, tree]);

  const canvasActions: CanvasActions = useMemo(
    () => ({ select, addBlock, moveBlock, remove, duplicate }),
    [select, addBlock, moveBlock, remove, duplicate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement | null;
      const typing =
        node !== null &&
        (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveNow();
        return;
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === 'Escape') {
        if (!media.open) select(null);
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !typing) {
        event.preventDefault();
        remove(selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [media.open, redo, remove, saveNow, select, selectedId, undo]);

  const newPage = useCallback(async () => {
    const taken = new Set(initial.options.pages.map((page) => page.id));
    let path = '/new-page';
    for (let n = 2; taken.has(path); n += 1) path = `/new-page-${n}`;

    const result = await createPage(initial.siteId, { title: 'New page', path });
    if (!result.ok || !result.id) {
      toast.error(result.error ?? 'The page could not be added');
      return;
    }
    router.push(`/app/websites/${initial.siteId}/builder/${result.id}`);
  }, [initial.options.pages, initial.siteId, router]);

  const savePageSettings = useCallback(
    async (patch: { title: string; path: string; seo_title: string; seo_description: string; og_image_url: string }) => {
      setPageSaving(true);
      setPageError(undefined);
      const result = await updatePage(initial.page.id, patch).catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : 'That did not work',
      }));
      setPageSaving(false);
      if (!result.ok) {
        setPageError(result.error ?? 'The page settings could not be saved');
        return;
      }
      toast.success('Page settings saved');
      router.refresh();
    },
    [initial.page.id, router],
  );

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-canvas">
      <Toolbar
        siteName={initial.siteName}
        siteId={initial.siteId}
        pageTitle={initial.page.title}
        isHome={initial.page.is_home}
        device={device}
        setDevice={setDevice}
        canUndo={canUndo}
        canRedo={canRedo}
        undo={undo}
        redo={redo}
        dirty={dirty}
        savedAt={savedAt}
        saving={saving}
        saveNow={saveNow}
        addPage={() => void newPage()}
        previewHref={initial.liveHref}
        status={initial.page.status}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[248px] flex-none border-r border-line bg-surface md:flex md:flex-col">
          <div className="flex gap-1 border-b border-line px-2 py-1.5">
            <PanelTab active={sidePanel === 'blocks'} onClick={() => setSidePanel('blocks')} icon={<Shapes size={13} />} label="Blocks" />
            <PanelTab active={sidePanel === 'layers'} onClick={() => setSidePanel('layers')} icon={<Layers size={13} />} label="Layers" />
          </div>
          {sidePanel === 'blocks' ? (
            <Palette target={target} onAdd={addFromPalette} />
          ) : (
            <Outline tree={tree} selectedId={selectedId} issues={issues} onSelect={select} />
          )}
        </aside>

        <Canvas
          tree={tree}
          ctx={ctx}
          actions={canvasActions}
          drag={drag}
          setDrag={(payload) => {
            setDrag(payload);
            if (payload === null) endDrag();
          }}
          selectedId={selectedId}
          issues={issues}
          device={device}
        />

        <aside className="hidden w-[312px] flex-none border-l border-line bg-surface lg:flex lg:flex-col">
          <Inspector
            node={selected}
            options={initial.options}
            setProps={applyProps}
            setStyles={setStyles}
            onDuplicate={duplicate}
            onRemove={remove}
            onPickImage={(apply) => setMedia({ open: true, apply })}
            pageSettings={{
              page: initial.page,
              onSave: (patch) => void savePageSettings(patch),
              saving: pageSaving,
              error: pageError,
            }}
          />
        </aside>
      </div>

      {!selected && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-[12px] text-muted shadow-[var(--shadow-panel)] lg:flex">
          <MousePointerClick size={13} />
          Click any block to edit it · Ctrl+Z to undo · Ctrl+S to save now
        </p>
      )}

      <MediaPicker
        open={media.open}
        orgId={initial.orgId}
        onClose={() => setMedia((current) => ({ ...current, open: false }))}
        onPick={(url) => {
          media.apply(url);
          setMedia((current) => ({ ...current, open: false }));
        }}
      />
    </div>
  );
}

function PanelTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors',
        active ? 'bg-brand/10 text-brand-dark' : 'text-muted hover:bg-raised hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

'use client';

import { Fragment, useState, type DragEvent } from 'react';
import { Copy, GripVertical, Trash } from 'lucide-react';
import type { BlockNode, BlockType, PageTree } from '@/lib/blocks/types';
import { REGISTRY } from '@/lib/blocks/registry';
import { canContain, isContainer } from '@/lib/blocks/tree';
import { containerStyle, renderBlock, type RenderContext } from '@/lib/blocks/render';
import { themeToVars } from '@/lib/blocks/style';
import { getLiveDrag, readDrag, startDrag, type DragPayload } from './drag';
import { BlockIcon } from './block-icon';
import { cn } from '@/lib/utils';

/**
 * The canvas: a live render of the draft tree with drop carets between blocks.
 *
 * Carets are the only drop targets. A block itself never accepts a drop, which
 * is what keeps "insert before this" and "drop inside that container" from
 * fighting over the same pixels, and means the caret under the pointer always
 * says exactly where the block will land.
 */

export type Device = 'desktop' | 'tablet' | 'mobile';

const DEVICE_WIDTH: Record<Device, number | null> = {
  desktop: null,
  tablet: 834,
  mobile: 390,
};

const QUICK_ADD: BlockType[] = ['section', 'navbar', 'heading', 'text', 'image', 'button', 'form_embed', 'booking_embed'];

export interface CanvasActions {
  select: (id: string | null) => void;
  addBlock: (type: BlockType, place: { parentId: string; index: number }) => void;
  moveBlock: (id: string, place: { parentId: string; index: number }) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
}

interface Place {
  parentId: string;
  index: number;
}

type ParentKind = 'page' | BlockType;

function samePlace(a: Place | null, b: Place): boolean {
  return a !== null && a.parentId === b.parentId && a.index === b.index;
}

interface Common {
  ctx: RenderContext;
  actions: CanvasActions;
  drag: DragPayload | null;
  setDrag: (payload: DragPayload | null) => void;
  over: Place | null;
  setOver: (place: Place | null) => void;
  selectedId: string | null;
  issues: Record<string, string>;
}

function payloadType(payload: DragPayload): BlockType {
  return payload.kind === 'new' ? payload.type : payload.childType;
}

/** The block in flight, from React state or from the module copy if state has not landed yet. */
function currentDrag(common: Common): DragPayload | null {
  return common.drag ?? getLiveDrag();
}

function allows(parentType: ParentKind, payload: DragPayload | null): payload is DragPayload {
  return payload !== null && canContain(parentType, payloadType(payload));
}

function Caret({
  place,
  parentType,
  common,
}: {
  place: Place;
  parentType: ParentKind;
  common: Common;
}) {
  const dragging = currentDrag(common);
  const ok = allows(parentType, dragging);
  const active = samePlace(common.over, place) && ok;

  return (
    <div
      onDragOver={(event: DragEvent) => {
        const payload = currentDrag(common);
        if (!allows(parentType, payload)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = payload?.kind === 'move' ? 'move' : 'copy';
        if (!samePlace(common.over, place)) common.setOver(place);
      }}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const payload = readDrag(event);
        common.setOver(null);
        common.setDrag(null);
        if (!allows(parentType, payload)) return;
        if (payload.kind === 'new') common.actions.addBlock(payload.type, place);
        else common.actions.moveBlock(payload.id, place);
      }}
      aria-hidden="true"
      className={cn(
        'relative -my-[5px] h-[10px] rounded transition-colors',
        active ? 'bg-brand/25 ring-1 ring-brand' : ok ? 'bg-brand/[.07]' : 'bg-transparent',
      )}
    >
      {active && <span className="absolute left-0 top-[3px] h-[3px] w-full rounded-full bg-brand" />}
    </div>
  );
}

function ChildList({
  nodes,
  parentId,
  parentType,
  common,
  gap = 10,
}: {
  nodes: BlockNode[];
  parentId: string;
  parentType: ParentKind;
  common: Common;
  gap?: number;
}) {
  if (nodes.length === 0) {
    return (
      <div
        onDragOver={(event: DragEvent) => {
          if (!allows(parentType, currentDrag(common))) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = currentDrag(common)?.kind === 'move' ? 'move' : 'copy';
          if (!samePlace(common.over, { parentId, index: 0 })) common.setOver({ parentId, index: 0 });
        }}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          event.stopPropagation();
          const payload = readDrag(event);
          common.setOver(null);
          common.setDrag(null);
          if (!allows(parentType, payload)) return;
          if (payload.kind === 'new') common.actions.addBlock(payload.type, { parentId, index: 0 });
          else common.actions.moveBlock(payload.id, { parentId, index: 0 });
        }}
        className={cn(
          'rounded-md border border-dashed px-3 py-4 text-center text-[12px] transition-colors',
          common.drag
            ? 'border-brand/60 bg-brand/[.04] text-brand-dark'
            : 'border-line-strong bg-raised text-muted',
        )}
      >
        {common.drag ? 'Drop it here' : 'Empty — drag a block in from the left'}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: `${gap}px`, alignItems: 'start' }}>
      {nodes.map((node, index) => (
        <Fragment key={node.id}>
          <Caret place={{ parentId, index }} parentType={parentType} common={common} />
          <BlockFrame node={node} common={common} />
        </Fragment>
      ))}
      <Caret place={{ parentId, index: nodes.length }} parentType={parentType} common={common} />
    </div>
  );
}

function BlockFrame({ node, common }: { node: BlockNode; common: Common }) {
  const def = REGISTRY[node.type];
  const selected = common.selectedId === node.id;
  const issue = common.issues[node.id];
  const [hovered, setHovered] = useState(false);
  const label = def?.label ?? node.type;

  const content = isContainer(node.type) ? (
    <ContainerBody node={node} common={common} />
  ) : (
    <div className="site-block">{renderBlock(node, { ...common.ctx, mode: 'canvas' })}</div>
  );

  return (
    <div
      className={cn('relative rounded-[3px]', selected && 'canvas-selected', hovered && !selected && 'canvas-hover')}
      onClick={(event) => {
        event.stopPropagation();
        common.actions.select(node.id);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {content}

      {issue && (
        <span
          title={issue}
          aria-label={`This block needs attention: ${issue}`}
          className="pointer-events-none absolute left-1 top-1 z-20 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-white/70"
        />
      )}

      {(selected || hovered) && (
        <div className="absolute right-1 top-1 z-20 flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] font-medium shadow-[var(--shadow-pop)]">
          <button
            type="button"
            draggable
            onDragStart={(event: DragEvent) => {
              const payload: DragPayload = { kind: 'move', id: node.id, childType: node.type };
              if (!startDrag(event, payload, label)) return;
              common.setDrag(payload);
            }}
            onDragEnd={() => {
              common.setDrag(null);
              common.setOver(null);
            }}
            title="Drag to move"
            aria-label={`Move ${label}`}
            className="cursor-grab rounded p-0.5 text-muted hover:bg-black/[.05] hover:text-ink active:cursor-grabbing"
          >
            <GripVertical size={13} />
          </button>
          <span className="max-w-[150px] truncate text-ink-soft">
            <BlockIcon name={def?.icon ?? ''} size={11} className="mr-1 inline align-[-1px]" />
            {issue ? `${label} · needs attention` : label}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              common.actions.duplicate(node.id);
            }}
            title="Duplicate"
            aria-label={`Duplicate ${label}`}
            className="rounded p-0.5 text-muted hover:bg-black/[.05] hover:text-ink"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              common.actions.remove(node.id);
            }}
            title="Delete"
            aria-label={`Delete ${label}`}
            className="rounded p-0.5 text-muted hover:bg-[#fcebea] hover:text-[#a50f0f]"
          >
            <Trash size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function ContainerBody({ node, common }: { node: BlockNode; common: Common }) {
  const { outer, inner } = containerStyle(node, { ...common.ctx, mode: 'canvas' });

  if (node.type === 'section') {
    return (
      <section className="site-block" style={outer}>
        <div style={inner}>
          <ChildList nodes={node.children} parentId={node.id} parentType="section" common={common} gap={14} />
        </div>
      </section>
    );
  }

  return (
    <div className="site-block" style={outer}>
      <ChildList
        nodes={node.children}
        parentId={node.id}
        parentType={node.type === 'columns' ? 'columns' : 'container'}
        common={common}
        gap={node.type === 'columns' ? 0 : 12}
      />
    </div>
  );
}

export function Canvas({
  tree,
  ctx,
  actions,
  drag,
  setDrag,
  selectedId,
  issues,
  device,
}: {
  tree: PageTree;
  ctx: RenderContext;
  actions: CanvasActions;
  drag: DragPayload | null;
  setDrag: (payload: DragPayload | null) => void;
  selectedId: string | null;
  issues: Record<string, string>;
  device: Device;
}) {
  const [over, setOver] = useState<Place | null>(null);
  const common: Common = { ctx, actions, drag, setDrag, over, setOver, selectedId, issues };
  const width = DEVICE_WIDTH[device];
  const surface = ctx.theme.colors?.surface ?? '#FFFFFF';

  return (
    <div
      className="relative flex-1 overflow-y-auto bg-canvas"
      onClick={() => actions.select(null)}
      onDragEnd={() => {
        setDrag(null);
        setOver(null);
      }}
    >
      <div
        className="site-render mx-auto min-h-full px-3 py-6"
        style={{
          ...themeToVars(ctx.theme),
          maxWidth: width ? `${width}px` : '1180px',
          background: surface,
          border: '1px solid var(--color-line)',
          borderRadius: '10px',
          boxShadow: 'var(--shadow-panel)',
          marginBottom: '96px',
        }}
      >
        <ChildList nodes={tree.children} parentId={tree.id} parentType="page" common={common} gap={14} />

        {tree.children.length === 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-line-strong bg-raised p-6">
            <p className="text-[13.5px] font-medium text-ink">This page is empty</p>
            <p className="mt-1 text-[12.5px] text-muted">
              Drag a block from the left panel, or start with one of these. The canvas is yours from here.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_ADD.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.addBlock(type, { parentId: tree.id, index: tree.children.length });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:border-brand hover:text-brand-dark"
                >
                  <BlockIcon name={REGISTRY[type]?.icon ?? ''} size={13} />
                  {REGISTRY[type]?.label ?? type}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

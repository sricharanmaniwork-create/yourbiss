'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BlockNode, PageTree } from '@/lib/blocks/types';
import { REGISTRY } from '@/lib/blocks/registry';
import { isContainer } from '@/lib/blocks/tree';
import { blockLabel } from '@/lib/blocks/render';
import { BlockIcon } from './block-icon';
import { cn } from '@/lib/utils';

/**
 * The layer list. Sections inside sections inside columns get hard to aim at
 * with carets alone, so this is the other way into the tree: pick the node you
 * mean and the canvas scrolls to it.
 */
export function Outline({
  tree,
  selectedId,
  issues,
  onSelect,
}: {
  tree: PageTree;
  selectedId: string | null;
  issues: Record<string, string>;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2.5">
      <Row node={tree} depth={0} selectedId={selectedId} issues={issues} onSelect={onSelect} isPage />
      {tree.children.length === 0 && (
        <p className="px-1 py-2 text-[12px] text-muted">No blocks on this page yet.</p>
      )}
    </div>
  );
}

function Row({
  node,
  depth,
  selectedId,
  issues,
  onSelect,
  isPage = false,
}: {
  node: BlockNode | PageTree;
  depth: number;
  selectedId: string | null;
  issues: Record<string, string>;
  onSelect: (id: string | null) => void;
  isPage?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const def = REGISTRY[node.type as BlockNode['type']];
  const expandable = node.children.length > 0;
  const selected = selectedId === node.id;
  const issue = issues[node.id];

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md pr-1 text-[12.5px]',
          selected ? 'bg-brand/10 text-brand-dark' : 'hover:bg-raised text-ink-soft',
        )}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        {expandable ? (
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? `Expand ${def?.label ?? node.type}` : `Collapse ${def?.label ?? node.type}`}
            aria-expanded={!collapsed}
            className="rounded p-0.5 text-muted hover:text-ink"
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span className="w-[17px]" />
        )}

        <button
          type="button"
          onClick={() => onSelect(isPage ? null : node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left"
        >
          {!isPage && <BlockIcon name={def?.icon ?? ''} size={12} className="flex-none opacity-70" />}
          <span className="truncate">{isPage ? 'Page' : blockLabel(node as BlockNode)}</span>
          {issue && <span title={issue} className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-danger" />}
        </button>
      </div>

      {!collapsed &&
        node.children.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            issues={issues}
            onSelect={onSelect}
          />
        ))}

      {!collapsed && expandable === false && isContainer(node.type as BlockNode['type']) && !isPage && (
        <p className="py-1 text-[11px] text-muted" style={{ paddingLeft: `${22 + depth * 12}px` }}>
          Empty
        </p>
      )}
    </div>
  );
}

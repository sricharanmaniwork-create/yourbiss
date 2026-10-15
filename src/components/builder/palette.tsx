'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { BlockType } from '@/lib/blocks/types';
import { BLOCK_DEFS, GROUPS, REGISTRY } from '@/lib/blocks/registry';
import { canContain } from '@/lib/blocks/tree';
import { BlockIcon } from './block-icon';
import { startDrag } from './drag';
import { Input } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The left-hand block library.
 *
 * A drag drops on the caret under the pointer; a click appends to wherever the
 * editor is currently aimed. Both are offered because a click is far quicker
 * once you know what you want, and a caret is the only way to say "here, not
 * there".
 */

export type PaletteTarget = 'page' | 'section' | 'container' | 'columns';

export function Palette({
  target,
  onAdd,
}: {
  target: PaletteTarget;
  onAdd: (type: BlockType) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return GROUPS.map((group) => ({
      group,
      defs: BLOCK_DEFS.filter(
        (def) =>
          def.group === group &&
          (needle === '' ||
            def.label.toLowerCase().includes(needle) ||
            def.description.toLowerCase().includes(needle) ||
            def.type.includes(needle)),
      ),
    })).filter((entry) => entry.defs.length > 0);
  }, [query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2.5">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blocks"
            aria-label="Search blocks"
            className="h-8 pl-7 text-[12.5px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
        {groups.length === 0 && (
          <p className="mt-4 px-1 text-[12.5px] text-muted">
            No block matches “{query}”. Try a word like “price”, “form” or “map”.
          </p>
        )}

        {groups.map(({ group, defs }) => (
          <section key={group} className="pt-3">
            <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">{group}</h3>
            <ul className="grid gap-1">
              {defs.map((def) => {
                const fits = canContain(target, def.type);
                return (
                  <li key={def.type}>
                    <button
                      type="button"
                      draggable={fits}
                      onDragStart={(event) => {
                        startDrag(event, { kind: 'new', type: def.type }, def.label);
                      }}
                      onClick={() => onAdd(def.type)}
                      disabled={!fits}
                      title={
                        fits
                          ? `${def.description} — drag onto the canvas, or click to add here`
                          : `Cannot go inside a ${target}. Select a ${def.allowedIn.join(' or ')} first.`
                      }
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors',
                        fits ? 'cursor-grab hover:border-line hover:bg-raised active:cursor-grabbing' : 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded border border-line bg-surface text-ink-soft">
                        <BlockIcon name={def.icon} size={13} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium text-ink">{def.label}</span>
                        <span className="block text-[11px] leading-snug text-muted">{def.description}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <p className="mt-5 px-1 text-[11px] leading-relaxed text-muted">
          {Object.keys(REGISTRY).length} blocks. Drag one onto the dotted caret where it should land.
        </p>
      </div>
    </div>
  );
}

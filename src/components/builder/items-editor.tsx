'use client';

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import type { ItemsControl } from '@/lib/blocks/controls';
import { ControlView, type EntityOptions } from './control-view';

type Item = Record<string, unknown>;

function titleOf(item: Item, items: ItemsControl): string {
  const raw = item[items.titleKey];
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text === '' ? `Untitled ${items.itemLabel.toLowerCase()}` : text.slice(0, 46);
}

/**
 * The repeater for a block's list property (buttons, cards, plans, FAQ rows…).
 *
 * Rows collapse so a 12-card grid does not turn the panel into a wall of
 * inputs, and every edit rebuilds the array instead of writing into it — the
 * undo stack snapshots the whole tree, and a mutation in place would leave the
 * snapshot and the live tree sharing an object.
 */
export function ItemsEditor({
  items,
  value,
  onChange,
  options,
  onPickImage,
}: {
  items: ItemsControl;
  value: unknown;
  onChange: (next: Item[]) => void;
  options: EntityOptions;
  onPickImage?: (apply: (url: string) => void) => void;
}) {
  const rows = Array.isArray(value) ? (value as Item[]) : [];
  const [open, setOpen] = useState<number[]>([]);

  const setRow = (index: number, next: Item) =>
    onChange(rows.map((row, i) => (i === index ? next : row)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const from = rows[index];
    const to = rows[target];
    if (target < 0 || target >= rows.length || !from || !to) return;
    const copy = [...rows];
    copy[index] = to;
    copy[target] = from;
    onChange(copy);
    setOpen([target]);
  };

  const add = () => {
    onChange([...rows, { ...items.blank }]);
    setOpen([rows.length]);
  };

  return (
    <div className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{items.label}</p>
        <span className="text-[11.5px] text-muted">
          {rows.length}/{items.max}
        </span>
      </div>

      <ul className="grid gap-1.5">
        {rows.map((row, index) => {
          const expanded = open.includes(index);
          const title = titleOf(row, items);
          return (
            <li key={index} className="rounded-md border border-line bg-surface">
              <div className="flex items-center gap-0.5 px-1 py-1">
                <button
                  type="button"
                  onClick={() => setOpen((current) => (current.includes(index) ? current.filter((v) => v !== index) : [...current, index]))}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[12.5px] font-medium text-ink hover:bg-raised"
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="truncate">{title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${title} up`}
                  className="rounded p-1 text-muted hover:bg-black/[.05] hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rows.length - 1}
                  aria-label={`Move ${title} down`}
                  className="rounded p-1 text-muted hover:bg-black/[.05] hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  aria-label={`Remove ${title}`}
                  className="rounded p-1 text-muted hover:bg-[#fcebea] hover:text-[#a50f0f]"
                >
                  <Trash size={12} />
                </button>
              </div>

              {expanded && (
                <div className="grid gap-3 border-t border-line px-2.5 py-3">
                  {items.controls.map((control) => (
                    <ControlView
                      key={control.key}
                      control={control}
                      value={row[control.key]}
                      onChange={(next) => setRow(index, { ...row, [control.key]: next })}
                      options={options}
                      onPickImage={onPickImage}
                    />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && (
        <p className="mt-1 text-[11.5px] text-muted">
          Nothing in this list yet — the block renders empty until you add a {items.itemLabel.toLowerCase()}.
        </p>
      )}

      {rows.length < items.max ? (
        <button
          type="button"
          onClick={add}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2.5 py-1.5 text-[12.5px] font-medium text-ink-soft hover:border-brand hover:text-brand-dark"
        >
          <Plus size={13} />
          Add {items.itemLabel.toLowerCase()}
        </button>
      ) : (
        <p className="mt-2 text-[11.5px] text-muted">{items.max} is the most this block can hold.</p>
      )}
    </div>
  );
}

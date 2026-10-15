'use client';

import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  badge?: number | string;
  disabled?: boolean;
}

/**
 * Underline tabs — the shape Zoho uses for in-page sections. `role="tablist"`
 * with arrow-key movement so the group behaves as one control.
 */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const move = (from: number, delta: number) => {
    let i = from;
    for (let step = 0; step < items.length; step++) {
      i = (i + delta + items.length) % items.length;
      const candidate = items[i];
      if (candidate && !candidate.disabled) {
        onChange(candidate.id);
        return;
      }
    }
  };

  return (
    <div
      role="tablist"
      onKeyDown={(event) => {
        const index = items.findIndex((item) => item.id === value);
        if (index < 0) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(index, 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(index, -1);
        }
      }}
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative -mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:border-line-strong hover:text-ink',
              item.disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {item.label}
            {item.badge !== undefined && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-[1px] text-[11px]',
                  active ? 'bg-brand-soft text-brand-dark' : 'bg-[#eef0f3] text-[#41474f]',
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GripVertical } from 'lucide-react';
import { moveCrmDeal } from '@/lib/actions/crm';
import type { CrmDeal, CrmStage } from '@/lib/types';
import { cn, formatAmount } from '@/lib/utils';

/**
 * The pipeline as a board.
 *
 * A card moves by drag or by the select on its back side, and both call the same
 * action with nothing but a stage id: whether the move wins, loses or simply
 * advances is decided by the stage&rsquo;s kind in the database, so a card dropped on
 * &ldquo;Won&rdquo; cannot arrive with a state that disagrees with its column.
 *
 * Totals are counted here, from the rows already on the page, rather than read from
 * a stored number that could be out of date by the time somebody looks.
 */
export function DealBoard({
  deals,
  stages,
  currency,
  locale,
}: {
  deals: CrmDeal[];
  stages: CrmStage[];
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const moveTo = (dealId: string, stageId: string) => {
    start(async () => {
      await moveCrmDeal(dealId, stageId);
      router.refresh();
    });
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {stages.map((stage) => {
        const cards = deals.filter((deal) => deal.stage_id === stage.id);
        const value = cards.reduce((total, deal) => total + Number(deal.amount), 0);

        return (
          <section
            key={stage.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dealId = event.dataTransfer.getData('text/plain');
              if (dealId && dealId !== stage.id) moveTo(dealId, stage.id);
            }}
            className="flex w-[268px] flex-none flex-col rounded-lg border border-line bg-raised"
            aria-label={`${stage.name}, ${cards.length} deal${cards.length === 1 ? '' : 's'}`}
          >
            <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{stage.name}</span>
              <span className={cn('text-[11.5px]', pending ? 'text-brand' : 'text-muted')}>{cards.length}</span>
            </header>

            <p className="px-3 pt-2 text-[11.5px] text-muted">{formatAmount(value, currency, locale)}</p>

            <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
              {cards.length === 0 && (
                <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[11.5px] leading-relaxed text-muted">
                  Nothing here yet
                </p>
              )}

              {cards.map((deal) => (
                <article
                  key={deal.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', deal.id)}
                  className="group rounded-md border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-card)] transition-colors hover:border-brand"
                >
                  <Link href={`/app/crm/deals/${deal.id}`} className="block min-w-0">
                    <span className="flex items-start gap-1.5">
                      <GripVertical size={13} className="mt-0.5 flex-none cursor-grab text-[#c3cad3]" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{deal.title}</span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                          {deal.contact?.name ?? deal.lead?.name ?? 'Nobody named yet'}
                        </span>
                      </span>
                    </span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-ink">{formatAmount(Number(deal.amount), currency, locale)}</span>
                      {deal.owner && <span className="truncate text-[11px] text-muted">{deal.owner.display_name}</span>}
                    </span>
                    {deal.expected_close && (
                      <span className="mt-1 block text-[11px] text-muted">closes {deal.expected_close}</span>
                    )}
                  </Link>

                  {/* Dragging is the fast path; this is the one that works on a phone
                      and on a keyboard, and it writes exactly the same thing. */}
                  <label className="sr-only" htmlFor={`move-${deal.id}`}>
                    Move the deal “{deal.title}” to another stage
                  </label>
                  <select
                    id={`move-${deal.id}`}
                    value={deal.stage_id}
                    onChange={(event) => moveTo(deal.id, event.target.value)}
                    className="mt-2 h-7 w-full rounded border border-line bg-raised px-1.5 text-[11.5px] text-ink-soft"
                  >
                    {stages.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

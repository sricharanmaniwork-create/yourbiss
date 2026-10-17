'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check } from 'lucide-react';
import { moveCard } from '@/lib/actions/board';
import { Button } from '@/components/ui';
import type { BoardTask } from '@/lib/types';
import { cn, formatDateInZone } from '@/lib/utils';

/**
 * The work assigned to the person reading it, across every board in the workspace.
 *
 * &ldquo;Mark done&rdquo; does not set a date or a flag. It looks up which lane on that card&rsquo;s own
 * board is the one marked as finished and moves the card there — the same write a drag on the
 * board makes, so the two screens cannot disagree about what finished means, and a card is
 * never marked done in a lane called To do.
 *
 * A board with no finished lane is said so rather than guessed around. Inventing a lane from
 * here would write a row the person on that board never asked for.
 */
export function MyTaskList({
  cards,
  doneByBoard,
  zone,
  nowIso,
}: {
  cards: BoardTask[];
  doneByBoard: Record<string, string>;
  zone: string;
  nowIso: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const now = new Date(nowIso).getTime();

  const finish = (cardId: string, laneId: string) => {
    start(async () => {
      await moveCard(cardId, laneId);
      router.refresh();
    });
  };

  return (
    <ul className="divide-y divide-line">
      {cards.map((card) => {
        const laneId = doneByBoard[card.project_id];
        const overdue = card.due_at !== null && new Date(card.due_at).getTime() < now;

        return (
          <li key={card.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-[220px] flex-1">
              <p className={cn('text-[13.5px] font-medium', overdue ? 'text-danger' : 'text-ink')}>{card.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                <Link href={`/app/board/${card.project_id}`} className="hover:text-brand">
                  {card.project?.name ?? 'a board that is gone'}
                </Link>
                <span>{card.lane?.name ?? 'a lane that is gone'}</span>
                {card.due_at && (
                  <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-danger')}>
                    <CalendarDays size={11} aria-hidden="true" />
                    {overdue ? 'overdue since ' : 'due '}
                    {formatDateInZone(card.due_at, zone)}
                  </span>
                )}
                {!card.due_at && <span>no due day</span>}
              </p>
              {card.details && <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{card.details}</p>}
            </div>

            {laneId ? (
              <Button size="sm" loading={pending} onClick={() => finish(card.id, laneId)}>
                <Check size={13} aria-hidden="true" />
                Mark done
              </Button>
            ) : (
              <span className="text-[12px] leading-relaxed text-muted">
                <Link href={`/app/board/${card.project_id}`} className="text-brand hover:text-brand-dark">
                  {card.project?.name ?? 'This board'}
                </Link>{' '}
                has no lane marked as finished
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

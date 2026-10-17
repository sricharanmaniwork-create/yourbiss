'use client';

import { useRouter } from 'next/navigation';
import { CalendarClock, CheckSquare, MessageSquare, Phone, Trash2, Users } from 'lucide-react';
import { deleteCrmActivity, setCrmTaskDone } from '@/lib/actions/crm';
import { useAction } from '@/components/ui';
import type { CrmActivity } from '@/lib/types';
import { cn, formatInZone } from '@/lib/utils';

const ICONS = {
  note: MessageSquare,
  call: Phone,
  meeting: Users,
  task: CheckSquare,
} as const;

const LABELS: Record<CrmActivity['kind'], string> = {
  note: 'Note',
  call: 'Call',
  meeting: 'Meeting',
  task: 'Task',
};

/**
 * A record's history, oldest to newest on the screen but newest first in the list:
 * the last thing that happened is what somebody reading this needs.
 *
 * A task is ticked here and nowhere else — `done_at` is the only state it has, and
 * the same column is what the hub counts open tasks against.
 *
 * `nowIso` is read on the server that rendered the page and passed down, because a
 * client component asking the clock for itself re-decides which tasks are overdue on
 * every re-render.
 */
export function ActivityTimeline({
  activities,
  userId,
  canAdmin,
  timezone,
  locale,
  nowIso,
}: {
  activities: CrmActivity[];
  userId: string;
  canAdmin: boolean;
  timezone: string;
  locale: string;
  nowIso: string;
}) {
  const router = useRouter();
  const { state, run } = useAction();

  const tick = (activity: CrmActivity) => {
    void run(async () => {
      const result = await setCrmTaskDone(activity.id, activity.done_at === null);
      if (result.ok) router.refresh();
      return result;
    });
  };

  const remove = (activity: CrmActivity) => {
    void run(async () => {
      const result = await deleteCrmActivity(activity.id);
      if (result.ok) router.refresh();
      return result;
    });
  };

  if (activities.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line px-3.5 py-4 text-[12.5px] leading-relaxed text-muted">
        Nothing written about this record yet. A line now — who called, what was agreed, what happens next — is what
        makes this readable in three months.
      </p>
    );
  }

  return (
    <div>
      {state && !state.ok && (
        <p role="alert" className="mb-2 rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3 py-2 text-[12px] text-[#a50f0f]">
          {state.error}
        </p>
      )}
      <ul className="divide-y divide-line">
        {activities.map((activity) => {
          const Icon = ICONS[activity.kind];
          const isTask = activity.kind === 'task';
          const done = activity.done_at !== null;
          const overdue =
            isTask && !done && activity.due_at !== null && new Date(activity.due_at).getTime() < new Date(nowIso).getTime();
          const canRemove = canAdmin || activity.created_by === userId;

          return (
            <li key={activity.id} className="flex gap-3 py-3">
              <span className="flex-none pt-0.5">
                {isTask ? (
                  <button
                    type="button"
                    onClick={() => tick(activity)}
                    aria-label={done ? 'Mark this task not done' : 'Mark this task done'}
                    className={cn(
                      'flex h-[22px] w-[22px] items-center justify-center rounded-full border transition-colors',
                      done ? 'border-[#15803D] bg-[#15803D] text-white' : 'border-line-strong bg-surface text-muted hover:border-brand hover:text-brand',
                    )}
                  >
                    <CheckSquare size={12} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-line bg-raised text-muted">
                    <Icon size={12} aria-hidden="true" />
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('text-[13px] font-medium text-ink', done && 'line-through text-muted')}>
                    {activity.subject ?? LABELS[activity.kind]}
                  </span>
                  {!isTask && <span className="text-[11px] uppercase tracking-[0.04em] text-muted">{LABELS[activity.kind]}</span>}
                  {overdue && <span className="rounded-full bg-[#fcebea] px-1.5 py-[1px] text-[11px] font-medium text-[#a50f0f]">overdue</span>}
                </span>

                {activity.body && (
                  <span className="mt-1 block whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-soft">{activity.body}</span>
                )}

                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
                  <span>{activity.owner?.display_name ?? 'Nobody owns it now'}</span>
                  {activity.due_at && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock size={11} aria-hidden="true" />
                      due {formatInZone(activity.due_at, timezone, { locale, dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                  {done && activity.done_at && (
                    <span>done {formatInZone(activity.done_at, timezone, { locale, dateStyle: 'medium', timeStyle: 'short' })}</span>
                  )}
                  <span>written by {activity.author?.display_name ?? 'a removed member'}</span>
                </span>
              </span>

              {canRemove && (
                <button
                  type="button"
                  onClick={() => remove(activity)}
                  aria-label="Remove this entry"
                  className="flex-none rounded-md p-1.5 text-muted transition-colors hover:bg-[#fcebea] hover:text-[#a50f0f]"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

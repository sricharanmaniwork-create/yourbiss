'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { addClosedDay, removeClosedDay } from '@/lib/actions/bookings';
import { Button, Card, CardBody, CardHeader, Field, FormStatus, Input, Spinner, toast, useAction } from '@/components/ui';
import { formatDateInZone, weekdayOf } from '@/lib/utils';
import { weekdayLabel } from '@/lib/bookings/types';

/**
 * Days the whole workspace is shut.
 *
 * This is the coarse instrument: one date takes every team member off the calendar,
 * whatever their week says, because `bookable_days()` checks the closure before it looks
 * at hours. A single person's holiday belongs on their own Days off tab, and the engine
 * treats the two the same way — the difference is only who has to remember to set it.
 *
 * Admin-only, as `bclosed_write` is written: a closure is a business decision that changes
 * every booking page at once, so it is not a button every member gets.
 */
export function ClosedDaysCard({
  orgId,
  days,
  today,
  canAdmin,
}: {
  orgId: string;
  days: { day: string; reason: string | null }[];
  today: string;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [day, setDay] = useState(today);
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const add = () => {
    void run(async () => {
      const result = await addClosedDay(orgId, { day, reason });
      if (result.ok) {
        setReason('');
        toast.success(`The workspace is closed on ${day}`);
        router.refresh();
      }
      return result;
    });
  };

  const drop = (date: string) => {
    setRemoving(date);
    void (async () => {
      const result = await removeClosedDay(orgId, date).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That date is still closed',
      }));
      setRemoving(null);
      if (!result.ok) {
        toast.error(result.error ?? 'That date is still closed');
        return;
      }
      toast.success(`${date} is open again`);
      router.refresh();
    })();
  };

  const past = days.filter((entry) => entry.day < today);
  const upcoming = days.filter((entry) => entry.day >= today);

  return (
    <Card className="max-w-[720px]">
      <CardHeader
        title="Closed to everyone"
        description="Festivals, a power cut, a day off for the whole business. No slot is offered on these dates, whoever’s week says otherwise."
      />

      <CardBody className="grid gap-4">
        {canAdmin ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-line px-3 py-3">
            <Field label="Date" htmlFor="closed-day" className="w-44" error={fieldError('day')}>
              <Input
                id="closed-day"
                type="date"
                value={day}
                min={today}
                invalid={!!fieldError('day')}
                onChange={(event) => setDay(event.target.value)}
              />
            </Field>
            <Field label="Reason" htmlFor="closed-reason" className="min-w-[180px] flex-1" error={fieldError('reason')}>
              <Input
                id="closed-reason"
                value={reason}
                maxLength={200}
                placeholder="Diwali"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Button variant="primary" loading={pending} disabled={day === ''} onClick={add}>
              <Plus size={14} />
              Close the day
            </Button>
          </div>
        ) : (
          <p className="rounded-md border border-line bg-raised px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
            Closing a whole workspace is an owner or admin decision, so it is read-only here. The dates still stop every
            booking page.
          </p>
        )}

        <FormStatus state={state} />

        {days.length === 0 ? (
          <p className="rounded-md border border-line bg-raised px-3 py-4 text-center text-[12.5px] text-ink-muted">
            Nothing is closed. Every date follows the weekly hours.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {upcoming.map((entry) => (
              <Row key={entry.day} entry={entry} canAdmin={canAdmin} removing={removing} onRemove={drop} />
            ))}
          </ul>
        )}

        {past.length > 0 && (
          <p className="text-[11.5px] leading-relaxed text-muted">
            {past.length} closed {past.length === 1 ? 'date is' : 'dates are'} in the past and still listed. They are
            kept because a closure is a record of when the business was shut, not only a filter on future slots; remove
            one to reopen that day.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Row({
  entry,
  canAdmin,
  removing,
  onRemove,
}: {
  entry: { day: string; reason: string | null };
  canAdmin: boolean;
  removing: string | null;
  onRemove: (day: string) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {weekdayLabel(weekdayOf(entry.day))} {formatDateInZone(`${entry.day}T12:00:00Z`, 'UTC')}
        </span>
        <span className="block truncate text-[11.5px] text-muted">{entry.reason || 'No reason recorded'}</span>
      </span>
      {removing === entry.day && <Spinner label="Removing" className="h-4 w-4" />}
      {canAdmin && (
        <button
          type="button"
          onClick={() => onRemove(entry.day)}
          disabled={removing !== null}
          className="text-muted hover:text-danger disabled:opacity-50"
          aria-label={`Reopen ${entry.day} for the workspace`}
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

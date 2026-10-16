'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { addException, removeException } from '@/lib/actions/bookings';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  FormStatus,
  Input,
  Select,
  Spinner,
  toast,
  useAction,
} from '@/components/ui';
import { toInputTime, weekdayLabel } from '@/lib/bookings/types';
import { formatDateInZone, weekdayOf } from '@/lib/utils';
import type { BookingException } from '@/lib/types';

/**
 * The days that do not follow the week: a public holiday, a training day, one Saturday
 * of extra hours.
 *
 * A `closed` entry empties a day that the weekly calendar would otherwise fill; an
 * `extra` one is the only way to open a day the week leaves shut — the engine reads
 * exceptions first, so this list is the whole story for that date. Only one `closed` row
 * per day is allowed by the index in 0005, which is why adding one over an existing entry
 * says so instead of offering a second.
 */
export function ExceptionEditor({
  staffId,
  timezone,
  exceptions,
  today,
  canManage,
  onSaved,
}: {
  staffId: string;
  timezone: string;
  exceptions: BookingException[];
  today: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [removing, setRemoving] = useState<string | null>(null);

  const [day, setDay] = useState(today);
  const [kind, setKind] = useState<'closed' | 'extra'>('closed');
  const [startsAt, setStartsAt] = useState('10:00');
  const [endsAt, setEndsAt] = useState('14:00');
  const [reason, setReason] = useState('');

  const add = () => {
    void run(async () => {
      const result = await addException(staffId, {
        day,
        kind,
        starts_at: kind === 'extra' ? startsAt : '',
        ends_at: kind === 'extra' ? endsAt : '',
        reason,
      });
      if (result.ok) {
        setReason('');
        toast.success(kind === 'closed' ? `Closed ${day}` : `Added hours on ${day}`);
        onSaved();
        router.refresh();
      }
      return result;
    });
  };

  const drop = (exceptionId: string) => {
    setRemoving(exceptionId);
    void (async () => {
      const result = await removeException(exceptionId).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That entry is still there',
      }));
      setRemoving(null);
      if (!result.ok) {
        toast.error(result.error ?? 'That entry is still there');
        return;
      }
      toast.success('Entry removed');
      onSaved();
      router.refresh();
    })();
  };

  const badTimes = kind === 'extra' && (!startsAt || !endsAt || startsAt >= endsAt);

  return (
    <div className="grid gap-4 xl:max-w-[900px] xl:grid-cols-2 xl:items-start">
      <Card>
        <CardHeader title="Add a day" description="One date, either emptied out or opened up." />
        <CardBody className="grid gap-4">
          <Field label="Date" htmlFor="exc-day" required error={fieldError('day')}>
            <Input
              id="exc-day"
              type="date"
              value={day}
              min={today}
              disabled={!canManage}
              invalid={!!fieldError('day')}
              onChange={(event) => setDay(event.target.value)}
            />
          </Field>

          <Field label="What happens that day?" htmlFor="exc-kind">
            <Select id="exc-kind" value={kind} disabled={!canManage} onChange={(event) => setKind(event.target.value as 'closed' | 'extra')}>
              <option value="closed">Take the day off — no times at all</option>
              <option value="extra">Open extra hours the week does not offer</option>
            </Select>
          </Field>

          {kind === 'extra' && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Opens" htmlFor="exc-open" error={fieldError('starts_at')}>
                <Input
                  id="exc-open"
                  type="time"
                  step={300}
                  value={startsAt}
                  disabled={!canManage}
                  invalid={!!fieldError('starts_at') || badTimes}
                  className="w-32"
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </Field>
              <Field label="Closes" htmlFor="exc-close" error={fieldError('ends_at')}>
                <Input
                  id="exc-close"
                  type="time"
                  step={300}
                  value={endsAt}
                  disabled={!canManage}
                  invalid={!!fieldError('ends_at') || badTimes}
                  className="w-32"
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </Field>
            </div>
          )}

          {badTimes && <p className="text-[12px] text-danger">Extra hours have to close after they open.</p>}

          <Field label="Reason" htmlFor="exc-reason" hint="Shown to nobody but the workspace" error={fieldError('reason')}>
            <Input
              id="exc-reason"
              value={reason}
              maxLength={200}
              placeholder="Diwali, conference, training day"
              disabled={!canManage}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <p className="text-[11.5px] leading-relaxed text-muted">
            Hours are judged in {timezone.replace(/_/g, ' ')}, so an extra day written for a person who works in another
            city opens the clock they actually keep.
          </p>
        </CardBody>

        <CardFooter>
          <span className="mr-auto max-w-[420px] text-[12px] leading-relaxed text-danger">
            <FormStatus state={state} />
          </span>
          <Button
            variant="primary"
            loading={pending}
            disabled={!canManage || day === '' || badTimes}
            onClick={add}
          >
            <Plus size={14} />
            Add entry
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader
          title="Dates that differ"
          description={exceptions.length === 0 ? 'Nothing overrides the week yet.' : `${exceptions.length} entr${exceptions.length === 1 ? 'y' : 'ies'}.`}
        />
        <CardBody className="grid gap-1.5">
          {exceptions.length === 0 ? (
            <p className="rounded-md border border-line bg-raised px-3 py-4 text-center text-[12.5px] text-ink-muted">
              Every date follows the weekly hours.
            </p>
          ) : (
            exceptions.map((exception) => (
              <div key={exception.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {weekdayLabel(weekdayOf(exception.day))} {formatDateInZone(`${exception.day}T12:00:00Z`, 'UTC')}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {exception.kind === 'closed'
                      ? 'Closed all day'
                      : `${toInputTime(exception.starts_at)}–${toInputTime(exception.ends_at)}`}
                    {exception.reason ? ` · ${exception.reason}` : ''}
                  </span>
                </span>
                <span className={`flex-none text-[11px] font-medium ${exception.kind === 'closed' ? 'text-danger' : 'text-success'}`}>
                  {exception.kind === 'closed' ? 'Day off' : 'Extra'}
                </span>
                {removing === exception.id && <Spinner label="Removing" className="h-4 w-4" />}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => exception.id && drop(exception.id)}
                    disabled={removing !== null}
                    className="text-muted hover:text-danger disabled:opacity-50"
                    aria-label={`Remove the ${exception.kind} entry for ${exception.day}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}

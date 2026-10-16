'use client';

import { useMemo, useState } from 'react';
import { CalendarX2, MoveHorizontal } from 'lucide-react';
import { Button, StatusBadge } from '@/components/ui';
import { SlotPicker, type ChosenSlot, type LoadDays, type LoadSlots } from './slot-picker';
import { dateInZone, formatInZone } from '@/lib/utils';

/**
 * Cancel or move a booking without signing in.
 *
 * The reference in the mail link is only half of what is needed: the email address that
 * made the booking has to match the row too, because a 9-character reference drawn from
 * a 31-letter alphabet is enumerable by anyone with patience. `/api/book/manage` insists
 * on both, and so does `cancel_booking()` and `reschedule_booking()` behind it — this
 * panel asks for the pair and shows whatever the database agrees to.
 *
 * A move reads the grid in the zone stored on the booking, not in the team member's
 * current one, so the chip a customer clicks is the instant `reschedule_booking` will
 * re-check in. The two only part ways when someone's hours are edited after a booking,
 * and then the row's own zone is the one that has to win.
 */

interface ManagedBooking {
  code: string;
  state: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  service_name: string;
  staff_name: string;
  org_name: string;
  service_id: string;
  staff_id: string;
  book_path: string;
  horizon_days: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

interface ManageResult {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
  message?: string;
  booking?: ManagedBooking;
}

export interface ManagePanelProps {
  /** The reference the confirmation mail carried, already on the address. */
  initialCode: string;
  loadDays: LoadDays;
  loadSlots: LoadSlots;
}

const CLOSED = ['cancelled', 'completed', 'no_show'];

export function ManagePanel({ initialCode, loadDays, loadSlots }: ManagePanelProps) {
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState('');
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'lookup' | 'cancel' | 'move' | null>(null);
  const [moving, setMoving] = useState(false);
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [reason, setReason] = useState('');

  // Only ever rendered after a lookup the customer triggered, so this instant is the
  // browser's own — and the day strip still starts where the booking's zone says today is.
  const today = useMemo(() => (booking ? dateInZone(new Date(), booking.timezone) : ''), [booking]);

  const ask = async (intent: 'lookup' | 'cancel' | 'reschedule', extra?: Record<string, string>) => {
    if (busy) return;
    setBusy(intent === 'lookup' ? 'lookup' : intent === 'cancel' ? 'cancel' : 'move');
    setNotice(null);
    setErrors({});
    try {
      const response = await fetch('/api/book/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent, code, email, ...extra }),
      });
      const result = (await response.json().catch(() => null)) as ManageResult | null;

      if (!response.ok || !result?.ok) {
        setErrors(result?.fields ?? {});
        setNotice(result?.error ?? 'That request could not be completed. Please try again.');
        if (intent === 'reschedule') setMoving(false);
        return;
      }

      if (result.booking) setBooking(result.booking);
      setMessage(result.message ?? null);
      if (intent !== 'lookup') {
        setMoving(false);
        setChosen(null);
        setReason('');
      }
    } catch {
      setNotice('Your connection dropped. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!booking) {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask('lookup');
        }}
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Both come from the confirmation mail: the reference and the address you booked with. Without the pair, nothing
          here can be read.
        </p>

        {notice && (
          <p role="alert" className="rounded-md border border-[#f0c3bf] bg-[#fdf2f1] px-3 py-2 text-[12.5px] text-danger">
            {notice}
          </p>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Reference</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-[13.5px] uppercase text-ink focus:border-brand"
            placeholder="R7K2M9QD"
          />
          {errors.code && <span className="mt-1 block text-[12px] text-danger">{errors.code}</span>}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Email address</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            maxLength={320}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
          />
          {errors.email && <span className="mt-1 block text-[12px] text-danger">{errors.email}</span>}
        </label>

        <Button type="submit" variant="primary" loading={busy === 'lookup'}>
          Find my booking
        </Button>
      </form>
    );
  }

  const closed = CLOSED.includes(booking.state);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] uppercase tracking-wide text-ink-muted">{booking.org_name}</p>
          <h2 className="mt-0.5 truncate text-[16px] font-semibold text-ink">{booking.service_name}</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            {formatInZone(booking.starts_at, booking.timezone)} · with {booking.staff_name}
          </p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Reference <span className="font-mono">{booking.code}</span>
          </p>
        </div>
        <StatusBadge state={booking.state} />
      </div>

      {message && (
        <p role="status" className="rounded-md border border-[#c6e7d0] bg-[#e6f4ea] px-3 py-2 text-[12.5px] text-[#0b6b3c]">
          {message}
        </p>
      )}
      {notice && (
        <p role="alert" className="rounded-md border border-[#f0c3bf] bg-[#fdf2f1] px-3 py-2 text-[12.5px] text-danger">
          {notice}
        </p>
      )}
      {booking.cancelled_at && (
        <p className="rounded-md border border-line bg-raised px-3 py-2 text-[12.5px] text-ink-muted">
          Cancelled {formatInZone(booking.cancelled_at, booking.timezone)}
          {booking.cancel_reason ? ` — ${booking.cancel_reason}` : ''}
        </p>
      )}

      {closed ? (
        <p className="text-[13px] text-ink-soft">
          This booking is {booking.state.replace(/_/g, ' ')}. You can still{' '}
          <a className="text-brand underline underline-offset-2" href={booking.book_path}>
            book again
          </a>{' '}
          from the same page.
        </p>
      ) : moving ? (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-soft">Pick the new time. Today&apos;s booking stands until you confirm this.</p>
          <SlotPicker
            serviceId={booking.service_id}
            team={[]}
            timeZone={booking.timezone}
            pinnedZone={booking.timezone}
            today={today}
            horizonDays={booking.horizon_days}
            loadDays={loadDays}
            loadSlots={loadSlots}
            onChoose={setChosen}
            lockedStaff={{ id: booking.staff_id, name: booking.staff_name }}
          />
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <Button
              onClick={() => {
                setMoving(false);
                setChosen(null);
              }}
              disabled={busy !== null}
            >
              Keep the current time
            </Button>
            <Button
              variant="primary"
              disabled={!chosen || busy !== null}
              loading={busy === 'move'}
              onClick={() => void ask('reschedule', chosen ? { starts_at: chosen.startsAt } : undefined)}
            >
              Move to this time
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button onClick={() => setMoving(true)}>
            <MoveHorizontal size={14} />
            Move the booking
          </Button>
          <Button variant="outlineDanger" loading={busy === 'cancel'} onClick={() => void ask('cancel', { reason })}>
            <CalendarX2 size={14} />
            Cancel it
          </Button>
        </div>
      )}

      {!closed && !moving && (
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Reason for cancelling (optional)</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Only so the business knows what happened"
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-[#9aa3af] focus:border-brand"
          />
        </label>
      )}

      <p className="text-[11.5px] text-ink-muted">
        Not the booking you meant?{' '}
        <button
          type="button"
          className="text-brand underline underline-offset-2"
          onClick={() => {
            setBooking(null);
            setMessage(null);
            setNotice(null);
            setMoving(false);
            setChosen(null);
          }}
        >
          Look up another
        </button>
      </p>
    </div>
  );
}

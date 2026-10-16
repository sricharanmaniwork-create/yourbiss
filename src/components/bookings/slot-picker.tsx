'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { addDays, clockInZone, formatDateInZone, initials, weekdayOf } from '@/lib/utils';
import { slotReason, weekdayLabel, type DayCell, type PublicStaff, type SlotCell } from '@/lib/bookings/types';
import type { ActionState } from '@/lib/types';

/**
 * The calendar a customer picks a slot from — and the same one the workspace uses when
 * it books on someone's behalf.
 *
 * Nothing here decides what is free. `loadDays` and `loadSlots` are server actions that
 * answer with `bookable_days()` and `available_slots()`, both built on
 * `slot_conflict()`, so a chip this component renders as clickable is a slot
 * `create_booking()` will accept. That is the whole reason the two callers can share one
 * component: they ask the same question of the same function.
 *
 * The actions arrive as props rather than being imported here so the admin panel can
 * hand over a grid guarded by workspace membership while the public page hands over the
 * anonymous guard. The component cannot tell the difference and does not need to.
 */

export type LoadDays = (input: { serviceId: string; staffId: string; from: string }) => Promise<ActionState & { days?: DayCell[] }>;
export type LoadSlots = (input: { serviceId: string; staffId: string; day: string; tz?: string }) => Promise<
  ActionState & { slots?: SlotCell[] }
>;

export interface ChosenSlot {
  staffId: string;
  startsAt: string;
  endsAt: string;
}

export interface SlotPickerProps {
  serviceId: string;
  team: PublicStaff[];
  /** The zone the grid is read in — a staff row without one falls back to the service's. */
  timeZone: string;
  /** Today in `timeZone`, from the server, so nobody's calendar starts a day apart. */
  today: string;
  /** How far ahead the service lets anyone look; the strip stops paging at the edge. */
  horizonDays: number;
  loadDays: LoadDays;
  loadSlots: LoadSlots;
  onChoose: (slot: ChosenSlot | null) => void;
  accent?: string;
  /** A booking being moved already has its team member, so nobody is asked to pick one. */
  lockedStaff?: { id: string; name: string };
  /**
   * Read and show the grid in this zone rather than in the one the engine would
   * coalesce to. Only a move needs it: the row carries the zone `reschedule_booking`
   * re-checks in, and a staff member whose hours were edited since then would otherwise
   * be offered a grid the write goes on to refuse.
   */
  pinnedZone?: string;
  /** A link that already names the person — `?staff=` on the page or the frame. */
  defaultStaffId?: string;
  /**
   * What to say when nobody offers the service. A customer is told to contact the
   * business; the team recording a booking by hand needs the other sentence — assign
   * someone, then the grid fills itself.
   */
  emptyTeamCopy?: string;
}

/** Two weeks at a time: a full working fortnight, and the strip stays one row tall. */
const PAGE_DAYS = 14;

export function SlotPicker({
  serviceId,
  team,
  timeZone,
  today,
  horizonDays,
  loadDays,
  loadSlots,
  onChoose,
  accent = 'var(--color-brand)',
  lockedStaff,
  pinnedZone,
  defaultStaffId,
  emptyTeamCopy,
}: SlotPickerProps) {
  const choices: PublicStaff[] = lockedStaff
    ? [{ id: lockedStaff.id, name: lockedStaff.name, slug: '', bio: null, avatar_url: null, timezone: timeZone }]
    : team;
  const [staffId, setStaffId] = useState(() => {
    if (lockedStaff) return lockedStaff.id;
    // A link can name a person who has since stopped offering the service; the grid then
    // opens on somebody who can actually be booked with.
    const named = choices.find((row) => row.id === defaultStaffId);
    return (named ?? choices[0])?.id ?? '';
  });
  const [page, setPage] = useState(0);
  const [day, setDay] = useState<string | null>(null);
  // A list is `null` while it is being read and an array once it has been — including an
  // empty array when the read failed, because "no times on this day" and "I could not
  // find out" are different sentences and a flag can go out of step with the data.
  const [days, setDays] = useState<DayCell[] | null>(null);
  const [slots, setSlots] = useState<SlotCell[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // The zone the grid is read and drawn in. A new booking leaves it to the engine —
  // staff, then service — and mirrors that order here; a move pins it to the zone its
  // own row carries, because that is the one `reschedule_booking` re-checks in.
  const member = choices.find((row) => row.id === staffId) ?? null;
  const zone = pinnedZone ?? (member?.timezone || timeZone);

  const maxPage = Math.max(0, Math.ceil(Math.max(1, horizonDays) / PAGE_DAYS) - 1);
  const windowStart = addDays(today, page * PAGE_DAYS);

  // Two sequences, so a slow answer to an earlier question cannot overwrite the
  // calendar the customer has since moved on to.
  const daySeq = useRef(0);
  const slotSeq = useRef(0);

  const clearChoice = useCallback(() => {
    setChosen(null);
    onChoose(null);
  }, [onChoose]);

  const pickStaff = (id: string) => {
    if (id === staffId) return;
    setStaffId(id);
    setPage(0);
    setDay(null);
    setDays(null);
    setSlots(null);
    setNotice(null);
    clearChoice();
  };

  const movePage = (next: number) => {
    if (next === page) return;
    setPage(next);
    // The window this page covers has its own availability, and a day chosen in the
    // last window is no longer on screen — so the choice goes with it.
    setDay(null);
    setDays(null);
    setSlots(null);
    clearChoice();
  };

  useEffect(() => {
    if (!staffId) return;
    const seq = ++daySeq.current;
    const read = async () => {
      const result = await loadDays({ serviceId, staffId, from: windowStart });
      if (seq !== daySeq.current) return;
      if (!result.ok || !result.days) {
        setDays([]);
        setNotice(result.error ?? 'Availability could not be read.');
        return;
      }
      setDays(result.days);
      setNotice(null);
      // Land on the first day that can be booked, so an open calendar never arrives with
      // a blank grid underneath. A day the customer already chose is left alone.
      const [first] = result.days.filter((row) => !row.closed && row.hasFreeSlot);
      setDay((current) => current ?? (first?.day ?? null));
    };
    void read();
  }, [serviceId, staffId, windowStart, loadDays]);

  useEffect(() => {
    if (!day || !staffId) return;
    const seq = ++slotSeq.current;
    const read = async () => {
      const result = await loadSlots({ serviceId, staffId, day, tz: pinnedZone });
      if (seq !== slotSeq.current) return;
      if (!result.ok || !result.slots) {
        setSlots([]);
        setNotice(result.error ?? 'Slots could not be read.');
        return;
      }
      setSlots(result.slots);
    };
    void read();
  }, [serviceId, staffId, day, pinnedZone, loadSlots]);

  const strip = useMemo(() => {
    const byDay = new Map((days ?? []).map((row) => [row.day, row]));
    return Array.from({ length: PAGE_DAYS }, (_, offset) => {
      const date = addDays(windowStart, offset);
      return { date, cell: byDay.get(date) ?? null };
    });
  }, [days, windowStart]);

  const selectSlot = (slot: SlotCell) => {
    if (slot.state !== 'free') return;
    setChosen(slot.startsAt);
    onChoose({ staffId, startsAt: slot.startsAt, endsAt: slot.endsAt });
  };

  const chooseDay = (date: string) => {
    setDay(date);
    setSlots(null);
    clearChoice();
  };

  if (choices.length === 0) {
    return (
      <p className="rounded-md border border-line bg-raised px-4 py-6 text-center text-[13px] text-ink-muted">
        {emptyTeamCopy ?? 'This service has no team member taking bookings yet. Please contact the business.'}
      </p>
    );
  }

  const freeCount = slots?.filter((slot) => slot.state === 'free').length ?? 0;

  return (
    <div className="space-y-5">
      {!lockedStaff && choices.length > 1 && (
        <div>
          <p className="mb-2 text-[12.5px] font-medium text-ink-soft">Who will you see?</p>
          <div className="flex flex-wrap gap-2">
            {choices.map((member) => {
              const on = member.id === staffId;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => pickStaff(member.id)}
                  aria-pressed={on}
                  className={
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors ' +
                    (on ? 'border-transparent text-white' : 'border-line-strong bg-surface text-ink-soft hover:bg-raised')
                  }
                  style={on ? { backgroundColor: accent } : undefined}
                >
                  <span
                    className={
                      'flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10.5px] font-semibold ' +
                      (on ? 'bg-white/20' : 'bg-brand-soft text-brand-dark')
                    }
                    aria-hidden="true"
                  >
                    {initials(member.name)}
                  </span>
                  {member.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {lockedStaff && choices.length === 1 && (
        <p className="text-[13px] text-ink-soft">
          With <span className="font-medium text-ink">{lockedStaff.name}</span>
        </p>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[12.5px] font-medium text-ink-soft">
            {formatDateInZone(`${windowStart}T12:00:00Z`, 'UTC')}
            {' — '}
            {formatDateInZone(`${addDays(windowStart, PAGE_DAYS - 1)}T12:00:00Z`, 'UTC')}
          </p>
          <div className="flex gap-1">
            <Button size="iconSm" aria-label="Earlier dates" disabled={page === 0} onClick={() => movePage(Math.max(0, page - 1))}>
              <ChevronLeft size={15} />
            </Button>
            <Button
              size="iconSm"
              aria-label="Later dates"
              disabled={page >= maxPage}
              onClick={() => movePage(Math.min(maxPage, page + 1))}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" role="group" aria-label="Choose a date">
          {strip.map(({ date, cell }) => {
            const bookable = cell !== null && !cell.closed && cell.hasFreeSlot;
            const on = date === day;
            return (
              <button
                key={date}
                type="button"
                disabled={!bookable}
                onClick={() => {
                  if (!bookable) return;
                  chooseDay(date);
                }}
                aria-pressed={on}
                aria-label={`${weekdayLabel(weekdayOf(date))} ${formatDateInZone(`${date}T12:00:00Z`, 'UTC')}${
                  cell?.closed ? ' — closed' : bookable ? '' : ' — fully booked'
                }`}
                className={
                  'flex flex-col items-center rounded-md border px-1 py-2 text-center transition-colors ' +
                  (on
                    ? 'border-transparent text-white'
                    : bookable
                      ? 'border-line-strong bg-surface text-ink hover:bg-raised'
                      : 'cursor-not-allowed border-line bg-raised text-ink-muted')
                }
                style={on ? { backgroundColor: accent } : undefined}
              >
                <span className="text-[10.5px] uppercase tracking-wide opacity-80">{weekdayLabel(weekdayOf(date), true)}</span>
                <span className="mt-0.5 text-[15px] font-semibold leading-none">{Number(date.slice(8, 10))}</span>
              </button>
            );
          })}
        </div>
        {days === null && <p className="mt-2 text-[12px] text-ink-muted">Reading availability…</p>}
      </div>

      {notice && (
        <p role="alert" className="rounded-md border border-[#f0c3bf] bg-[#fdf2f1] px-3 py-2 text-[12.5px] text-danger">
          {notice}
        </p>
      )}

      <div>
        {day === null ? (
          <p className="rounded-md border border-line bg-raised px-3 py-6 text-center text-[13px] text-ink-muted">
            {days === null
              ? 'Reading availability…'
              : 'Nothing is open in this stretch. Try the next fortnight.'}
          </p>
        ) : slots === null ? (
          <p className="rounded-md border border-line bg-raised px-3 py-6 text-center text-[13px] text-ink-muted">
            Reading the slots for this day…
          </p>
        ) : freeCount === 0 ? (
          <p className="rounded-md border border-line bg-raised px-3 py-6 text-center text-[13px] text-ink-muted">
            Every time on this day is taken or outside working hours. Try another date.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(slots ?? []).map((slot) => {
              const free = slot.state === 'free';
              const on = slot.startsAt === chosen;
              const reason = slotReason(slot.state);
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  aria-disabled={!free || undefined}
                  aria-pressed={on}
                  title={free ? clockInZone(slot.startsAt, zone) + ' - ' + clockInZone(slot.endsAt, zone) : (reason ?? undefined)}
                  onClick={() => selectSlot(slot)}
                  className={
                    'rounded-md border px-2 py-2 text-[12.5px] tabular-nums transition-colors ' +
                    (on
                      ? 'border-transparent text-white'
                      : free
                        ? 'border-line-strong bg-surface text-ink hover:bg-raised'
                        : 'cursor-not-allowed border-line bg-raised text-ink-muted line-through decoration-[#c9ced6]')
                  }
                  style={on ? { backgroundColor: accent } : undefined}
                >
                  {clockInZone(slot.startsAt, zone)}
                  {free && <span className="ml-1 text-[10.5px] opacity-70">{clockInZone(slot.endsAt, zone)}</span>}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-ink-muted">
          Times are shown in {zone.replace(/_/g, ' ')}.
          {slots !== null && freeCount > 0 && ` ${freeCount === 1 ? 'One time is open' : `${freeCount} times are open`} on this day.`}
        </p>
      </div>
    </div>
  );
}

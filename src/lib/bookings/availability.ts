'use server';

import { z } from 'zod';
import { dayGrid, findServiceById, slotsOfDay, staffOfService } from './public';
import type { DayCell, SlotCell } from './types';
import type { ActionState } from '@/lib/types';

/**
 * The two availability questions, answered the same way for a customer on a public
 * page and for the workspace booking on its behalf.
 *
 * Both are server actions that return data, so one `SlotPicker` component can be
 * handed either caller by passing the function reference. Both go through the same
 * guard: the service has to be active in an active workspace, and the staff member
 * has to be one of those the service actually offers. That is the reading a public
 * booking page already applies, so nothing is revealed here that a page would not
 * show — and it is why a hidden service cannot be booked manually either. The engine
 * refuses it in `slot_conflict()`; this refuses it before a grid is drawn.
 *
 * The answers come from `bookable_days()` and `available_slots()`, which are built on
 * `slot_conflict()`. No free time is ever computed in TypeScript, so the grid a
 * customer clicks is exactly the set `create_booking()` will accept.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The same shape a `timezone` column accepts, and the only thing Postgres will read. */
const ZONE = /^[A-Za-z_/]{1,64}$/;

const daysInput = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  from: z.string().regex(DATE, 'Choose a date to look from'),
});

const slotsInput = z.object({
  serviceId: z.string().uuid(),
  staffId: z.string().uuid(),
  day: z.string().regex(DATE, 'Choose a date'),
  // Only a move sends one: an existing row already carries the zone it will be
  // re-checked in, and a grid read in any other zone could offer a time the engine
  // then refuses. `available_slots` coalesces the same way `slot_conflict` does when
  // this is absent.
  tz: z.string().regex(ZONE, 'Choose a time zone from the list').optional(),
});

/** Not found and unavailable read the same way to a stranger; the reason matters to a member. */
async function guard(serviceId: string, staffId: string): Promise<ActionState> {
  const service = await findServiceById(serviceId).catch((error: unknown) => {
    console.error('[yourbiss] availability lookup failed', {
      service_id: serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!service) return { ok: false, error: 'That booking page is no longer open.' };

  const team = await staffOfService(serviceId);
  if (!team.some((member) => member.id === staffId)) {
    return { ok: false, error: 'That team member does not offer this service.' };
  }
  return { ok: true };
}

export async function loadDays(input: unknown): Promise<ActionState & { days?: DayCell[] }> {
  const parsed = daysInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose a service, a team member and a date' };
  const { serviceId, staffId, from } = parsed.data;

  const permitted = await guard(serviceId, staffId);
  if (!permitted.ok) return permitted;

  try {
    // 42 days, so a service with a 60-day horizon never shows an empty month; the
    // grid can be extended and `bookable_days()` clamps whatever is asked for.
    const days = await dayGrid(serviceId, staffId, from, WINDOW_DAYS);
    return { ok: true, days };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Availability could not be read.' };
  }
}

/** One month plus a week: enough that "next month" is never an empty answer. */
const WINDOW_DAYS = 42;

export async function loadSlots(input: unknown): Promise<ActionState & { slots?: SlotCell[] }> {
  const parsed = slotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose a service, a team member and a date' };
  const { serviceId, staffId, day, tz } = parsed.data;

  const permitted = await guard(serviceId, staffId);
  if (!permitted.ok) return permitted;

  try {
    // No zone is passed by the booking page: `available_slots`, `slot_conflict` and
    // `create_booking` each coalesce staff → service → workspace, so leaving it null is
    // what guarantees the grid a customer clicks and the row that gets inserted read the
    // same clock. A move passes the zone stored on its own row, which is the one
    // `reschedule_booking` will re-check in.
    const slots = await slotsOfDay(serviceId, staffId, day, tz);
    return { ok: true, slots };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Slots could not be read.' };
  }
}

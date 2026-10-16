import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findBookingByReference, slotsOfDay } from '@/lib/bookings/public';
import { drainBookingMailSoon } from '@/lib/bookings/outbox';
import { manageDraftSchema, refusalCopy, type BookingLookup } from '@/lib/bookings/types';
import { clientKey, consume, rateHeaders } from '@/lib/rate-limit';
import { dateInZone } from '@/lib/utils';

/**
 * Reads, cancels or moves a booking the customer holds a reference for.
 *
 * All three questions need both halves of the secret, so they share this one door: the
 * panel asks for the reference the mail carried, and for the address it was sent to.
 *
 * The reference alone is not a secret worth defending — `youbiss.new_booking_code()`
 * draws from a 31-character alphabet, but the page still asks for the email address
 * that made the booking, and so does `cancel_booking()` and `reschedule_booking()`.
 * Both halves have to match before either function touches the row, which is why a
 * wrong email reads as "no booking matches" rather than as a permission problem.
 *
 * A new time is checked against `available_slots()` before the RPC runs, for the same
 * reason the booking route does it: the engine would refuse the move anyway, but the
 * grid knows the reason in the customer's own terms and the function only knows the
 * code. The day is resolved in `bookings.timezone` — the zone the function falls back
 * to when `p_tz` is null — so the grid and the write read one clock.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const CLOSED_STATES = ['cancelled', 'completed', 'no_show'];

function bad(message: string, status = 400, fields?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message, fields: fields ?? {} }, { status });
}

function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get('host')?.toLowerCase();
  if (!host) return false;
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The columns `cancel_booking` and `reschedule_booking` return a row with. */
type BookingPatch = Partial<
  Pick<BookingLookup, 'starts_at' | 'ends_at' | 'timezone' | 'state' | 'cancelled_at' | 'cancel_reason'>
>;

/**
 * What a customer is told about a booking that is theirs: the reference, the time, who
 * they are seeing and where the page lives. No internal notes, no other booking of the
 * address's, no notification history — none of those leave the workspace.
 *
 * `patch` is the row the RPC just wrote. Reading the booking back after a successful
 * cancel would cost a second query for no fact the function did not already return.
 */
function summarise(booking: BookingLookup, patch?: BookingPatch) {
  return {
    code: booking.code,
    state: patch?.state ?? booking.state,
    starts_at: patch?.starts_at ?? booking.starts_at,
    ends_at: patch?.ends_at ?? booking.ends_at,
    timezone: patch?.timezone ?? booking.timezone,
    customer_name: booking.customer_name,
    service_name: booking.service_name,
    staff_name: booking.staff_name,
    org_name: booking.org_name,
    service_id: booking.service_id,
    staff_id: booking.staff_id,
    book_path: `/book/${booking.org_slug}/${booking.service_slug}`,
    horizon_days: booking.service_horizon_days,
    cancelled_at: patch?.cancelled_at ?? booking.cancelled_at,
    cancel_reason: patch?.cancel_reason ?? booking.cancel_reason,
  };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return bad('Bookings can only be managed from their own page.', 403);

  let payload: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return bad('That request is too large.', 413);
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('Send the request as a JSON object.');
    payload = parsed as Record<string, unknown>;
  } catch {
    return bad('The request could not be read.');
  }

  const intent = text(payload.intent);
  if (intent !== 'lookup' && intent !== 'cancel' && intent !== 'reschedule') {
    return bad('Nothing to do — look the booking up, cancel it, or move it.');
  }

  const parsed = manageDraftSchema.safeParse({ code: text(payload.code), email: text(payload.email) });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'code');
      if (!fields[key]) fields[key] = issue.message;
    }
    return bad('Check the reference and the email address.', 422, fields);
  }

  const { code, email } = parsed.data;

  /**
   * A lookup is throttled by the visitor, because walking the reference space is what
   * a lookup flood is for. A cancel or a move is throttled by the reference as well,
   * so one person hammering a single booking is the thing limited there — and a shared
   * NAT address is not punished for it.
   */
  const bucket = intent === 'lookup' ? `booklookup:${clientKey(request.headers)}` : `bookmanage:${code}:${clientKey(request.headers)}`;
  const limiter = await consume(bucket, intent === 'lookup' ? 12 : 6, 600);
  if (!limiter.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: rateHeaders(limiter) },
    );
  }

  let booking;
  try {
    booking = await findBookingByReference(code, email);
  } catch (error) {
    console.error('[yourbiss] manage lookup failed', {
      code,
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('That booking could not be read. Please try again.', 500);
  }
  if (!booking) return bad('No booking matches that reference and email address.', 404);

  if (intent === 'lookup') {
    return NextResponse.json({ ok: true, booking: summarise(booking) });
  }

  if (CLOSED_STATES.includes(booking.state)) {
    return bad('That booking is already cancelled, completed or marked as a no-show.', 409);
  }

  const supabase = createAdminClient();

  if (intent === 'cancel') {
    const reason = text(payload.reason).slice(0, 300);
    const { data, error } = await supabase.rpc('cancel_booking', {
      p_code: booking.code,
      p_email: booking.customer_email,
      p_reason: reason === '' ? null : reason,
    });
    if (error) return bad(refusalCopy(error.message), error.code === 'P0001' ? 409 : 500);

    const row = (data ?? null) as BookingPatch | null;
    if (!row) return bad('That booking could not be cancelled. Please try again.', 500);
    await drainBookingMailSoon();
    return NextResponse.json({
      ok: true,
      state: row.state ?? 'cancelled',
      booking: summarise(booking, row),
      message: 'Your booking is cancelled. A confirmation is on its way.',
    });
  }

  const startsAt = text(payload.starts_at);
  const wanted = new Date(startsAt);
  if (startsAt === '' || Number.isNaN(wanted.getTime())) {
    return bad('Pick a time from the list.', 422, { starts_at: 'Choose a new time.' });
  }

  let offered;
  try {
    // Read in the zone stored on the row: `reschedule_booking` falls back to
    // `bookings.timezone`, so a grid drawn in the staff member's *current* zone could
    // offer a time the write then refuses as outside hours.
    offered = await slotsOfDay(booking.service_id, booking.staff_id, dateInZone(wanted, booking.timezone), booking.timezone);
  } catch (error) {
    console.error('[yourbiss] manage could not read the slots', {
      code,
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('That booking could not be moved. Please try again.', 500);
  }

  const milliseconds = wanted.getTime();
  const matching = offered.filter((slot) => new Date(slot.startsAt).getTime() === milliseconds);
  const chosen = matching.find((slot) => slot.state === 'free');
  if (!chosen) {
    const reason = matching[0]?.state;
    return bad(
      reason && reason !== 'free' ? refusalCopy(`cannot move to that time: ${reason}`) : 'That time has just gone. Pick another slot.',
      409,
    );
  }

  const { data, error } = await supabase.rpc('reschedule_booking', {
    p_code: booking.code,
    p_email: booking.customer_email,
    p_starts_at: chosen.startsAt,
    // Null on purpose: the function coalesces to the zone already stored on the row,
    // which is the zone the grid above was read in.
    p_tz: null,
  });
  if (error) return bad(refusalCopy(error.message), error.code === 'P0001' ? 409 : 500);

  const row = (data ?? null) as BookingPatch | null;
  if (!row) return bad('That booking could not be moved. Please try again.', 500);

  await drainBookingMailSoon();
  return NextResponse.json({
    ok: true,
    state: row.state ?? booking.state,
    booking: summarise(booking, row),
    message: 'Your new time is saved. A confirmation is on its way.',
  });
}

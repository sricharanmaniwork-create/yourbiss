import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findServiceById, staffOfService, slotsOfDay } from '@/lib/bookings/public';
import { drainBookingMailSoon } from '@/lib/bookings/outbox';
import { bookDraftSchema, refusalCopy } from '@/lib/bookings/types';
import { clientKey, consume, rateHeaders } from '@/lib/rate-limit';
import { dateInZone } from '@/lib/utils';

/**
 * Where a booking is made: the shared page, the embed frame on a published site, and
 * the "manage your booking" flow all post here.
 *
 * The database owns the decision, and this route owns everything the database cannot
 * see. Nothing is trusted from the request: the service is re-read by id and must come
 * back active in an active workspace, the staff member must be one the service offers,
 * and the instant must be one `available_slots()` is offering right now for the zone
 * the engine will resolve it in. Only then does `create_booking()` run, which locks
 * staff-plus-day and re-runs `slot_conflict()` inside that lock — so the checks here
 * stop an invented time and a scripted flood, and the ones in the function stop two
 * customers taking the same slot.
 *
 * `bookings` has no INSERT policy for any client role, which is what makes this route
 * the only door. The service-role client is used for the RPC alone, and the row it
 * writes is constrained by the function's own validation, not by a policy this file
 * would have to remember.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

function bad(message: string, status = 400, fields?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message, fields: fields ?? {} }, { status });
}

/**
 * Same-origin only, exactly as the form submit is. The embed frame is same-origin by
 * construction, so an Origin that is present but foreign is a forged post and one that
 * is absent on a booking is a script rather than a browser.
 */
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

/** 'embed' when the frame on someone's published site made the booking, else 'web'. */
function sourceOf(request: NextRequest): 'web' | 'embed' {
  const source = request.headers.get('referer') ?? request.headers.get('origin');
  if (!source) return 'web';
  try {
    return new URL(source).pathname.startsWith('/embed/') ? 'embed' : 'web';
  } catch {
    return 'web';
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return bad('This booking can only be made from its own page.', 403);

  let payload: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return bad('That request is too large.', 413);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('Send the booking as a JSON object.');
    payload = parsed as Record<string, unknown>;
  } catch {
    return bad('The request could not be read.');
  }

  const serviceId = typeof payload.service === 'string' ? payload.service : '';
  const limiter = await consume(`book:${serviceId}:${clientKey(request.headers)}`, 8, 300);
  if (!limiter.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many booking attempts at once. Please wait a minute and try again.' },
      { status: 429, headers: rateHeaders(limiter) },
    );
  }

  // A filled-in field no human can see. The bot is thanked so it does not learn it
  // was caught and start again with a different payload.
  const honeypot = typeof payload.company === 'string' ? payload.company.trim() : '';
  if (honeypot !== '') {
    return NextResponse.json({ ok: true, code: null, message: 'Thanks — your request is in.' }, { status: 201 });
  }

  let service;
  try {
    service = await findServiceById(serviceId);
  } catch (error) {
    console.error('[yourbiss] booking could not read the service', {
      service_id: serviceId.slice(0, 16),
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('That booking could not be recorded. Please try again.', 500);
  }
  if (!service) return bad('This booking page is no longer open.', 404);

  const staffId = typeof payload.staff === 'string' ? payload.staff : '';
  const startsAt = typeof payload.starts_at === 'string' ? payload.starts_at : '';

  const parsed = bookDraftSchema.safeParse({
    service_id: serviceId,
    staff_id: staffId,
    starts_at: startsAt,
    customer_name: typeof payload.name === 'string' ? payload.name : '',
    customer_email: typeof payload.email === 'string' ? payload.email : '',
    customer_phone: typeof payload.phone === 'string' ? payload.phone : '',
    notes: typeof payload.notes === 'string' ? payload.notes : '',
  });
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'booking');
      if (!fields[key]) fields[key] = issue.message;
    }
    return bad('Some details need another look.', 422, fields);
  }

  const answers = parsed.data;
  if (service.requirePhone && answers.customer_phone === '') {
    return bad('This service needs a phone number.', 422, { customer_phone: 'Add a phone number so they can reach you.' });
  }

  const wanted = new Date(answers.starts_at);
  if (Number.isNaN(wanted.getTime())) return bad('That time could not be read. Pick the slot again.', 422, { starts_at: 'Pick a time from the list.' });

  // The staff member has to be one this service offers, by the service's own list.
  let team;
  try {
    team = await staffOfService(service.id);
  } catch (error) {
    console.error('[yourbiss] booking could not read the team', {
      service_id: service.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('That booking could not be recorded. Please try again.', 500);
  }
  const staff = team.find((member) => member.id === staffId);
  if (!staff) return bad('That team member is not available for this service.', 422, { staff: 'Choose another team member.' });

  /**
   * The instant must be on the grid. Which day it falls on is resolved in the zone the
   * engine will resolve it in — staff first, then service — because asking for
   * "Tuesday's slots" in the wrong zone would refuse a legitimate late-night booking
   * and accept an invented one.
   *
   * The match is on the instant, not the text: Postgres answers `…+00:00` where a
   * browser sends `…Z` for the same moment, and comparing those strings would refuse
   * every real booking.
   */
  const zone = staff.timezone || service.timezone;
  let offered;
  try {
    offered = await slotsOfDay(service.id, staff.id, dateInZone(wanted, zone));
  } catch (error) {
    console.error('[yourbiss] booking could not read the slots', {
      service_id: service.id,
      staff_id: staff.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('That booking could not be recorded. Please try again.', 500);
  }

  const milliseconds = wanted.getTime();
  const matching = offered.filter((slot) => new Date(slot.startsAt).getTime() === milliseconds);
  const chosen = matching.find((slot) => slot.state === 'free');
  if (!chosen) {
    const reason = matching[0]?.state;
    return bad(
      reason && reason !== 'free' ? refusalCopy(`cannot book: ${reason}`) : 'That time has just gone. Pick another slot.',
      409,
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('create_booking', {
    p_service_id: service.id,
    p_staff_id: staff.id,
    p_starts_at: chosen.startsAt,
    p_customer_name: answers.customer_name,
    p_customer_email: answers.customer_email,
    p_customer_phone: answers.customer_phone || null,
    p_notes: answers.notes || null,
    p_source: sourceOf(request),
    // The function coalesces staff → service → workspace, so omitting the zone keeps
    // the stored row and the grid on one clock.
    p_tz: null,
  });

  if (error) return bad(refusalCopy(error.message), error.code === 'P0001' ? 409 : 500);

  const booking = (data ?? null) as
    | { id: string; code: string; starts_at: string; ends_at: string; timezone: string; state: string }
    | null;
  if (!booking) return bad('That booking could not be recorded. Please try again.', 500);

  // `create_booking` queued the confirmation and the team's alert but sent neither, and a
  // Hobby schedule can only run once a day. Drain them after the response so the reference
  // reaches the customer within minutes without making the booking wait on an SMTP host.
  await drainBookingMailSoon();

  return NextResponse.json(
    {
      ok: true,
      code: booking.code,
      booking: {
        starts_at: booking.starts_at,
        ends_at: booking.ends_at,
        timezone: booking.timezone,
        state: booking.state,
      },
      manage_path: `/book/manage?code=${encodeURIComponent(booking.code)}`,
      intake: service.intakeForm
        ? { title: service.intakeForm.title, path: `/f/${service.orgSlug}/${service.intakeForm.slug}` }
        : null,
    },
    { status: 201, headers: rateHeaders(limiter) },
  );
}

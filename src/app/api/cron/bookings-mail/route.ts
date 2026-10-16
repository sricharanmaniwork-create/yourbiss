import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { optionalEnv } from '@/lib/env';
import { flushBookingMail } from '@/lib/bookings/outbox';

/**
 * The HTTP door onto the booking mail queue.
 *
 * The work itself lives in `@/lib/bookings/outbox`, because the queue must also be drainable
 * from inside a request — a confirmation letter should not sit there until the next cron tick.
 * This file only decides who may open that door.
 *
 * `flushBookingMail` runs as `service_role` and reads across every workspace, so the caller
 * cannot be a browser: the bearer secret is required before anything is read. It is compared
 * by length-then-bytes so a failed attempt leaks neither the secret's content nor its length
 * through a throw.
 */

export const dynamic = 'force-dynamic';

function authorised(request: NextRequest, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7).trim(), 'utf8');
  const wanted = Buffer.from(secret, 'utf8');
  // Equal length first: timingSafeEqual throws on a length mismatch, and the throw itself
  // would tell an attacker how long the secret is.
  if (given.length !== wanted.length) return false;
  return timingSafeEqual(given, wanted);
}

export async function GET(request: NextRequest) {
  const secret = optionalEnv('CRON_SECRET');
  if (!secret) {
    // Refusing is the only honest answer: an unguarded queue endpoint would let anybody
    // trigger mail sends for any workspace on the platform.
    console.error('[yourbiss] booking mail run refused: CRON_SECRET is not set');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment, so the mail queue stays closed.' },
      { status: 503 },
    );
  }
  if (!authorised(request, secret)) {
    return NextResponse.json({ ok: false, error: 'Not authorised.' }, { status: 401 });
  }

  try {
    const outcome = await flushBookingMail();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    // The module already logged the database error behind this; the body stays generic so a
    // cron caller reading logs never sees a schema detail it cannot act on.
    const message = error instanceof Error ? error.message : 'The mail queue could not be flushed.';
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 500 });
  }
}

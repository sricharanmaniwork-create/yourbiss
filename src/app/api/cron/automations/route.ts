import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { optionalEnv } from '@/lib/env';
import { runAllAutomations } from '@/lib/automations/engine';

/**
 * The HTTP door onto the automation runner.
 *
 * Nothing in the product fires a rule by itself on purpose: an event lands in
 * `activity_log` inside whatever transaction the other app was already in, and asking
 * that request to also send a letter would make a customer&rsquo;s checkout wait on a mail
 * host. So the timeline records, and this door sweeps it.
 *
 * The sweep runs as `service_role` across every workspace that switched Automations on,
 * which is exactly why the caller cannot be a browser: without the bearer secret anybody
 * could make the platform send mail on somebody else&rsquo;s rules. It is compared by length
 * then by bytes, so a wrong guess leaks neither the secret nor its length through a throw.
 *
 * Starting twice in a minute is harmless. `automation_runs` is unique on the rule and the
 * event together, so the second runner loses the race on rows that were already decided
 * rather than sending the same customer the same letter again.
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
    // Refusing is the only honest answer: an unguarded runner would let anybody trigger
    // every workspace's letters and CRM entries at will.
    console.error('[yourbiss] automation run refused: CRON_SECRET is not set');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment, so the runner stays closed.' },
      { status: 503 },
    );
  }
  if (!authorised(request, secret)) {
    return NextResponse.json({ ok: false, error: 'Not authorised.' }, { status: 401 });
  }

  try {
    const outcome = await runAllAutomations();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    // One workspace's broken rule is logged and skipped inside the runner; reaching here
    // means the sweep itself could not read, and the body stays generic about it.
    const message = error instanceof Error ? error.message : 'The automations could not be run.';
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 500 });
  }
}

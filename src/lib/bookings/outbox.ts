import 'server-only';

import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requestOrigin } from '@/lib/app-url';
import { sendMail } from '@/lib/mail';
import {
  bookingCancelled,
  bookingConfirmation,
  bookingReminder,
  bookingRescheduled,
  mailBase,
  teamNewBooking,
  type RenderedMail,
} from '@/lib/mail/templates';
import { formatInZone, formatMoney } from '@/lib/utils';

/**
 * Turning the booking queue into letters.
 *
 * `create_booking`, `cancel_booking` and `reschedule_booking` only ever *queue* a message
 * into `booking_notifications`, and a member cancelling an appointment queues one through
 * the service-role client — so nothing in a customer's request path touches SMTP. That is
 * what keeps a slow mail host from failing a booking. This module is the other half: the
 * only place that reads the queue, renders it and hands it to `sendMail`.
 *
 * It runs as `service_role` and says why: `authenticated` holds SELECT and UPDATE on the
 * queue and no INSERT, so the worker is the one role that may both claim a row and read the
 * booking behind it. Every filter is therefore written here rather than trusted to RLS, and
 * only two callers exist: the cron route, which demands the bearer secret before it calls in,
 * and `drainBookingMailSoon()` below, which a request handler may only reach after it has
 * just queued a letter of its own.
 *
 * Two safety properties come from the columns themselves. `attempts between 0 and 20` means
 * a permanently broken host cannot make this loop forever, and
 * `unique (booking_id, kind, recipient)` means one letter per kind per address, which is
 * what makes a claim safe to retry.
 */

/** One call sends a batch, so a flood of bookings cannot blow the caller's clock. */
const BATCH = 20;
const MAX_ATTEMPTS = 20;
/** How far ahead a reminder is worth sending: the day before, and nothing older. */
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const LOCATION_LABEL: Record<string, string> = { onsite: 'In person', online: 'Online', phone: 'By phone' };

export interface FlushOutcome {
  sent: number;
  failed: number;
  skipped: number;
  reminders: number;
  queued: number;
}

interface QueueRow {
  id: string;
  org_id: string;
  booking_id: string;
  kind: string;
  recipient: string;
  attempts: number;
}

interface BookingRow {
  id: string;
  code: string;
  state: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  notes: string | null;
  service_id: string;
  staff_id: string;
  org_id: string;
}

interface ServiceRow {
  id: string;
  name: string;
  slug: string;
  duration_min: number;
  price_cents: number;
  currency: string;
  location_kind: string;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
}

/** Everything one letter needs about its booking, assembled once per batch. */
interface Entry {
  booking: BookingRow;
  service: ServiceRow | null;
  staffName: string;
  org: OrgRow | null;
}

/** Our wording, and the facts a workspace's own wording may name with `{{tokens}}`. */
interface Letter {
  mail: RenderedMail;
  tokens: Record<string, string>;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Send the letters the queue is holding.
 *
 * `originHint` exists for the caller that runs after its own response: by then `headers()`
 * has no request left to read, so the origin has to be captured while one still exists.
 */
export async function flushBookingMail(originHint?: string): Promise<FlushOutcome> {
  const supabase = createAdminClient();
  const outcome: FlushOutcome = { sent: 0, failed: 0, skipped: 0, reminders: 0, queued: 0 };

  const { data, error } = await supabase
    .from('booking_notifications')
    .select('id, org_id, booking_id, kind, recipient, attempts')
    .is('delivered_at', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error('[yourbiss] booking queue could not be read', error.message);
    throw new Error('The mail queue could not be read.');
  }

  const rows = (data ?? []) as QueueRow[];
  outcome.queued = rows.length;

  if (rows.length > 0) {
    const origin = originHint ?? (await requestOrigin());
    const context = await loadContext(supabase, rows);
    if (!context) throw new Error('A booking behind the queue could not be read.');

    for (const row of rows) {
      // Claim it before sending: the row is only ours if `attempts` still holds the value
      // this run read. A second worker — or the same cron restarted mid-batch — loses the
      // race and moves on, so no letter goes out twice because two runs met at one row.
      const { data: claimed } = await supabase
        .from('booking_notifications')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id)
        .eq('attempts', row.attempts)
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      const entry = context.get(row.booking_id);
      if (!entry) {
        // The booking is gone — its workspace was deleted — so the letter has no subject.
        // Marking it delivered keeps it out of the loop instead of retrying it forever.
        await supabase
          .from('booking_notifications')
          .update({ delivered_at: new Date().toISOString(), error: 'The booking behind this letter no longer exists' })
          .eq('id', row.id);
        outcome.skipped += 1;
        continue;
      }

      const letter = render(row, entry, origin);
      if (!letter) {
        await supabase.from('booking_notifications').update({ error: `Nothing to send for kind “${row.kind}”` }).eq('id', row.id);
        outcome.skipped += 1;
        continue;
      }

      const delivered = await sendMail({
        orgId: row.org_id,
        to: row.recipient,
        mail: letter.mail,
        tokens: letter.tokens,
        template: templateKey(row.kind),
        relatedType: 'booking',
        relatedId: row.booking_id,
      });

      if (delivered.delivered) {
        await supabase
          .from('booking_notifications')
          .update({ delivered_at: new Date().toISOString(), error: null })
          .eq('id', row.id);
        outcome.sent += 1;
      } else {
        // Left undelivered on purpose: `attempts` is already one higher, so the next call
        // tries again, and the column's check stops trying at twenty.
        await supabase
          .from('booking_notifications')
          .update({ error: (delivered.error ?? 'The provider refused the message').slice(0, 500) })
          .eq('id', row.id);
        outcome.failed += 1;
      }
    }
  }

  outcome.reminders = await queueReminders(supabase);
  return outcome;
}

/**
 * Flush the queue once this response is out.
 *
 * `create_booking` only queues a letter, and a Vercel Hobby schedule can run at most once a
 * day, so without this a customer who books at 9am would get the confirmation tomorrow. The
 * send belongs after the response, not inside it: a booking must not fail because an SMTP host
 * timed out, and the row is already committed and claimable, so the customer's own page can
 * open as soon as the reference exists.
 *
 * A serverless function can be frozen the moment it answers, which is exactly what `after()`
 * exists to prevent; if the platform cuts the extension short, nothing is lost — the row is
 * still undelivered with its `attempts` bumped, and the cron retries it.
 */
export async function drainBookingMailSoon(): Promise<void> {
  const origin = await requestOrigin();
  after(async () => {
    try {
      await flushBookingMail(origin);
    } catch (error) {
      console.error('[yourbiss] inline mail flush failed', error instanceof Error ? error.message : String(error));
    }
  });
}

/** Booking, service, staff and workspace rows for every letter in the batch, in four reads. */
async function loadContext(supabase: Admin, rows: QueueRow[]): Promise<Map<string, Entry> | null> {
  const bookingIds = [...new Set(rows.map((row) => row.booking_id))];
  const { data, error } = await supabase.from('bookings').select('*').in('id', bookingIds);
  if (error) {
    console.error('[yourbiss] booking queue rows could not be read', error.message);
    return null;
  }

  const found = (data ?? []) as BookingRow[];
  const serviceIds = [...new Set(found.map((booking) => booking.service_id))];
  const staffIds = [...new Set(found.map((booking) => booking.staff_id))];
  const orgIds = [...new Set(found.map((booking) => booking.org_id))];

  const [services, team, orgs] = await Promise.all([
    serviceIds.length
      ? read<ServiceRow>(supabase.from('booking_services').select('id, name, slug, duration_min, price_cents, currency, location_kind').in('id', serviceIds))
      : Promise.resolve([] as ServiceRow[]),
    staffIds.length
      ? read<{ id: string; name: string }>(supabase.from('booking_staff').select('id, name').in('id', staffIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    orgIds.length
      ? read<OrgRow>(supabase.from('orgs').select('id, name, slug').in('id', orgIds))
      : Promise.resolve([] as OrgRow[]),
  ]);

  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const staffMap = new Map(team.map((member) => [member.id, member.name]));
  const orgMap = new Map(orgs.map((org) => [org.id, org]));

  const context = new Map<string, Entry>();
  for (const booking of found) {
    context.set(booking.id, {
      booking,
      service: serviceMap.get(booking.service_id) ?? null,
      staffName: staffMap.get(booking.staff_id) ?? 'your colleague',
      org: orgMap.get(booking.org_id) ?? null,
    });
  }
  return context;
}

/** The builder is untyped until `gen types` runs against a live project, so rows are laundered here. */
async function read<T>(result: PromiseLike<{ data: unknown }>): Promise<T[]> {
  const { data } = await result;
  return (data ?? []) as T[];
}

function templateKey(kind: string): string {
  if (kind === 'team_alert') return 'team_new_booking';
  if (kind === 'rescheduled') return 'booking_rescheduled';
  if (kind === 'cancelled') return 'booking_cancelled';
  if (kind === 'reminder') return 'booking_reminder';
  return 'booking_confirmation';
}

/**
 * The letter for one queue row, or null when the row cannot produce one.
 *
 * Every template opens with the workspace's own name, and a letter addressed to " " would
 * be worse than no letter at all, so a row whose workspace row is gone renders nothing. The
 * caller records that on the row instead of throwing, because one broken booking must not
 * stop the other nineteen in the batch.
 *
 * `tokens` travels with it so a workspace that rewrote this letter on Settings → Email has
 * the same facts to name. Every booking letter carries the same set: an unused token costs
 * nothing, and a token the author can see listed but that comes back empty is a lie.
 */
function render(row: QueueRow, entry: Entry, origin: string): Letter | null {
  const { booking, service, staffName, org } = entry;
  if (!org) return null;

  const base = mailBase(org.name);
  const when = formatInZone(booking.starts_at, booking.timezone);
  const zone = booking.timezone.replace(/_/g, ' ');
  const manageUrl = `${origin}/book/manage?code=${encodeURIComponent(booking.code)}`;
  const serviceName = service?.name ?? 'your appointment';
  const price = service && service.price_cents > 0 ? formatMoney(service.price_cents, service.currency) : '';
  const location = (service ? LOCATION_LABEL[service.location_kind] : '') ?? '';
  // The team's letter opens the appointment inside the app; the customer's opens the manage page.
  const teamUrl = `${origin}/app/bookings/appointments?q=${encodeURIComponent(booking.code)}`;
  const rebookUrl = service ? `${origin}/book/${org.slug}/${service.slug}` : manageUrl;

  const tokens: Record<string, string> = {
    customer_name: booking.customer_name,
    customer_email: booking.customer_email,
    customer_phone: booking.customer_phone ?? '',
    service_name: serviceName,
    staff_name: staffName,
    when,
    timezone: zone,
    duration: `${service?.duration_min ?? 60} minutes`,
    price,
    location,
    notes: booking.notes ?? '',
    code: booking.code,
    org_name: org.name,
    manage_url: manageUrl,
    rebook_url: rebookUrl,
  };

  if (row.kind === 'confirmation') {
    return {
      mail: bookingConfirmation(base, {
        customerName: booking.customer_name,
        serviceName,
        staffName,
        when,
        timeZone: zone,
        durationMin: service?.duration_min ?? 60,
        code: booking.code,
        manageUrl,
        price: price === '' ? undefined : price,
        location: location === '' ? undefined : location,
      }),
      tokens,
    };
  }

  if (row.kind === 'reminder') {
    return {
      mail: bookingReminder(base, {
        customerName: booking.customer_name,
        serviceName,
        staffName,
        when,
        timeZone: zone,
        code: booking.code,
        manageUrl,
      }),
      tokens,
    };
  }

  if (row.kind === 'cancelled') {
    return {
      mail: bookingCancelled(base, {
        customerName: booking.customer_name,
        serviceName,
        when,
        code: booking.code,
        rebookUrl,
        // A customer who cancelled themselves is told "we received your cancellation"; a
        // cancellation the team recorded is the business saying it had to call the visit off.
        // The row's own state is what separates them, because only the customer's path can
        // leave a booking cancelled by someone who booked it.
        byCustomer: booking.state === 'cancelled',
      }),
      tokens,
    };
  }

  if (row.kind === 'rescheduled') {
    return {
      mail: bookingRescheduled(base, {
        customerName: booking.customer_name,
        serviceName,
        staffName,
        // No `oldWhen`, deliberately: `reschedule_booking` writes the new time over the old
        // one and keeps no history row, so the queue cannot know what was replaced. A letter
        // that guessed at the previous time would be worse than one that says nothing.
        when,
        timeZone: zone,
        code: booking.code,
        manageUrl,
      }),
      tokens,
    };
  }

  if (row.kind === 'team_alert') {
    return {
      mail: teamNewBooking(base, {
        staffName,
        serviceName,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
        when,
        timeZone: zone,
        notes: booking.notes,
        code: booking.code,
        manageUrl: teamUrl,
      }),
      tokens: { ...tokens, manage_url: teamUrl },
    };
  }

  return null;
}

/**
 * Queue the reminder for appointments that start inside the next day.
 *
 * `reminded_at` is stamped on the booking, not on the letter, so an appointment is only ever
 * reminded once however many calls the queue takes — and a move that puts it back inside the
 * window does not send a second letter, because `unique (booking_id, kind, recipient)` would
 * refuse one anyway.
 */
async function queueReminders(supabase: Admin): Promise<number> {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .select('id, org_id, customer_email')
    .is('reminded_at', null)
    .in('state', ['pending', 'confirmed'])
    .gte('starts_at', now.toISOString())
    .lte('starts_at', until)
    .limit(BATCH);
  if (error || !data || data.length === 0) return 0;

  const pending = data as { id: string; org_id: string; customer_email: string }[];
  // Upsert rather than insert: the unique key is (booking_id, kind, recipient), so a row
  // that is already in the queue — delivered or still waiting — is skipped instead of
  // throwing the whole batch's insert away.
  const { error: queued } = await supabase
    .from('booking_notifications')
    .upsert(
      pending.map((booking) => ({
        org_id: booking.org_id,
        booking_id: booking.id,
        kind: 'reminder',
        recipient: booking.customer_email,
      })),
      { onConflict: 'booking_id,kind,recipient', ignoreDuplicates: true },
    );
  if (queued) console.error('[yourbiss] reminders could not be queued', queued.message);

  // Stamped whether or not the insert took: the alternative is to re-scan the same
  // appointments on every call for the rest of their life.
  const { error: marked } = await supabase
    .from('bookings')
    .update({ reminded_at: now.toISOString() })
    .in('id', pending.map((booking) => booking.id));
  if (marked) console.error('[yourbiss] reminder stamps could not be written', marked.message);

  return pending.length;
}

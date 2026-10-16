import { z } from 'zod';
import { isValidSlug } from '@/lib/utils';

/**
 * The Bookings document model.
 *
 * Two rules shape everything here. First, the database owns the arithmetic: a
 * slot is offered only if `youbiss.slot_conflict()` returns NULL, so this module
 * never recomputes free time, it only asks the same question in the same words.
 * Second, every range below is the same range the column `check` in 0005 enforces
 * — a UI that lets you type 999 into a duration and then fails at the database
 * produces an error nobody can act on, while a UI that refuses the number does.
 */

export const WEEKDAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
] as const;

/** Calendars read Monday-first; the column itself is 0 = Sunday, as in 0005. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayLabel(value: number, short = false): string {
  const day = WEEKDAYS.find((w) => w.value === value);
  if (!day) return `Day ${value}`;
  return short ? day.short : day.label;
}

export const LOCATION_KINDS = [
  { value: 'onsite', label: 'In person', hint: 'At the workspace address' },
  { value: 'online', label: 'Online', hint: 'A call or a link' },
  { value: 'phone', label: 'Phone', hint: 'A call to the customer' },
] as const;

/** Currency codes come from `@/lib/timezones`, which the server renders into a select. */

/**
 * Every reason `slot_conflict()` can answer with, in the customer's words.
 * The set is fixed by the database, so an unknown code must not silently become
 * "try another time" — it falls through to `slotReason` below and says so.
 */
export const SLOT_REASONS: Record<string, string> = {
  service_not_found: 'That service no longer exists.',
  service_inactive: 'That service is not open for bookings right now.',
  staff_not_found: 'That team member no longer exists.',
  staff_inactive: 'That team member is not taking bookings right now.',
  cross_org: 'That service and team member belong to different workspaces.',
  staff_does_not_offer_service: 'That team member does not offer this service.',
  invalid_slot: 'That time does not work. Pick another.',
  too_soon: 'That time is too soon to book. Pick a later slot.',
  beyond_horizon: 'That date is further ahead than this service allows.',
  outside_hours: 'That is outside the working hours for the day.',
  on_break: 'That time falls in a break. Pick another.',
  staff_busy: 'That team member is already booked then.',
  capacity_full: 'All places for that time are taken.',
  service_full: 'This service is fully booked at that time.',
  day_full: 'That day is fully booked for this team member.',
};

export function slotReason(code: string | null | undefined): string | null {
  if (!code || code === 'free') return null;
  return SLOT_REASONS[code] ?? 'That time is not available.';
}

/** `time` in Postgres accepts HH:MM and HH:MM:SS; this narrows it to the longer. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toPostgresTime(value: string): string {
  const trimmed = value.trim();
  if (!TIME_RE.test(trimmed)) throw new Error(`Not a 24-hour time: ${value}`);
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

/** The `HH:MM` an `<input type="time">` shows, whatever the row holds. */
export function toInputTime(value: string | null | undefined): string {
  if (!value) return '';
  const parts = value.split(':');
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : value;
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

// --- drafts -----------------------------------------------------------------
// What the admin screens send. The names say "draft" because these are the shapes
// a half-finished record can legitimately take: a service with no staff assigned
// is still a service, and saving it must be possible.

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least two characters')
  .max(60)
  .refine((v) => /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(v), 'Use lowercase letters, numbers and single dashes')
  // A service slug is a path segment under the workspace, so the platform's own
  // addresses have to stay free — the same list the database checks.
  .refine((v) => isValidSlug(v), 'That address is reserved for the platform');

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #2E6BE6');

const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Choose a time zone')
  .max(64)
  .regex(/^[A-Za-z_/]{1,64}$/, 'Choose a time zone from the list');

const statusSchema = z.enum(['active', 'hidden', 'archived']);

export const serviceDraftSchema = z.object({
  name: z.string().trim().min(1, 'Give the service a name').max(120),
  slug: slugSchema,
  description: z.string().trim().max(2000).default(''),
  duration_min: z.number().int().min(5, 'At least 5 minutes').max(1440, 'A service cannot exceed a day'),
  buffer_before_min: z.number().int().min(0).max(240).default(0),
  buffer_after_min: z.number().int().min(0).max(240).default(0),
  slot_step_min: z.number().int().min(5).max(120).default(15),
  min_lead_min: z.number().int().min(0).max(43200).default(60),
  max_horizon_days: z.number().int().min(1).max(730).default(60),
  daily_limit: z.number().int().min(1).max(64).nullable().default(null),
  capacity: z.number().int().min(1).max(32).default(1),
  price_cents: z.number().int().min(0).max(100000000).default(0),
  currency: z.string().trim().toUpperCase().length(3).regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
  location_kind: z.enum(['onsite', 'online', 'phone']).default('onsite'),
  timezone: timezoneSchema,
  color: colorSchema,
  intake_form_id: z.string().uuid().nullable().default(null),
  status: statusSchema.default('active'),
  sort_order: z.number().int().min(0).max(9999).default(0),
  page_config: z
    .object({
      heading: z.string().trim().max(120).default(''),
      instructions: z.string().trim().max(1000).default(''),
      require_phone: z.boolean().default(false),
    })
    .default({ heading: '', instructions: '', require_phone: false }),
}).refine(
  // The same inequality the column carries, so a bad combination is a field error
  // rather than a database message about a constraint name.
  (value) => value.duration_min + value.buffer_before_min + value.buffer_after_min <= 1440,
  { message: 'Length and buffers together must fit inside one day', path: ['duration_min'] },
);

export const staffDraftSchema = z.object({
  name: z.string().trim().min(1, 'Give the team member a name').max(80),
  slug: slugSchema,
  bio: z.string().trim().max(1000).default(''),
  avatar_url: z
    .string()
    .trim()
    .max(500)
    .default('')
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Use a full https:// image address'),
  timezone: timezoneSchema,
  status: statusSchema.default('active'),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export const staffContactDraftSchema = z.object({
  email: z
    .string()
    .trim()
    .max(320)
    .default('')
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'Enter a real email address'),
  phone: z
    .string()
    .trim()
    .max(32)
    .default('')
    .refine((v) => v === '' || /^[+0-9 ()-]{7,32}$/.test(v), 'Use digits, spaces and an optional leading +'),
  notes: z.string().trim().max(1000).default(''),
});

/** One weekly window with the breaks cut inside it. */
export const weekWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  starts_at: z.string().trim().regex(TIME_RE, 'Use a 24-hour time like 09:30'),
  ends_at: z.string().trim().regex(TIME_RE, 'Use a 24-hour time like 17:30'),
  breaks: z
    .array(
      z.object({
        starts_at: z.string().trim().regex(TIME_RE, 'Use a 24-hour time like 13:00'),
        ends_at: z.string().trim().regex(TIME_RE, 'Use a 24-hour time like 14:00'),
      }),
    )
    .max(12)
    .default([]),
}).superRefine((window, ctx) => {
  if (window.starts_at >= window.ends_at) {
    ctx.addIssue({ code: 'custom', message: 'A window must open before it closes', path: ['ends_at'] });
  }
  for (const brake of window.breaks) {
    if (brake.starts_at >= brake.ends_at) {
      ctx.addIssue({ code: 'custom', message: 'A break must start before it ends', path: ['breaks'] });
    } else if (brake.starts_at < window.starts_at || brake.ends_at > window.ends_at) {
      ctx.addIssue({ code: 'custom', message: 'A break must sit inside its window', path: ['breaks'] });
    }
  }
});

/**
 * A whole week replaces a whole week. Doing it per row instead would leave the
 * exclusion constraint in 0005 free to reject a reorder that is legal once both
 * rows exist — and a half-saved week is worse than a refused one.
 */
export const weekSchema = z.object({ windows: z.array(weekWindowSchema).max(7 * 4) });

export const exceptionDraftSchema = z
  .object({
    day: z.string().trim().regex(DATE_RE, 'Choose a date'),
    kind: z.enum(['closed', 'extra']),
    starts_at: z.string().trim().regex(TIME_RE).optional().or(z.literal('')),
    ends_at: z.string().trim().regex(TIME_RE).optional().or(z.literal('')),
    reason: z.string().trim().max(200).default(''),
  })
  .superRefine((value, ctx) => {
    // Mirrors the column check: 'closed' needs no times, 'extra' needs both.
    if (value.kind === 'extra') {
      if (!value.starts_at || !value.ends_at) {
        ctx.addIssue({ code: 'custom', message: 'An extra window needs a start and an end', path: ['starts_at'] });
      } else if (value.starts_at >= value.ends_at) {
        ctx.addIssue({ code: 'custom', message: 'An extra window must start before it ends', path: ['ends_at'] });
      }
    }
  });

export const closedDayDraftSchema = z.object({
  day: z.string().trim().regex(DATE_RE, 'Choose a date'),
  reason: z.string().trim().max(200).default(''),
});

/** The customer-facing form, kept deliberately small. */
export const bookDraftSchema = z.object({
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true, message: 'Send the start time with its time zone' }),
  customer_name: z.string().trim().min(1, 'Your name is needed').max(120),
  customer_email: z.string().trim().min(1, 'An email address is needed').max(320).email('Enter a real email address'),
  customer_phone: z
    .string()
    .trim()
    .max(32)
    .default('')
    .refine((v) => v === '' || /^[+0-9 ()-]{7,32}$/.test(v), 'Use digits, spaces and an optional leading +'),
  notes: z.string().trim().max(2000).default(''),
});

/** A workspace booking one on behalf of a customer — the same fields, no honeypot. */
export const manualBookingDraftSchema = bookDraftSchema;

export const manageDraftSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-KM-NP-Z2-9]{8,12}$/, 'That reference does not look right'),
  email: z.string().trim().max(320).email('Enter the email address the booking was made with'),
});

// --- read helpers -----------------------------------------------------------

export function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'booking');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Two windows on one weekday may not overlap — the exclusion constraint in 0005 says
 * so, and it only fires after the old week has been deleted. Checking here is what
 * turns that into a message about Monday rather than a half-saved calendar.
 */
export function weekClash(windows: { weekday: number; starts_at: string; ends_at: string }[]): string | null {
  const byDay = new Map<number, { starts_at: string; ends_at: string }[]>();
  for (const window of windows) {
    const list = byDay.get(window.weekday) ?? [];
    list.push({ starts_at: window.starts_at, ends_at: window.ends_at });
    byDay.set(window.weekday, list);
  }
  for (const [weekday, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && current.starts_at < previous.ends_at) {
        return `${weekdayLabel(weekday)} has two windows that overlap: ${toInputTime(previous.starts_at)}–${toInputTime(
          previous.ends_at,
        )} and ${toInputTime(current.starts_at)}–${toInputTime(current.ends_at)}`;
      }
    }
  }
  return null;
}

/**
 * `create_booking`, `cancel_booking` and `reschedule_booking` raise the reason they
 * found. Reading the code out of that message and translating it keeps the
 * customer-facing wording in `SLOT_REASONS` rather than in a Postgres error, and
 * answers anything unrecognised with something to act on instead of internals.
 */
export function refusalCopy(message: string): string {
  const coded = /(?:cannot book|cannot move to that time):\s*([a-z_]+)/.exec(message);
  const reason = coded?.[1];
  if (reason) return slotReason(reason) ?? 'That time is not available. Pick another.';
  if (message.includes('matches that reference')) return 'No booking matches that reference and email address.';
  if (message.includes('past booking')) return 'A booking that has already happened cannot be changed.';
  if (message.includes('already')) return 'That booking is already cancelled, completed or marked as a no-show.';
  if (message.includes('name is required')) return 'Your name is needed.';
  if (message.includes('email is required')) return 'An email address is needed.';
  if (message.includes('email address is not valid')) return 'Enter a valid email address.';
  if (message.includes('start time is required')) return 'Choose a time.';
  if (message.includes('not found')) return 'That service or team member is no longer available.';
  console.error('[yourbiss] booking refused', { message });
  return 'That booking could not be made. Pick another time and try again.';
}

// --- shapes the pages read --------------------------------------------------

/** How one calendar day reads in the slot grid. */
export interface DayCell {
  day: string;
  closed: boolean;
  hasFreeSlot: boolean;
}

export interface SlotCell {
  startsAt: string;
  endsAt: string;
  /** `free`, or the reason code `slot_conflict()` answered with. */
  state: string;
}

/**
 * The service as a stranger sees it. `page_config` and `description` are jsonb and
 * text that a hand-edited row could hold anything in, so the shape is parsed on the
 * way out — a broken row must make the page unavailable, not throw on it.
 */
export interface PublicService {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  name: string;
  slug: string;
  description: string;
  locationKind: 'onsite' | 'online' | 'phone';
  timezone: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  color: string;
  heading: string;
  instructions: string;
  requirePhone: boolean;
  minLeadMin: number;
  maxHorizonDays: number;
  slotStepMin: number;
  intakeForm: { id: string; slug: string; title: string } | null;
}

export const PUBLIC_PAGE_CONFIG = z.object({
  heading: z.string().max(120).default(''),
  instructions: z.string().max(1000).default(''),
  require_phone: z.boolean().default(false),
});

/** Staff as the booking page sees them — never their contact details. */
export interface PublicStaff {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  avatar_url: string | null;
  timezone: string;
}

/** A booking row the owner looks up by reference plus email. */
export interface BookingLookup {
  id: string;
  org_id: string;
  service_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  customer_name: string;
  customer_email: string;
  state: string;
  code: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  org_name: string;
  org_slug: string;
  service_name: string;
  service_slug: string;
  service_duration_min: number;
  service_horizon_days: number;
  staff_name: string;
}

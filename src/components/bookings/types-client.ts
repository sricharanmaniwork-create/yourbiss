/**
 * The shapes the Bookings screens edit, in the form a client component can hold.
 *
 * A database row is not one of these. `page_config` is jsonb and `description`,
 * `bio` and `avatar_url` are nullable text, so a hand-edited or older row can carry
 * anything; each page normalises its row into a document before rendering, the same
 * way the Forms screens do. That keeps the editors free of `?? ''` sprinkled through
 * JSX and keeps a malformed value from becoming a `undefined is not an object`.
 *
 * `location_kind` choices live in `@/lib/bookings/types`, which is safe to import
 * from the browser — it is re-exported here so a screen needs one import, not two.
 */

import { LOCATION_KINDS } from '@/lib/bookings/types';

export { LOCATION_KINDS };
export type LocationKind = (typeof LOCATION_KINDS)[number]['value'];

/** The service column set, with `page_config` narrowed to what the schema allows. */
export interface ServiceDocument {
  id: string;
  name: string;
  slug: string;
  description: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  slot_step_min: number;
  min_lead_min: number;
  max_horizon_days: number;
  daily_limit: number | null;
  capacity: number;
  price_cents: number;
  currency: string;
  location_kind: LocationKind;
  timezone: string;
  color: string;
  intake_form_id: string | null;
  page_config: { heading: string; instructions: string; require_phone: boolean };
  status: 'active' | 'hidden' | 'archived';
  sort_order: number;
}

/**
 * A team member, plus the two things that are not on their own row: which services
 * they offer, and their contact details.
 *
 * `contacts` is null for anyone who is not an owner or admin — `bstaff_contacts_admin`
 * answers a member's select with no rows, so the field is absent rather than hidden by
 * this file. The editor says so on screen instead of showing empty inputs and letting
 * a member press save.
 */
export interface StaffDocument {
  id: string;
  name: string;
  slug: string;
  bio: string;
  avatar_url: string;
  timezone: string;
  status: 'active' | 'hidden' | 'archived';
  sort_order: number;
  user_id: string | null;
  service_ids: string[];
  contacts: { email: string; phone: string; notes: string } | null;
}

/**
 * The four columns an assignment list shows. Kept narrow on purpose: the screen that
 * ticks services for a person needs no numbers from the service document, so the page
 * that renders it reads the row without normalising a whole one.
 */
export interface AssignedService {
  id: string;
  name: string;
  slug: string;
  color: string;
  duration_min: number;
}

/** One weekly window with its breaks, as the editor holds it. */
export interface WeekWindowDoc {
  weekday: number;
  starts_at: string;
  ends_at: string;
  breaks: { starts_at: string; ends_at: string }[];
}

/** The five states a booking can be in, in the order an agenda groups them. */
export const BOOKING_STATES = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export const BOOKING_STATE_LABELS: Record<BookingState, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

export const BOOKING_SOURCE_LABELS: Record<string, string> = {
  web: 'Booking page',
  embed: 'Embedded page',
  manual: 'Recorded by the team',
  import: 'Imported',
};

/**
 * One appointment as the list renders it.
 *
 * A `bookings` row holds ids for the service and the person, and the labels are joined in
 * at read time; `allowed` is computed on the server because the transitions a member may
 * take and the ones an owner or admin may take are different lists, and a button that the
 * database is going to refuse should not be drawn at all. `horizonDays` comes from the
 * service so the move grid pages exactly as far as the customer's grid does.
 */
export interface AppointmentDoc {
  id: string;
  code: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
  internalNotes: string | null;
  cancelReason: string | null;
  state: BookingState;
  source: string;
  allowed: BookingState[];
  serviceId: string;
  serviceName: string;
  color: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  createdAt: string;
  horizonDays: number;
}


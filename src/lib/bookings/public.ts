import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { PUBLIC_PAGE_CONFIG, type BookingLookup, type DayCell, type PublicService, type PublicStaff, type SlotCell } from './types';

/**
 * Reads for the booking page a customer reaches without signing in.
 *
 * `anon` holds no table privileges on any bookings table — that is a deliberate
 * `revoke … from anon, public` in 0005 and 0008 — so RLS cannot serve these rows and
 * this module is the deliberate exception, exactly like the published-site and
 * public-form readers. It uses the service-role client, replaces each policy with the
 * explicit filter that policy used to express (an active service, an active
 * workspace), and returns only what a booking page is meant to show: no
 * `booking_staff_contacts`, no internal notes, no other customer's row.
 *
 * A hidden or archived service stops answering on the next request. A booking already
 * made against it stays readable by reference, because the customer holds that
 * reference and needs to move or cancel it.
 */

interface ServiceShape extends Record<string, unknown> {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  duration_min: number;
  slot_step_min: number;
  min_lead_min: number;
  max_horizon_days: number;
  price_cents: number;
  currency: string;
  location_kind: 'onsite' | 'online' | 'phone';
  timezone: string;
  color: string;
  page_config: unknown;
  intake_form_id: string | null;
  orgs: { id: string; name: string; slug: string } | null;
}

const SERVICE_SELECT =
  'id, org_id, name, slug, description, duration_min, slot_step_min, min_lead_min, max_horizon_days, ' +
  'price_cents, currency, location_kind, timezone, color, page_config, intake_form_id, ' +
  'orgs!inner(id, name, slug, status)';

/**
 * A service as it was hand-edited is not a service as a page can render it. Every
 * column that a `check` constraint guards is re-checked here, because one unreadable
 * row would otherwise throw inside someone's live embed frame.
 */
function toPublicService(value: ServiceShape | null): Omit<PublicService, 'intakeForm'> | null {
  if (!value || !value.orgs) return null;
  if (!Number.isInteger(value.duration_min) || !Number.isInteger(value.slot_step_min)) return null;
  if (!['onsite', 'online', 'phone'].includes(value.location_kind)) return null;
  if (!/^#[0-9A-Fa-f]{6}$/.test(value.color)) return null;

  const config = PUBLIC_PAGE_CONFIG.safeParse(value.page_config ?? {});
  if (!config.success) return null;

  return {
    id: value.id,
    orgId: value.org_id,
    orgName: value.orgs.name,
    orgSlug: value.orgs.slug,
    name: value.name,
    slug: value.slug,
    description: value.description ?? '',
    locationKind: value.location_kind,
    timezone: value.timezone,
    durationMin: value.duration_min,
    priceCents: Number.isInteger(value.price_cents) ? value.price_cents : 0,
    currency: /^[A-Z]{3}$/.test(value.currency) ? value.currency : 'INR',
    color: value.color,
    heading: config.data.heading,
    instructions: config.data.instructions,
    requirePhone: config.data.require_phone,
    minLeadMin: Number.isInteger(value.min_lead_min) ? value.min_lead_min : 60,
    maxHorizonDays: Number.isInteger(value.max_horizon_days) ? value.max_horizon_days : 60,
    slotStepMin: value.slot_step_min,
  };
}

/**
 * An intake form is a bonus, never a dependency: if it was unpublished or deleted
 * between the page loading and the booking, the booking still goes through and the
 * confirmation simply stops linking to it. The id comes from the service row rather
 * than the request, and `org_id` is filtered anyway, so one workspace can never
 * attach another workspace's form.
 */
async function intakeFormScoped(orgId: string, intakeFormId: string | null) {
  if (!intakeFormId) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('forms')
    .select('id, slug, title')
    .eq('id', intakeFormId)
    .eq('org_id', orgId)
    .eq('status', 'published')
    .maybeSingle();
  if (error) {
    console.error('[yourbiss] intake form lookup failed', { intake_form_id: intakeFormId, message: error.message });
    return null;
  }
  return (data ?? null) as { id: string; slug: string; title: string } | null;
}

async function loadService(base: ServiceShape | null): Promise<PublicService | null> {
  if (!base) return null;
  const shaped = toPublicService(base);
  if (!shaped) return null;
  return { ...shaped, intakeForm: await intakeFormScoped(base.org_id, base.intake_form_id) };
}

export async function findServiceBySlug(orgSlug: string, serviceSlug: string): Promise<PublicService | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('booking_services')
    .select(SERVICE_SELECT)
    .eq('orgs.slug', orgSlug)
    .eq('orgs.status', 'active')
    .eq('slug', serviceSlug)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return loadService((data ?? null) as ServiceShape | null);
}

/** The embed frame addresses a service by id, which is unique across the product. */
export async function findServiceById(serviceId: string): Promise<PublicService | null> {
  if (!/^[\w-]{36}$/.test(serviceId)) return null;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('booking_services')
    .select(SERVICE_SELECT)
    .eq('id', serviceId)
    .eq('status', 'active')
    .eq('orgs.status', 'active')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return loadService((data ?? null) as ServiceShape | null);
}

/**
 * Who can take this service. `staff_for_service` already filters to active staff in
 * the workspace that owns the service and orders by `sort_order`, so the page and the
 * insert cannot disagree about who is on offer.
 */
export async function staffOfService(serviceId: string): Promise<PublicStaff[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('staff_for_service', { p_service_id: serviceId });
  if (error) throw new Error(error.message);
  const list = (data ?? []) as unknown as Record<string, unknown>[];
  return list
    .filter((row) => typeof row.id === 'string' && typeof row.name === 'string')
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug ?? ''),
      bio: typeof row.bio === 'string' ? row.bio : null,
      avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
      timezone: String(row.timezone ?? 'Asia/Kolkata'),
    }));
}

/**
 * One call for a whole calendar. The alternative — a slot query per day — would be 28
 * round trips for a page whose only job at that moment is to grey out the closed days.
 */
export async function dayGrid(serviceId: string, staffId: string, from: string, days = 28): Promise<DayCell[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('bookable_days', {
    p_service_id: serviceId,
    p_staff_id: staffId,
    p_from: from,
    p_days: Math.max(1, Math.min(90, days)),
  });
  if (error) throw new Error(error.message);
  const list = (data ?? []) as unknown as { day: string; closed: boolean; has_free_slot: boolean }[];
  return list.map((row) => ({ day: row.day, closed: row.closed === true, hasFreeSlot: row.has_free_slot === true }));
}

/**
 * The slots for one day, straight from `available_slots`. Every row carries either
 * `free` or the reason it was refused, which is why the page can say *why* 2 pm is
 * grey rather than leaving the customer to guess.
 */
export async function slotsOfDay(serviceId: string, staffId: string, day: string, tz?: string): Promise<SlotCell[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('available_slots', {
    p_service_id: serviceId,
    p_staff_id: staffId,
    p_day: day,
    p_tz: tz ?? null,
  });
  if (error) throw new Error(error.message);
  const list = (data ?? []) as unknown as { starts_at: string; ends_at: string; state: string }[];
  return list
    .filter((row) => row.starts_at && row.ends_at)
    .map((row) => ({ startsAt: row.starts_at, endsAt: row.ends_at, state: row.state ?? 'free' }));
}

interface LookupShape extends Record<string, unknown> {
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
  orgs: { name: string; slug: string; status: string } | null;
  booking_services: { name: string; slug: string; duration_min: number; max_horizon_days: number } | null;
  booking_staff: { name: string } | null;
}

/**
 * The one anonymous read of a booking row, and it is keyed on both halves of the
 * secret the customer holds. `code` alone would let anyone walk the reference space
 * and read names, emails and times; matching the stored email too is what makes the
 * reference a capability instead of a primary key.
 */
export async function findBookingByReference(code: string, email: string): Promise<BookingLookup | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, org_id, service_id, staff_id, starts_at, ends_at, timezone, customer_name, customer_email, state, code, ' +
        'cancelled_at, cancel_reason, ' +
        'orgs!inner(name, slug, status), ' +
        'booking_services!inner(name, slug, duration_min, max_horizon_days), ' +
        'booking_staff!inner(name)',
    )
    .eq('code', code)
    .eq('customer_email', email)
    .eq('orgs.status', 'active')
    .maybeSingle();

  if (error) throw new Error(error.message);
  const value = (data ?? null) as LookupShape | null;
  if (!value || !value.orgs || !value.booking_services || !value.booking_staff) return null;

  return {
    id: value.id,
    org_id: value.org_id,
    service_id: value.service_id,
    staff_id: value.staff_id,
    starts_at: value.starts_at,
    ends_at: value.ends_at,
    timezone: value.timezone,
    customer_name: value.customer_name,
    customer_email: value.customer_email,
    state: value.state,
    code: value.code,
    cancelled_at: value.cancelled_at,
    cancel_reason: value.cancel_reason,
    org_name: value.orgs.name,
    org_slug: value.orgs.slug,
    service_name: value.booking_services.name,
    service_slug: value.booking_services.slug,
    service_duration_min: value.booking_services.duration_min,
    service_horizon_days: Number.isInteger(value.booking_services.max_horizon_days) ? value.booking_services.max_horizon_days : 60,
    staff_name: value.booking_staff.name,
  };
}

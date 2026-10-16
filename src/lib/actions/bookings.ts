'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership, createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import { slotsOfDay, staffOfService } from '@/lib/bookings/public';
import { drainBookingMailSoon } from '@/lib/bookings/outbox';
import { dateInZone, formatInZone, slugify } from '@/lib/utils';
import {
  closedDayDraftSchema,
  exceptionDraftSchema,
  fieldErrors,
  manualBookingDraftSchema,
  refusalCopy,
  serviceDraftSchema,
  staffContactDraftSchema,
  staffDraftSchema,
  toPostgresTime,
  weekClash,
  weekSchema,
  weekdayLabel,
} from '@/lib/bookings/types';
import type { PublicStaff } from '@/lib/bookings/types';
import type { ActionState } from '@/lib/types';

/**
 * Every write the Bookings app makes.
 *
 * Three deliberate divisions run through this file, and all three come from the
 * database rather than from taste:
 *
 *   * `bookings` has no INSERT policy for any client role. A booking is created by
 *     `create_booking`, moved by `reschedule_booking` and closed by
 *     `cancel_booking` — nothing else — because those functions re-run
 *     `slot_conflict()` under an advisory lock. So the customer path and the manual
 *     path both call the RPC and neither touches the table.
 *   * `booking_staff_contacts` and `booking_closed_days` are admin-only policies, so
 *     those two actions call `assertAdmin` and would fail at the row anyway.
 *   * A member's own client does the reading, so "is this record yours" is RLS's
 *     answer and not a comparison this file might forget to write.
 *
 * Where an action must write something the member role has no privilege on — a
 * queued notification, a booking row the customer creates — the service-role client
 * is used *after* membership has been proven with the member's own session.
 */

function uuidOk(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

interface ServiceRef {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  intake_form_id: string | null;
}

interface StaffRef {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string;
}

/** Read with the caller's session: a service in another workspace simply is not there. */
async function loadServiceRef(serviceId: string): Promise<ServiceRef | null> {
  if (!uuidOk(serviceId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_services')
    .select('id, org_id, name, slug, status, intake_form_id')
    .eq('id', serviceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ServiceRef | null) ?? null;
}

async function loadStaffRef(staffId: string): Promise<StaffRef | null> {
  if (!uuidOk(staffId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_staff')
    .select('id, org_id, name, slug, status, timezone')
    .eq('id', staffId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as StaffRef | null) ?? null;
}

function revalidateBookings(serviceId?: string, staffId?: string) {
  revalidatePath('/app/bookings');
  revalidatePath('/app/bookings/calendar');
  revalidatePath('/app/bookings/appointments');
  revalidatePath('/app/bookings/availability');
  revalidatePath('/app/bookings/services');
  revalidatePath('/app/bookings/staff');
  if (serviceId) revalidatePath(`/app/bookings/services/${serviceId}`);
  if (staffId) revalidatePath(`/app/bookings/staff/${staffId}`);
}

/**
 * `unique (org_id, slug)` in both tables, and the address is what a customer types.
 * Trying the next suffix beats returning "that address is taken" for a name two
 * workspaces always end up using twice.
 */
async function claimSlug(
  table: 'booking_services' | 'booking_staff',
  orgId: string,
  requested: string,
): Promise<string> {
  const supabase = await createClient();
  let slug = requested;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data: clash } = await supabase.from(table).select('id').eq('org_id', orgId).eq('slug', slug).maybeSingle();
    if (!clash) return slug;
    slug = `${requested.slice(0, 52)}-${attempt + 2}`;
  }
  return `${requested.slice(0, 48)}-${Date.now().toString(36).slice(-6)}`;
}

/**
 * A single-letter service name still has to produce a legal address, and the column
 * check wants 1–120 characters while the path wants at least two.
 */
function usableSlug(value: string, fallback: string): string {
  return /^[a-z0-9][a-z0-9-]{1,59}$/.test(value) ? value : fallback;
}

// --- services ---------------------------------------------------------------

export async function createService(
  input: { orgId: string; name: string; slug?: string },
): Promise<ActionState & { id?: string; slug?: string }> {
  const name = z.string().trim().min(1, 'Give the service a name').max(120).safeParse(input.name);
  if (!name.success || !uuidOk(input.orgId)) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(name.success ? [] : name.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertMembership(supabase, input.orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a service' };

  const wanted = input.slug && input.slug.trim() !== '' ? slugify(input.slug, 'service') : slugify(name.data, 'service');
  const slug = await claimSlug('booking_services', input.orgId, usableSlug(wanted, 'service'));

  const { data, error } = await supabase
    .from('booking_services')
    .insert({ org_id: input.orgId, name: name.data, slug, duration_min: 60, status: 'active' })
    .select('id, slug')
    .single();

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'This workspace already has a service at that address' : error.message };
  }

  const created = data as unknown as { id: string; slug: string };
  await logActivity(supabase, {
    orgId: input.orgId,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_service',
    entityId: created.id,
    action: 'created',
    summary: `Added the service “${name.data}”`,
  });

  revalidateBookings();
  return { ok: true, id: created.id, slug: created.slug };
}

export async function saveService(serviceId: string, draft: unknown): Promise<ActionState> {
  const service = await loadServiceRef(serviceId);
  if (!service) return { ok: false, error: 'That service is not in this workspace' };

  const parsed = serviceDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertMembership(supabase, service.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change services' };

  const value = parsed.data;
  const { error } = await supabase
    .from('booking_services')
    .update({
      name: value.name,
      slug: value.slug,
      description: value.description || null,
      duration_min: value.duration_min,
      buffer_before_min: value.buffer_before_min,
      buffer_after_min: value.buffer_after_min,
      slot_step_min: value.slot_step_min,
      min_lead_min: value.min_lead_min,
      max_horizon_days: value.max_horizon_days,
      daily_limit: value.daily_limit,
      capacity: value.capacity,
      price_cents: value.price_cents,
      currency: value.currency,
      location_kind: value.location_kind,
      timezone: value.timezone,
      color: value.color,
      intake_form_id: value.intake_form_id,
      page_config: {
        heading: value.page_config.heading,
        instructions: value.page_config.instructions,
        require_phone: value.page_config.require_phone,
      },
      status: value.status,
      sort_order: value.sort_order,
    })
    .eq('id', serviceId);

  if (error) {
    return {
      ok: false,
      error: error.code === '23505' ? 'Another service already uses that address' : error.message,
    };
  }

  await logActivity(supabase, {
    orgId: service.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_service',
    entityId: service.id,
    action: 'updated',
    summary: `Saved the service “${value.name}”`,
  });

  revalidateBookings(serviceId);
  return { ok: true };
}

export async function setServiceStatus(
  serviceId: string,
  status: 'active' | 'hidden' | 'archived',
): Promise<ActionState> {
  const service = await loadServiceRef(serviceId);
  if (!service) return { ok: false, error: 'That service is not in this workspace' };

  const supabase = await createClient();
  const actor =
    status === 'archived'
      ? await assertAdmin(supabase, service.org_id).catch(() => null)
      : await assertMembership(supabase, service.org_id).catch(() => null);
  if (!actor) {
    return { ok: false, error: status === 'archived' ? 'Only an admin can archive a service' : 'Only a member can change this service' };
  }

  const { error } = await supabase.from('booking_services').update({ status }).eq('id', serviceId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: service.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_service',
    entityId: service.id,
    action: status === 'active' ? 'published' : status,
    summary:
      status === 'active'
        ? `Put “${service.name}” back on the booking page`
        : status === 'hidden'
          ? `Hid “${service.name}” from the booking page`
          : `Archived “${service.name}”`,
  });

  revalidateBookings(serviceId);
  return { ok: true };
}

export async function deleteService(serviceId: string): Promise<ActionState> {
  const service = await loadServiceRef(serviceId);
  if (!service) return { ok: false, error: 'That service is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, service.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can delete a service' };

  const { error } = await supabase.from('booking_services').delete().eq('id', serviceId);
  if (error) {
    // `service_id … on delete restrict` is deliberate: an appointment someone holds
    // a reference for must not lose what it was for.
    if (error.code === '23503') {
      return { ok: false, error: 'Bookings exist for this service, so it cannot be deleted. Archive it instead — that takes it off the booking page and keeps every appointment readable.' };
    }
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, {
    orgId: service.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_service',
    entityId: service.id,
    action: 'deleted',
    summary: `Deleted the service “${service.name}”`,
  });

  revalidateBookings();
  return { ok: true };
}

// --- staff ------------------------------------------------------------------

export async function createStaff(
  input: { orgId: string; name: string; slug?: string; timezone: string },
): Promise<ActionState & { id?: string; slug?: string }> {
  const name = z.string().trim().min(1, 'Give the team member a name').max(80).safeParse(input.name);
  const timezone = z.string().trim().min(1).max(64).regex(/^[A-Za-z_/]{1,64}$/, 'Choose a time zone').safeParse(input.timezone);
  if (!name.success || !uuidOk(input.orgId)) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(name.success ? [] : name.error.issues) };
  }
  if (!timezone.success) return { ok: false, error: 'Choose a time zone', fields: { timezone: 'Choose a time zone' } };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, input.orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a team member' };

  const wanted = input.slug && input.slug.trim() !== '' ? slugify(input.slug, 'staff') : slugify(name.data, 'staff');
  const slug = await claimSlug('booking_staff', input.orgId, usableSlug(wanted, 'staff'));

  const { data, error } = await supabase
    .from('booking_staff')
    .insert({ org_id: input.orgId, name: name.data, slug, timezone: timezone.data })
    .select('id, slug')
    .single();

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'This workspace already has a team member at that address' : error.message };
  }

  const created = data as unknown as { id: string; slug: string };
  await logActivity(supabase, {
    orgId: input.orgId,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: created.id,
    action: 'created',
    summary: `Added ${name.data} to the team`,
  });

  revalidateBookings();
  return { ok: true, id: created.id, slug: created.slug };
}

export async function saveStaff(staffId: string, draft: unknown): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const parsed = staffDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertMembership(supabase, staff.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change the team' };

  const value = parsed.data;
  const { error } = await supabase
    .from('booking_staff')
    .update({
      name: value.name,
      slug: value.slug,
      bio: value.bio || null,
      avatar_url: value.avatar_url || null,
      timezone: value.timezone,
      status: value.status,
      sort_order: value.sort_order,
    })
    .eq('id', staffId);

  if (error) {
    return { ok: false, error: error.code === '23505' ? 'Another team member already uses that address' : error.message };
  }

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: staff.id,
    action: 'updated',
    summary: `Saved ${value.name}’s profile`,
  });

  revalidateBookings(undefined, staffId);
  return { ok: true };
}

/**
 * Contact details are the one staff record a member cannot touch: the
 * `bstaff_contacts_admin` policy is written for owners and admins because a booking
 * page shows staff by design and must not be able to show their phone number.
 */
export async function saveStaffContacts(staffId: string, draft: unknown): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const parsed = staffContactDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, staff.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can change a team member’s contact details' };

  const value = parsed.data;
  const { error } = await supabase
    .from('booking_staff_contacts')
    .upsert(
      {
        staff_id: staffId,
        org_id: staff.org_id,
        email: value.email || null,
        phone: value.phone || null,
        notes: value.notes || null,
      },
      { onConflict: 'staff_id' },
    );

  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: staff.id,
    action: 'updated',
    summary: `Changed ${staff.name}’s contact details`,
  });

  revalidateBookings(undefined, staffId);
  return { ok: true };
}

export async function setStaffServices(staffId: string, serviceIds: string[]): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const ids = [...new Set(serviceIds.filter(uuidOk))];

  const supabase = await createClient();
  const actor = await assertMembership(supabase, staff.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change who offers what' };

  const { error: cleared } = await supabase.from('booking_staff_services').delete().eq('staff_id', staffId);
  if (cleared) return { ok: false, error: cleared.message };

  if (ids.length > 0) {
    // The policy's `exists` clauses are what stop one workspace's staff being paired
    // with another workspace's service, so the ids are filtered to uuids and then
    // judged by RLS rather than by a list read here.
    const { error: filled } = await supabase
      .from('booking_staff_services')
      .insert(ids.map((service_id) => ({ staff_id: staffId, service_id, org_id: staff.org_id })));
    if (filled) {
      return {
        ok: false,
        error: filled.code === '23505' ? 'That service is already assigned' : filled.message,
      };
    }
  }

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: staff.id,
    action: 'updated',
    summary: `Set ${staff.name} to offer ${ids.length} service${ids.length === 1 ? '' : 's'}`,
  });

  revalidateBookings(undefined, staffId);
  return { ok: true };
}

/**
 * Visibility, kept out of the profile form on purpose.
 *
 * Hiding is a member's decision — it takes a person off the booking page while their
 * appointments, hours and assignments all stay — but archiving is an admin's, because it
 * removes the row from every list and the only way back is to set it active again in the
 * database. Splitting the two here means the button a member sees is the transition the
 * policy actually grants them.
 */
export async function setStaffStatus(
  staffId: string,
  status: 'active' | 'hidden' | 'archived',
): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const supabase = await createClient();
  const actor =
    status === 'archived'
      ? await assertAdmin(supabase, staff.org_id).catch(() => null)
      : await assertMembership(supabase, staff.org_id).catch(() => null);
  if (!actor) {
    return { ok: false, error: status === 'archived' ? 'Only an admin can archive a team member' : 'Only a member can change this' };
  }

  const { error } = await supabase.from('booking_staff').update({ status }).eq('id', staffId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: staff.id,
    action: status === 'active' ? 'published' : status,
    summary:
      status === 'active'
        ? `Put ${staff.name} back on the booking page`
        : status === 'hidden'
          ? `Hid ${staff.name} from the booking page`
          : `Archived ${staff.name}`,
  });

  revalidateBookings(undefined, staffId);
  return { ok: true };
}

export async function deleteStaff(staffId: string): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, staff.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can delete a team member' };

  const { error } = await supabase.from('booking_staff').delete().eq('id', staffId);
  if (error) {
    if (error.code === '23503') {
      return { ok: false, error: 'Bookings exist for this team member, so they cannot be deleted. Set them to hidden instead — that keeps their history and takes them off the booking page.' };
    }
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: staff.id,
    action: 'deleted',
    summary: `Deleted ${staff.name} from the team`,
  });

  revalidateBookings();
  return { ok: true };
}

// --- the weekly calendar ----------------------------------------------------

/**
 * A week is replaced as a unit. The exclusion constraint on `booking_availability`
 * forbids two overlapping windows for one weekday, and a row-by-row edit would have
 * to fight it every time a business moves Monday's morning slot — so the old week
 * goes and the new one is checked for overlap first, in this file, before anything is
 * deleted.
 */
export async function saveWeek(staffId: string, input: unknown): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const parsed = weekSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const clash = weekClash(parsed.data.windows);
  if (clash) return { ok: false, error: clash };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, staff.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change working hours' };

  const { error: cleared } = await supabase.from('booking_availability').delete().eq('staff_id', staffId);
  if (cleared) return { ok: false, error: cleared.message };

  for (const window of parsed.data.windows) {
    const startsAt = toPostgresTime(window.starts_at);
    const endsAt = toPostgresTime(window.ends_at);

    const { data: created, error } = await supabase
      .from('booking_availability')
      .insert({
        staff_id: staffId,
        org_id: staff.org_id,
        weekday: window.weekday,
        starts_at: startsAt,
        ends_at: endsAt,
      })
      .select('id')
      .single();

    if (error) {
      return {
        ok: false,
        error: error.code === '23503' ? 'That window does not belong to this team member’s workspace.' : `Could not save ${weekdayLabel(window.weekday)}: ${error.message}`,
      };
    }

    const availabilityId = (created as unknown as { id: string } | null)?.id;
    if (!availabilityId) continue;

    if (window.breaks.length > 0) {
      const { error: breakError } = await supabase.from('booking_breaks').insert(
        window.breaks.map((brake) => ({
          availability_id: availabilityId,
          staff_id: staffId,
          org_id: staff.org_id,
          starts_at: toPostgresTime(brake.starts_at),
          ends_at: toPostgresTime(brake.ends_at),
        })),
      );
      if (breakError) return { ok: false, error: `The hours saved but a break did not: ${breakError.message}` };
    }
  }

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_staff',
    entityId: staff.id,
    action: 'updated',
    summary: `Replaced ${staff.name}’s weekly hours (${parsed.data.windows.length} window${parsed.data.windows.length === 1 ? '' : 's'})`,
  });

  revalidateBookings(undefined, staffId);
  return { ok: true };
}

// --- exceptions and closures ------------------------------------------------

/** One day off, or one extra window on a day that is otherwise closed. */
export async function addException(staffId: string, draft: unknown): Promise<ActionState> {
  const staff = await loadStaffRef(staffId);
  if (!staff) return { ok: false, error: 'That team member is not in this workspace' };

  const parsed = exceptionDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertMembership(supabase, staff.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change these hours' };

  const value = parsed.data;
  const { error } = await supabase.from('booking_exceptions').insert({
    staff_id: staffId,
    org_id: staff.org_id,
    day: value.day,
    kind: value.kind,
    starts_at: value.kind === 'extra' && value.starts_at ? toPostgresTime(value.starts_at) : null,
    ends_at: value.kind === 'extra' && value.ends_at ? toPostgresTime(value.ends_at) : null,
    reason: value.reason || null,
  });

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That day is already closed for this team member. Remove it and add it again if you meant to change it.' };
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, {
    orgId: staff.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_exception',
    entityId: null,
    action: 'created',
    summary: `${value.kind === 'closed' ? 'Closed' : 'Added hours to'} ${value.day} for ${staff.name}`,
  });

  revalidateBookings(undefined, staffId);
  return { ok: true };
}

export async function removeException(exceptionId: string): Promise<ActionState> {
  if (!uuidOk(exceptionId)) return { ok: false, error: 'That entry cannot be found' };

  const supabase = await createClient();
  const { data, error } = await supabase.from('booking_exceptions').select('id, org_id, staff_id, day, kind').eq('id', exceptionId).maybeSingle();
  if (error) return { ok: false, error: error.message };

  const entry = (data ?? null) as { id: string; org_id: string; staff_id: string; day: string; kind: string } | null;
  if (!entry) return { ok: false, error: 'That entry is not in this workspace' };

  const actor = await assertMembership(supabase, entry.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change these hours' };

  const { error: removed } = await supabase.from('booking_exceptions').delete().eq('id', entry.id);
  if (removed) return { ok: false, error: removed.message };

  await logActivity(supabase, {
    orgId: entry.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_exception',
    entityId: entry.id,
    action: 'deleted',
    summary: `Removed the ${entry.kind} entry for ${entry.day}`,
  });

  revalidateBookings(undefined, entry.staff_id);
  return { ok: true };
}

/**
 * A closure is the whole workspace — festivals, a power cut, a day off for everyone.
 * `bclosed_write` is an admin policy, and the row has no staff to attach to, so this
 * is the one hours action that takes `orgId` directly.
 */
export async function addClosedDay(orgId: string, draft: unknown): Promise<ActionState> {
  const parsed = closedDayDraftSchema.safeParse(draft);
  if (!parsed.success || !uuidOk(orgId)) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.success ? [] : parsed.error.issues) };
  }

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can close the workspace' };

  const { error } = await supabase
    .from('booking_closed_days')
    .insert({ org_id: orgId, day: parsed.data.day, reason: parsed.data.reason || null });

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That date is already closed' };
    return { ok: false, error: error.message };
  }

  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_closed_day',
    entityId: parsed.data.day,
    action: 'created',
    summary: `Closed the workspace on ${parsed.data.day}${parsed.data.reason ? ` — ${parsed.data.reason}` : ''}`,
  });

  revalidateBookings();
  return { ok: true };
}

export async function removeClosedDay(orgId: string, day: string): Promise<ActionState> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !uuidOk(orgId)) return { ok: false, error: 'That date cannot be found' };

  const supabase = await createClient();
  const actor = await assertAdmin(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an admin can reopen a closed date' };

  const { error } = await supabase.from('booking_closed_days').delete().eq('org_id', orgId).eq('day', day);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking_closed_day',
    entityId: day,
    action: 'deleted',
    summary: `Reopened ${day} for the workspace`,
  });

  revalidateBookings();
  return { ok: true };
}

// --- the appointments list --------------------------------------------------

/**
 * Which transitions the trigger will accept. `bookings_immutable_fields` refuses to
 * reopen a closed booking and refuses to move `starts_at`/`staff_id` outside a
 * reschedule; saying the same thing here means the button is disabled instead of the
 * save failing.
 */
const NEXT_STATES: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  // Deliberately empty, and not because nobody thought of it. The trigger refuses to
  // move a closed row off its state for every client role, service_role included, and
  // the only way past it is to set `youbiss.reschedule_booking_id` — which also frees
  // `starts_at` and `staff_id` for the same update. A reopen bought with a bypass that
  // can move an appointment is not worth having: the team records the appointment again
  // as a new booking, which keeps the cancelled row as the record it is.
  cancelled: [],
  completed: [],
  no_show: [],
};

export async function setBookingState(
  bookingId: string,
  state: 'confirmed' | 'cancelled' | 'completed' | 'no_show',
  reason?: string,
): Promise<ActionState> {
  if (!uuidOk(bookingId)) return { ok: false, error: 'That booking cannot be found' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select('id, org_id, customer_name, customer_email, code, state, service_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const booking = (data ?? null) as
    | { id: string; org_id: string; customer_name: string; customer_email: string; code: string; state: string; service_id: string }
    | null;
  if (!booking) return { ok: false, error: 'That booking is not in this workspace' };

  const actor = await assertMembership(supabase, booking.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change a booking' };

  if (!(NEXT_STATES[booking.state] ?? []).includes(state)) {
    return {
      ok: false,
      error:
        booking.state === state
          ? `That booking is already ${state.replace('_', ' ')}.`
          : `A ${booking.state.replace('_', ' ')} booking cannot become ${state.replace('_', ' ')}.`,
    };
  }

  // The transition itself is the member's own — `bookings_update_self` lets them change
  // an appointment in their workspace, and `bookings_immutable_fields` judges which
  // transition is legal. But `bclosed_write` is admin-only and the trigger refuses
  // `cancelled → active`, so a workspace where the Appointments screen is reachable by
  // members would otherwise let a member write a state the row can never hold. The
  // database still refuses; this says so in the same words the policy uses.
  if (state !== 'cancelled') {
    const privileged = await assertAdmin(supabase, booking.org_id).catch(() => null);
    if (!privileged) {
      return { ok: false, error: 'Only an owner or admin can mark a booking confirmed, completed or a no-show.' };
    }
  }

  const { error: updated } = await supabase
    .from('bookings')
    .update({
      state,
      cancelled_at: state === 'cancelled' ? new Date().toISOString() : null,
      cancel_reason: state === 'cancelled' ? (reason?.trim().slice(0, 300) || null) : null,
    })
    .eq('id', bookingId);

  if (updated) return { ok: false, error: updated.message };

  // Cancelling has to tell the customer. Writing that row needs the service-role
  // client, because `authenticated` holds SELECT and UPDATE on
  // `booking_notifications` and nothing else — the outbox is the worker's to fill.
  // It is awaited rather than fired and forgotten: a serverless function can be
  // frozen the moment it answers, and nothing else ever queues this letter.
  if (state === 'cancelled') {
    await queueCancellationMail(booking.org_id, booking.id, booking.customer_email);
    await drainBookingMailSoon();
  }

  await logActivity(supabase, {
    orgId: booking.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking',
    entityId: booking.id,
    action: state === 'cancelled' ? 'cancelled' : 'updated',
    summary:
      state === 'cancelled'
        ? `Cancelled ${booking.customer_name}’s booking ${booking.code}`
        : `Marked ${booking.customer_name}’s booking ${booking.code} as ${state.replace('_', ' ')}`,
  });

  revalidateBookings();
  return { ok: true };
}

async function queueCancellationMail(orgId: string, bookingId: string, recipient: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('booking_notifications').insert({
      org_id: orgId,
      booking_id: bookingId,
      kind: 'cancelled',
      recipient,
    });
    // A duplicate is the same letter already queued, so a unique violation is success.
    if (error && error.code !== '23505') console.error('[yourbiss] cancellation mail not queued', error.message);
  } catch (e) {
    // The booking is already cancelled and saved; a letter that could not be queued
    // is reported rather than allowed to roll back or fail the customer's change.
    console.error('[yourbiss] cancellation mail queue failed', e instanceof Error ? e.message : String(e));
  }
}

export async function saveInternalNotes(bookingId: string, notes: string): Promise<ActionState> {
  if (!uuidOk(bookingId)) return { ok: false, error: 'That booking cannot be found' };
  const trimmed = notes.trim().slice(0, 2000);

  const supabase = await createClient();
  const { data, error } = await supabase.from('bookings').select('id, org_id').eq('id', bookingId).maybeSingle();
  if (error) return { ok: false, error: error.message };

  const booking = (data ?? null) as { id: string; org_id: string } | null;
  if (!booking) return { ok: false, error: 'That booking is not in this workspace' };

  const actor = await assertMembership(supabase, booking.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add a note' };

  const { error: saved } = await supabase.from('bookings').update({ internal_notes: trimmed || null }).eq('id', bookingId);
  if (saved) return { ok: false, error: saved.message };

  revalidateBookings();
  return { ok: true };
}

// --- booking for a customer, from inside the app ----------------------------

/**
 * A walk-in or a phone booking, recorded by the workspace.
 *
 * It goes through `create_booking` with `p_source = 'manual'` for the same reason the
 * customer page does: it is the only door with a conflict check and an advisory lock.
 * One consequence is worth naming — that function runs as `security definer`, so
 * `auth.uid()` inside it is the anonymous role's, and `bookings.created_by` is null
 * for a manual booking. Who recorded it is in `activity_log`, with the actor, because
 * that row is written here with the member's own session.
 */
export async function createManualBooking(draft: unknown): Promise<ActionState & { code?: string }> {
  const parsed = manualBookingDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { data } = await supabase.from('booking_services').select('id, org_id, name').eq('id', parsed.data.service_id).maybeSingle();
  const service = (data ?? null) as { id: string; org_id: string; name: string } | null;
  if (!service) return { ok: false, error: 'That service is not in this workspace' };

  const actor = await assertMembership(supabase, service.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can record a booking' };

  const admin = createAdminClient();
  const { data: created, error } = await admin.rpc('create_booking', {
    p_service_id: parsed.data.service_id,
    p_staff_id: parsed.data.staff_id,
    p_starts_at: parsed.data.starts_at,
    p_customer_name: parsed.data.customer_name,
    p_customer_email: parsed.data.customer_email,
    p_customer_phone: parsed.data.customer_phone || null,
    p_notes: parsed.data.notes || null,
    p_source: 'manual',
    p_tz: null,
  });

  if (error) return { ok: false, error: refusalCopy(error.message) };

  const booking = (created ?? null) as { id: string; code: string } | null;
  if (!booking) return { ok: false, error: 'The booking could not be read back. Check the appointments list before trying again.' };

  await logActivity(supabase, {
    orgId: service.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking',
    entityId: booking.id,
    action: 'created',
    summary: `Recorded “${service.name}” for ${parsed.data.customer_name} as reference ${booking.code}`,
  });

  revalidateBookings();
  // The customer gets the same letter as one made on the public page, and it goes out
  // when this action answers rather than whenever the cron next runs.
  await drainBookingMailSoon();
  return { ok: true, code: booking.code };
}

/**
 * Who can be booked with on a service, for the screen that records a booking by hand.
 *
 * The reading is the customer's own — `staff_of_service` answers with the active people
 * who offer an active service — so the manual grid can never show a person the public
 * page would refuse. Membership is checked first because this is a door that answers for
 * any service id, and a hidden service's team is not something a stranger should list.
 */
export async function bookingTeam(serviceId: string): Promise<ActionState & { team?: PublicStaff[] }> {
  const ref = await loadServiceRef(serviceId).catch((error: unknown) => {
    console.error('[yourbiss] booking team lookup failed', {
      service_id: serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!ref) return { ok: false, error: 'That service is not in this workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, ref.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can read this team' };

  try {
    return { ok: true, team: await staffOfService(serviceId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The team could not be read.' };
  }
}

/** The three states the trigger treats as closed, and the reason a row cannot leave them. */
const CLOSED_STATES = ['cancelled', 'completed', 'no_show'];

/**
 * Move an appointment to another slot, from inside the workspace.
 *
 * There is no update path to `starts_at` outside a reschedule: the trigger only releases
 * the time columns when the transaction-local `youbiss.reschedule_booking_id` names the
 * row, and the only thing that sets it is `reschedule_booking()` — a service-role-only
 * function. So this proves membership with the caller's own session, reads the reference
 * and address the row carries *through RLS*, and hands both to the function; a booking in
 * another workspace is never found, and the caller cannot supply someone else's code.
 *
 * The new time is re-read from `available_slots()` in the zone stored on the row before
 * the function runs, exactly as the customer-facing route does, because the engine would
 * refuse anyway and the grid can name the reason. That function queues the reschedule
 * letter into `booking_notifications` itself, so nothing is queued here.
 */
export async function moveBooking(bookingId: string, startsAt: string): Promise<ActionState> {
  if (!uuidOk(bookingId)) return { ok: false, error: 'That booking cannot be found' };
  const wanted = new Date(startsAt);
  if (startsAt === '' || Number.isNaN(wanted.getTime())) return { ok: false, error: 'Pick a time from the list.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select('id, org_id, code, customer_name, customer_email, service_id, staff_id, timezone, state')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const booking = (data ?? null) as {
    id: string;
    org_id: string;
    code: string;
    customer_name: string;
    customer_email: string;
    service_id: string;
    staff_id: string;
    timezone: string;
    state: string;
  } | null;
  if (!booking) return { ok: false, error: 'That booking is not in this workspace' };

  const actor = await assertMembership(supabase, booking.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can move a booking' };

  if (CLOSED_STATES.includes(booking.state)) {
    return { ok: false, error: 'A cancelled, completed or no-show booking cannot be moved. Record the appointment again instead.' };
  }

  let offered;
  try {
    offered = await slotsOfDay(booking.service_id, booking.staff_id, dateInZone(wanted, booking.timezone), booking.timezone);
  } catch (error) {
    console.error('[yourbiss] move could not read the slots', {
      booking_id: bookingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'That booking could not be moved. Please try again.' };
  }

  const milliseconds = wanted.getTime();
  const matching = offered.filter((slot) => new Date(slot.startsAt).getTime() === milliseconds);
  const chosen = matching.find((slot) => slot.state === 'free');
  if (!chosen) {
    const reason = matching[0]?.state;
    return {
      ok: false,
      error: reason && reason !== 'free' ? refusalCopy(`cannot move to that time: ${reason}`) : 'That time has just gone. Pick another slot.',
    };
  }

  const admin = createAdminClient();
  const { data: patched, error: rpcError } = await admin.rpc('reschedule_booking', {
    p_code: booking.code,
    p_email: booking.customer_email,
    p_starts_at: chosen.startsAt,
    // Null on purpose: the function coalesces to the zone already on the row, which is
    // the zone the grid above was read in.
    p_tz: null,
  });
  if (rpcError) return { ok: false, error: refusalCopy(rpcError.message) };
  if (!patched) return { ok: false, error: 'That booking could not be moved. Please try again.' };

  await logActivity(supabase, {
    orgId: booking.org_id,
    actorId: actor.userId,
    appKey: 'bookings',
    entityType: 'booking',
    entityId: booking.id,
    action: 'updated',
    summary: `Moved ${booking.customer_name}’s booking ${booking.code} to ${formatInZone(chosen.startsAt, booking.timezone)}`,
  });

  revalidateBookings();
  // `reschedule_booking` re-queued the rescheduled letter with its counter reset; this is
  // what puts it in the customer's inbox today rather than at the next cron tick.
  await drainBookingMailSoon();
  return { ok: true };
}

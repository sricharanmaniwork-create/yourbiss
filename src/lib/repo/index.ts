import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  ActivityEntry,
  Booking,
  BookingService,
  BookingStaff,
  EmailSettingsRow,
  FormRow,
  OrgMember,
  Site,
  SitePage,
  SiteVersion,
  UserProfile,
} from '@/lib/types';

/**
 * Reads for member-facing screens. Every function uses the request-scoped
 * client, so what a caller can see is decided by RLS and not by a `.eq('org_id')`
 * we might forget to write. Writes live in server actions and route handlers,
 * where the payload gets validated before it reaches the database.
 */

/**
 * Supabase's query builder is untyped until `gen types` runs against a live
 * project, so results are laundered once here rather than at every call site.
 * If a column changes, these casts are the only place to look.
 */
function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

function row<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}

export interface DashboardCounts {
  sites: number;
  published_pages: number;
  forms: number;
  form_responses: number;
  responses_last_7d: number;
  services: number;
  staff: number;
  bookings_upcoming: number;
  bookings_30d: number;
  members: number;
}

export async function dashboardCounts(orgId: string): Promise<DashboardCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('org_dashboard_counts', { p_org_id: orgId });
  if (error) throw new Error(error.message);
  return (data ?? {}) as DashboardCounts;
}

export async function recentActivity(orgId: string, limit = 12): Promise<ActivityEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('org_recent_activity', { p_org_id: orgId, p_limit: limit });
  if (error) throw new Error(error.message);
  return rows<ActivityEntry>(data);
}

// --- websites ---------------------------------------------------------------

export async function listSites(orgId: string): Promise<Site[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return rows<Site>(data);
}

export async function getSite(siteId: string): Promise<Site | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('sites').select('*').eq('id', siteId).maybeSingle();
  if (error) throw new Error(error.message);
  return row<Site>(data);
}

export async function listPages(siteId: string): Promise<SitePage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages')
    .select('*')
    .eq('site_id', siteId)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<SitePage>(data);
}

/** Page list without the jsonb trees, for screens that only show titles. */
export async function listPageSummaries(siteId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages')
    .select('id, title, path, is_home, status, updated_at, published_at, seo_title, seo_description')
    .eq('site_id', siteId)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<{
    id: string;
    title: string;
    path: string;
    is_home: boolean;
    status: SitePage['status'];
    updated_at: string;
    published_at: string | null;
    seo_title: string | null;
    seo_description: string | null;
  }>(data);
}

export async function getPage(pageId: string): Promise<SitePage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('site_pages').select('*').eq('id', pageId).maybeSingle();
  if (error) throw new Error(error.message);
  return row<SitePage>(data);
}

export async function listSiteVersions(siteId: string): Promise<SiteVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_versions')
    .select('id, site_id, number, note, page_count, created_at, created_by')
    .eq('site_id', siteId)
    .order('number', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return rows<SiteVersion>(data);
}

// --- forms ------------------------------------------------------------------

export async function listForms(orgId: string): Promise<FormRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return rows<FormRow>(data);
}

/** Fields and settings only — the private notification rows need a second read. */
export async function getForm(formId: string): Promise<FormRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('forms').select('*').eq('id', formId).maybeSingle();
  if (error) throw new Error(error.message);
  return row<FormRow>(data);
}

export async function listFormSubmissions(formId: string, limit = 200) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('form_submissions')
    .select('*')
    .eq('form_id', formId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return rows<import('@/lib/types').FormSubmissionRow>(data);
}

// --- bookings ---------------------------------------------------------------

export async function listServices(orgId: string): Promise<BookingService[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_services')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<BookingService>(data);
}

export async function getService(serviceId: string): Promise<BookingService | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('booking_services').select('*').eq('id', serviceId).maybeSingle();
  if (error) throw new Error(error.message);
  return row<BookingService>(data);
}

export async function getServiceBySlug(orgId: string, slug: string): Promise<BookingService | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_services')
    .select('*')
    .eq('org_id', orgId)
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return row<BookingService>(data);
}

export async function listStaff(orgId: string): Promise<BookingStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_staff')
    .select('*')
    .eq('org_id', orgId)
    .neq('status', 'archived')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<BookingStaff>(data);
}

export async function getStaff(staffId: string): Promise<BookingStaff | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('booking_staff').select('*').eq('id', staffId).maybeSingle();
  if (error) throw new Error(error.message);
  return row<BookingStaff>(data);
}

/** Staff allowed to perform a service, in the order the booking page shows them. */
export async function staffForService(serviceId: string): Promise<BookingStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_for_service', { p_service_id: serviceId });
  if (error) throw new Error(error.message);
  return rows<BookingStaff>(data);
}

export async function listAvailability(staffId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_availability')
    .select('*')
    .eq('staff_id', staffId)
    .order('weekday', { ascending: true })
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<{ id: string; staff_id: string; weekday: number; starts_at: string; ends_at: string }>(data);
}

export async function listBreaks(availabilityId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_breaks')
    .select('*')
    .eq('availability_id', availabilityId)
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<{ id: string; availability_id: string; starts_at: string; ends_at: string; label: string | null }>(data);
}

export async function listExceptions(staffId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_exceptions')
    .select('*')
    .eq('staff_id', staffId)
    .order('day', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<import('@/lib/types').BookingException>(data);
}

export interface BookingWindow {
  from?: string;
  to?: string;
  states?: string[];
  staffId?: string;
  serviceId?: string;
  limit?: number;
}

export async function listBookings(orgId: string, window: BookingWindow = {}): Promise<Booking[]> {
  const supabase = await createClient();
  let query = supabase.from('bookings').select('*').eq('org_id', orgId);
  if (window.from) query = query.gte('starts_at', window.from);
  if (window.to) query = query.lte('starts_at', window.to);
  if (window.states?.length) query = query.in('state', window.states);
  if (window.staffId) query = query.eq('staff_id', window.staffId);
  if (window.serviceId) query = query.eq('service_id', window.serviceId);

  const { data, error } = await query.order('starts_at', window.from ? { ascending: true } : { ascending: false }).limit(window.limit ?? 100);
  if (error) throw new Error(error.message);

  const bookings = rows<Booking>(data);
  return bookings.length === 0 ? bookings : attachJoinNames(bookings);
}

/**
 * Lists show a service and staff name next to every slot. Doing that with two
 * extra keyed queries beats PostgREST's nested select here, because the rows are
 * already bound by `org_id` and we only need the two label columns.
 */
async function attachJoinNames(bookings: Booking[]): Promise<Booking[]> {
  const supabase = await createClient();
  const serviceIds = [...new Set(bookings.map((b) => b.service_id))];
  const staffIds = [...new Set(bookings.map((b) => b.staff_id))];

  const [services, staff] = await Promise.all([
    serviceIds.length
      ? supabase.from('booking_services').select('id, name, color, duration_min').in('id', serviceIds)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? supabase.from('booking_staff').select('id, name').in('id', staffIds)
      : Promise.resolve({ data: [] }),
  ]);

  const serviceMap = new Map(rows<BookingService>(services.data).map((s) => [s.id, s]));
  const staffMap = new Map(rows<BookingStaff>(staff.data).map((s) => [s.id, s]));

  return bookings.map((booking) => ({
    ...booking,
    service: serviceMap.get(booking.service_id) ?? null,
    staff: staffMap.get(booking.staff_id) ?? null,
  }));
}

export async function getBookingByCode(code: string): Promise<Booking | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('bookings').select('*').eq('code', code).maybeSingle();
  if (error) throw new Error(error.message);
  return row<Booking>(data);
}

// --- email ------------------------------------------------------------------

/**
 * Readable by an admin through RLS. The SMTP password lives in a separate table
 * with no policy at all, so it can never come back here — the form only learns
 * that one is stored, which is enough to show "stored" instead of a blank field.
 */
export async function getEmailSettings(orgId: string): Promise<(EmailSettingsRow & { has_password: boolean }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('org_email_settings').select('*').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(error.message);

  const row0 = row<EmailSettingsRow>(data);
  if (!row0) return null;

  // Exists-check only. The ciphertext never leaves this function.
  const admin = createAdminClient();
  const { data: secret } = await admin.from('org_email_passwords').select('org_id').eq('org_id', orgId).maybeSingle();

  return { ...row0, has_password: Boolean(secret) };
}

export async function recentEmailLog(orgId: string, limit = 20) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('email_log')
    .select('id, template, to_address, from_address, subject, provider, state, error, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return rows<{
    id: number;
    template: string;
    to_address: string;
    from_address: string | null;
    subject: string | null;
    provider: string;
    state: 'queued' | 'sent' | 'failed' | 'skipped';
    error: string | null;
    created_at: string;
  }>(data);
}

// --- team -------------------------------------------------------------------

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_members')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const members = rows<OrgMember>(data);
  if (members.length === 0) return members;

  // `org_members` and `user_profiles` both point at auth.users, so there is no
  // direct foreign key for PostgREST to embed through. Two keyed reads instead.
  const userIds = [...new Set(members.map((m) => m.user_id))];
  const profiles = await supabase.from('user_profiles').select('*').in('user_id', userIds);
  if (profiles.error) throw new Error(profiles.error.message);

  const byId = new Map(rows<UserProfile>(profiles.data).map((p) => [p.user_id, p]));
  return members.map((member) => {
    const profile = byId.get(member.user_id);
    return {
      ...member,
      profile: profile
        ? { display_name: profile.display_name, email: profile.email, avatar_url: profile.avatar_url, job_title: profile.job_title }
        : null,
    };
  });
}

export async function listInvites(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_invites')
    .select('*')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return rows<import('@/lib/types').OrgInvite>(data);
}

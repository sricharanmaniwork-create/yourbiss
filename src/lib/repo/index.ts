import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { OVERRIDABLE_KEYS, type StoredTemplate } from '@/lib/mail/overrides';
import type {
  ActivityEntry,
  Booking,
  BookingService,
  BookingStaff,
  EmailSettingsRow,
  FormPrivateRow,
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

/**
 * Who gets told about a response, and where it is forwarded.
 *
 * The webhook secret is deliberately not selected: `form_privates_select` already
 * limits this row to admins, but the settings screen only has to say whether one
 * is stored, so the value never needs to come back to the browser.
 */
export async function getFormPrivates(formId: string): Promise<(FormPrivateRow & { hasSecret: boolean }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('form_privates')
    .select('*')
    .eq('form_id', formId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = row<FormPrivateRow & { webhook_secret: string | null }>(data);
  if (!value) return null;
  // Exists-check only: the secret itself is dropped here and never reaches the client.
  const { webhook_secret: secret, ...rest } = value;
  return { ...rest, hasSecret: Boolean(secret) };
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

/**
 * A team member's email and phone, for the admin screen that holds them.
 *
 * `bstaff_contacts_admin` is written for owners and admins, so a member's own select
 * answers no rows rather than an error — which is exactly why this returns `null` for
 * "nothing to show" and the page reads it only after it has decided the viewer is an
 * admin. A booking page never calls it: the row is deliberately in its own table so the
 * public calendar cannot reach it.
 */
export async function getStaffContacts(staffId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_staff_contacts')
    .select('email, phone, notes')
    .eq('staff_id', staffId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data ?? null) as { email: string | null; phone: string | null; notes: string | null } | null;
  if (!value) return null;
  return { email: value.email ?? '', phone: value.phone ?? '', notes: value.notes ?? '' };
}

/** Staff allowed to perform a service, in the order the booking page shows them. */
export async function staffForService(serviceId: string): Promise<BookingStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('staff_for_service', { p_service_id: serviceId });
  if (error) throw new Error(error.message);
  return rows<BookingStaff>(data);
}

/**
 * Every staff-and-service pairing in the workspace. A service screen needs the inverse
 * of `staff_for_service` — who offers this one — and `booking_staff_services` is the
 * only place that pairing exists; reading it once beats a query per service.
 */
export async function staffServiceLinks(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_staff_services')
    .select('staff_id, service_id')
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
  return rows<{ staff_id: string; service_id: string }>(data);
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

/**
 * Every weekly window in the workspace, in one read.
 *
 * A person with no windows has a live booking page and no times to show on it, which is
 * the most common reason a calendar looks broken, and the roster needs to say so for all
 * of them at once: asking per person would be one query for every member of a thirty-
 * person team.
 */
export async function orgWeekWindows(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_availability')
    .select('id, staff_id, weekday, starts_at, ends_at')
    .eq('org_id', orgId)
    .order('staff_id', { ascending: true })
    .order('weekday', { ascending: true })
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<{ id: string; staff_id: string; weekday: number; starts_at: string; ends_at: string }>(data);
}

/**
 * Every break one person keeps, in one read.
 *
 * `booking_breaks` carries `staff_id` as well as `availability_id`, so the hours screen
 * groups them itself instead of asking per window — which would be one query for every
 * window on a full seven-day, four-windows-a-day calendar.
 */
export async function listStaffBreaks(staffId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_breaks')
    .select('id, availability_id, starts_at, ends_at')
    .eq('staff_id', staffId)
    .order('starts_at', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<{ id: string; availability_id: string; starts_at: string; ends_at: string }>(data);
}

/**
 * Workspace-wide closures — festivals and blackouts that apply to every team member.
 * There is no `id` to select: the primary key is the (org, day) pair.
 */
export async function listClosedDays(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_closed_days')
    .select('day, reason, created_at')
    .eq('org_id', orgId)
    .order('day', { ascending: true });
  if (error) throw new Error(error.message);
  return rows<{ day: string; reason: string | null; created_at: string }>(data);
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

/**
 * Every day override in the workspace, in one read.
 *
 * The availability screen has to answer "why is nobody free on the 14th", and an override
 * is the usual reason — so it needs the whole team's list at once. Reading it per person
 * would be one query for every member and would still show the same rows.
 */
export async function orgExceptions(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('booking_exceptions')
    .select('id, staff_id, day, kind, starts_at, ends_at, reason')
    .eq('org_id', orgId)
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
  search?: string;
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
  if (window.search) {
    // `or=` is a grammar of its own: commas and parentheses would open extra conditions,
    // so a typed term is reduced to characters that cannot do that before it is quoted.
    const term = window.search.replace(/[^A-Za-z0-9 @._+-]/g, '');
    if (term !== '') {
      query = query.or(
        `code.ilike."%${term}%",customer_email.ilike."%${term}%",customer_name.ilike."%${term}%"`,
      );
    }
  }

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

/**
 * A workspace's own wording, where it has written any.
 *
 * The absence of a key is the answer "use ours" — migration 0006 says so in its own comment,
 * and this is the read that makes good on it.
 */
export async function listEmailTemplates(orgId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('email_templates')
    .select('key, subject, html_body, text_body, enabled, updated_at')
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);

  return rows<StoredTemplate>(data).filter((template) => OVERRIDABLE_KEYS.has(template.key));
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

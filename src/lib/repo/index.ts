import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { OVERRIDABLE_KEYS, type StoredTemplate } from '@/lib/mail/overrides';
import type {
  ActivityEntry,
  Booking,
  BookingService,
  BookingStaff,
  CrmActivity,
  CrmContact,
  CrmDeal,
  CrmLead,
  CrmLeadStatus,
  CrmStage,
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

// --- crm --------------------------------------------------------------------

/**
 * The four CRM lists all filter the same way, and none of them needs a join to do
 * it: `owner_id` points at auth.users, which has no direct link to user_profiles,
 * so the names come back in one keyed read after the page of rows is known — the
 * same two-step `listMembers` uses.
 */
async function attachOwners<T extends { owner_id: string | null }>(items: T[]): Promise<(T & { owner: OwnerName | null })[]> {
  if (items.length === 0) return [];
  const supabase = await createClient();
  const userIds = [...new Set(items.map((item) => item.owner_id).filter((id): id is string => !!id))];
  if (userIds.length === 0) return items.map((item) => ({ ...item, owner: null }));

  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, email, avatar_url')
    .in('user_id', userIds);
  if (error) throw new Error(error.message);

  const byId = new Map(
    rows<{ user_id: string; display_name: string; email: string; avatar_url: string | null }>(data).map((p) => [p.user_id, p]),
  );
  return items.map((item) => ({ ...item, owner: (item.owner_id ? byId.get(item.owner_id) ?? null : null) ?? null }));
}

type OwnerName = Pick<UserProfile, 'display_name' | 'email' | 'avatar_url'>;

/** The eleven numbers `youbiss.crm_counts` answers in one round trip. */
export interface CrmCounts {
  stages: number;
  contacts: number;
  leads_open: number;
  leads_new: number;
  leads_7d: number;
  converted_30d: number;
  deals_open: number;
  deals_value: number;
  won_30d: number;
  won_30d_value: number;
  lost_30d: number;
  tasks_open: number;
  tasks_overdue: number;
}

export async function crmCounts(orgId: string): Promise<CrmCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('crm_counts', { p_org_id: orgId });
  if (error) throw new Error(error.message);
  return (data ?? {}) as CrmCounts;
}

/**
 * Stages plus what sits on each, in one pair of reads. The board and the pipeline
 * screen both need the totals, and counting the deal rows here beats a second
 * grouped query per column.
 */
export async function listCrmStages(orgId: string): Promise<CrmStage[]> {
  const supabase = await createClient();
  const [stagesResult, dealsResult] = await Promise.all([
    supabase.from('crm_stages').select('*').eq('org_id', orgId).order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('crm_deals').select('stage_id, amount, won_at, lost_at').eq('org_id', orgId),
  ]);
  if (stagesResult.error) throw new Error(stagesResult.error.message);
  if (dealsResult.error) throw new Error(dealsResult.error.message);

  const stages = rows<CrmStage>(stagesResult.data);
  // The two closing stages always sit at the right end of a funnel, whatever
  // number they happen to hold: a board with "Won" between two open columns is
  // the position column being read as more than the label it is.
  const rank = (stage: CrmStage) => (stage.kind === 'open' ? 0 : stage.kind === 'won' ? 1 : 2);
  stages.sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.created_at.localeCompare(b.created_at));

  const counts = new Map<string, { deal_count: number; deal_value: number }>();
  for (const deal of rows<{ stage_id: string; amount: number; won_at: string | null; lost_at: string | null }>(dealsResult.data)) {
    const entry = counts.get(deal.stage_id) ?? { deal_count: 0, deal_value: 0 };
    entry.deal_count += 1;
    entry.deal_value += Number(deal.amount) || 0;
    counts.set(deal.stage_id, entry);
  }
  return stages.map((stage) => ({ ...stage, deal_count: counts.get(stage.id)?.deal_count ?? 0, deal_value: counts.get(stage.id)?.deal_value ?? 0 }));
}

export async function getCrmStage(stageId: string): Promise<CrmStage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('crm_stages').select('*').eq('id', stageId).maybeSingle();
  if (error) throw new Error(error.message);
  return row<CrmStage>(data);
}

export interface CrmListOptions {
  search?: string;
  ownerId?: string;
  limit?: number;
}

/** Same grammar as the bookings search: a typed term is reduced before it is quoted. */
function searchFilter(search?: string) {
  if (!search) return null;
  const term = search.replace(/[^A-Za-z0-9 @._+-]/g, '');
  return term === '' ? null : term;
}

export async function listCrmLeads(
  orgId: string,
  options: CrmListOptions & { statuses?: CrmLeadStatus[] } = {},
): Promise<(CrmLead & { owner: OwnerName | null })[]> {
  const supabase = await createClient();
  let query = supabase.from('crm_leads').select('*').eq('org_id', orgId);
  if (options.statuses?.length) query = query.in('status', options.statuses);
  if (options.ownerId) query = query.eq('owner_id', options.ownerId);
  const term = searchFilter(options.search);
  if (term) query = query.or(`name.ilike."%${term}%",email.ilike."%${term}%",company.ilike."%${term}%"`);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(options.limit ?? 200);
  if (error) throw new Error(error.message);
  return attachOwners(rows<CrmLead>(data));
}

export async function getCrmLead(leadId: string): Promise<(CrmLead & { owner: OwnerName | null }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('crm_leads').select('*').eq('id', leadId).maybeSingle();
  if (error) throw new Error(error.message);
  const lead = row<CrmLead>(data);
  if (!lead) return null;
  return (await attachOwners([lead]))[0] ?? null;
}

export async function listCrmContacts(
  orgId: string,
  options: CrmListOptions = {},
): Promise<(CrmContact & { owner: OwnerName | null })[]> {
  const supabase = await createClient();
  let query = supabase.from('crm_contacts').select('*').eq('org_id', orgId);
  if (options.ownerId) query = query.eq('owner_id', options.ownerId);
  const term = searchFilter(options.search);
  if (term) query = query.or(`name.ilike."%${term}%",email.ilike."%${term}%",company.ilike."%${term}%"`);

  const { data, error } = await query.order('lower(name)').order('created_at', { ascending: false }).limit(options.limit ?? 300);
  if (error) throw new Error(error.message);
  return attachOwners(rows<CrmContact>(data));
}

/** The tags actually in use, most-used first, so a filter offers real choices. */
export async function listCrmTags(orgId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('crm_contacts').select('tags').eq('org_id', orgId);
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const entry of rows<{ tags: string[] | null }>(data)) {
    for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

export async function getCrmContact(contactId: string): Promise<(CrmContact & { owner: OwnerName | null }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('crm_contacts').select('*').eq('id', contactId).maybeSingle();
  if (error) throw new Error(error.message);
  const contact = row<CrmContact>(data);
  if (!contact) return null;
  return (await attachOwners([contact]))[0] ?? null;
}

export async function listCrmDeals(
  orgId: string,
  options: CrmListOptions & { stageId?: string; openOnly?: boolean } = {},
): Promise<CrmDeal[]> {
  const supabase = await createClient();
  let query = supabase.from('crm_deals').select('*').eq('org_id', orgId);
  if (options.stageId) query = query.eq('stage_id', options.stageId);
  if (options.ownerId) query = query.eq('owner_id', options.ownerId);
  const term = searchFilter(options.search);
  if (term) query = query.or(`title.ilike."%${term}%"`);
  if (options.openOnly) query = query.is('won_at', null).is('lost_at', null);

  const { data, error } = await query.order('updated_at', { ascending: false }).limit(options.limit ?? 300);
  if (error) throw new Error(error.message);

  const deals = rows<CrmDeal>(data);
  if (deals.length === 0) return deals;

  const stageIds = [...new Set(deals.map((deal) => deal.stage_id))];
  const contactIds = [...new Set(deals.map((deal) => deal.contact_id).filter((id): id is string => !!id))];
  const [stagesResult, contactsResult, owners] = await Promise.all([
    supabase.from('crm_stages').select('id, name, kind, color, position').in('id', stageIds),
    contactIds.length
      ? supabase.from('crm_contacts').select('id, name, company').in('id', contactIds)
      : Promise.resolve({ data: [] }),
    attachOwners(deals),
  ]);
  if (stagesResult.error) throw new Error(stagesResult.error.message);

  const stageMap = new Map(rows<CrmStage>(stagesResult.data).map((stage) => [stage.id, stage]));
  const contactMap = new Map(rows<Pick<CrmContact, 'id' | 'name' | 'company'>>(contactsResult.data).map((c) => [c.id, c]));

  return owners.map((deal) => ({
    ...deal,
    stage: stageMap.get(deal.stage_id) ?? null,
    contact: (deal.contact_id ? contactMap.get(deal.contact_id) ?? null : null) ?? null,
  }));
}

export async function getCrmDeal(dealId: string): Promise<CrmDeal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('crm_deals').select('*').eq('id', dealId).maybeSingle();
  if (error) throw new Error(error.message);
  const deal = row<CrmDeal>(data);
  if (!deal) return null;

  const [withOwner] = await attachOwners([deal]);
  const base: CrmDeal & { owner: OwnerName | null } = withOwner ?? { ...deal, owner: null };
  const [stage, contact, lead] = await Promise.all([
    getCrmStage(deal.stage_id),
    deal.contact_id ? getCrmContact(deal.contact_id) : Promise.resolve(null),
    deal.lead_id ? getCrmLead(deal.lead_id) : Promise.resolve(null),
  ]);
  return {
    ...base,
    stage: stage ? { name: stage.name, kind: stage.kind, color: stage.color, position: stage.position } : null,
    contact: contact ? { name: contact.name, company: contact.company } : null,
    lead: lead ? { name: lead.name, company: lead.company } : null,
  };
}

/** The history of one record. A target is required: an activity belongs to somebody. */
export async function listCrmActivities(
  orgId: string,
  target: { contactId?: string; leadId?: string; dealId?: string },
  limit = 60,
): Promise<CrmActivity[]> {
  const supabase = await createClient();
  const column = target.contactId ? 'contact_id' : target.dealId ? 'deal_id' : 'lead_id';
  const value = target.contactId ?? target.dealId ?? target.leadId;
  if (!value) return [];

  const { data, error } = await supabase
    .from('crm_activities')
    .select('*')
    .eq('org_id', orgId)
    .eq(column, value)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const activities = rows<CrmActivity>(data);
  if (activities.length === 0) return activities;

  const userIds = [...new Set([...activities.map((a) => a.owner_id), ...activities.map((a) => a.created_by)].filter((id): id is string => !!id))];
  const profiles = userIds.length
    ? await supabase.from('user_profiles').select('user_id, display_name, email, avatar_url').in('user_id', userIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(profiles.error.message);

  const byId = new Map(rows<UserProfile>(profiles.data).map((p) => [p.user_id, p]));
  const name = (id: string | null): OwnerName | null => (id ? byId.get(id) ?? null : null);
  return activities.map((activity) => ({ ...activity, owner: name(activity.owner_id), author: name(activity.created_by) }));
}

/** Open tasks for the hub and the dashboard, soonest due first. */
export async function listCrmTasks(orgId: string, options: { includeDone?: boolean; limit?: number } = {}) {
  const supabase = await createClient();
  let query = supabase.from('crm_activities').select('*').eq('org_id', orgId).eq('kind', 'task');
  if (!options.includeDone) query = query.is('done_at', null);

  const { data, error } = await query.order('due_at', { ascending: true, nullsFirst: false }).limit(options.limit ?? 25);
  if (error) throw new Error(error.message);

  const tasks = rows<CrmActivity>(data);
  if (tasks.length === 0) return [];
  return attachOwners(tasks);
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

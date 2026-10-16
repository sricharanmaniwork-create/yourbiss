import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/workspace';
import {
  getStaff,
  getStaffContacts,
  listExceptions,
  listServices,
  listStaffBreaks,
  listAvailability,
  staffServiceLinks,
} from '@/lib/repo';
import { timeZoneList } from '@/lib/timezones';
import { dateInZone } from '@/lib/utils';
import { StaffOverview } from '@/components/bookings/staff-overview';
import type { AssignedService, StaffDocument, WeekWindowDoc } from '@/components/bookings/types-client';

/**
 * One team member, read through the member's own session.
 *
 * Two things are decided here rather than in the interface. The contact row is only read
 * for an owner or admin, because `bstaff_contacts_admin` answers a member's select with
 * nothing and an empty form would look like an unedited person; and the hours are grouped
 * into windows with their breaks so the editor holds what the columns hold — a day may
 * carry more than one window, and collapsing them would quietly delete the second one on
 * the next save.
 */
export const dynamic = 'force-dynamic';

interface Params {
  staffId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { staffId } = await params;
  const staff = await getStaff(staffId);
  return { title: staff ? `Bookings — ${staff.name}` : 'Bookings' };
}

export default async function StaffOverviewRoute({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ panel?: string }>;
}) {
  const { staffId } = await params;
  const query = await searchParams;
  const workspace = await requireWorkspace();

  const person = await getStaff(staffId);
  if (!person || person.org_id !== workspace.org.id || person.status === 'archived') notFound();

  // The availability screen links straight at a panel, so the query decides where the
  // page opens; anything else lands on the profile as it always has.
  const initialPanel =
    query.panel === 'hours' || query.panel === 'days' || query.panel === 'profile' ? query.panel : undefined;

  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const zones = timeZoneList();

  const [services, links, availability, breaks, exceptions, contacts] = await Promise.all([
    listServices(workspace.org.id),
    staffServiceLinks(workspace.org.id),
    listAvailability(person.id),
    listStaffBreaks(person.id),
    listExceptions(person.id),
    canAdmin ? getStaffContacts(person.id) : Promise.resolve(null),
  ]);

  const myServices = new Set(links.filter((link) => link.staff_id === person.id).map((link) => link.service_id));

  const byWindow = new Map<string, { starts_at: string; ends_at: string }[]>();
  for (const brake of breaks) {
    const list = byWindow.get(brake.availability_id) ?? [];
    list.push({ starts_at: brake.starts_at, ends_at: brake.ends_at });
    byWindow.set(brake.availability_id, list);
  }

  const windows: WeekWindowDoc[] = availability.map((window) => ({
    weekday: window.weekday,
    starts_at: window.starts_at,
    ends_at: window.ends_at,
    breaks: byWindow.get(window.id) ?? [],
  }));

  const document: StaffDocument = {
    id: person.id,
    name: person.name,
    slug: String(person.slug ?? ''),
    bio: person.bio ?? '',
    avatar_url: person.avatar_url ?? '',
    // A zone the runtime does not know would make every Intl call on the page throw.
    timezone: zones.includes(person.timezone) ? person.timezone : workspace.org.timezone,
    status: person.status,
    sort_order: person.sort_order,
    user_id: person.user_id,
    service_ids: [...myServices],
    contacts,
  };

  const assigned: AssignedService[] = services
    // A hidden service is still assignable: it comes back on the booking page with its
    // team intact, and a person's assignments should not evaporate while it is off.
    .filter((service) => service.status !== 'archived')
    .map((service) => ({
      id: service.id,
      name: service.name,
      slug: String(service.slug ?? ''),
      color: /^#[0-9A-Fa-f]{6}$/.test(service.color) ? service.color : '#2E6BE6',
      duration_min: Number.isInteger(service.duration_min) ? service.duration_min : 60,
    }));

  return (
    <StaffOverview
      staff={document}
      services={assigned}
      timezones={zones}
      windows={windows}
      exceptions={exceptions}
      // Read in the person's own clock: the page asks which of their days are off, and
      // that is decided by the zone their hours are written in.
      today={dateInZone(new Date(), document.timezone)}
      initialPanel={initialPanel}
      canManage={workspace.apps.bookings === true}
      canAdmin={canAdmin}
    />
  );
}

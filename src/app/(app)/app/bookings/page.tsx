import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleAlert,
  ListChecks,
  Users,
} from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listBookings, listClosedDays, listServices, listStaff, orgWeekWindows, staffServiceLinks } from '@/lib/repo';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { addDays, clockInZone, dateInZone, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Bookings' };

/**
 * The Bookings hub: what is coming, and what still stops a customer booking anything.
 *
 * The second half matters more than the first. A booking page answers with an empty
 * calendar for exactly four reasons — no active service, nobody assigned to it, no weekly
 * hours, or the workspace closed — and each is a different screen to fix. This page checks
 * all four against the same tables the engine reads and names the one that applies, so
 * "the calendar is broken" arrives here as a sentence with a link in it.
 *
 * Counts are read once each, not derived from the client: `booking_staff_services` and the
 * weekly windows are two whole-workspace reads, which is what a roster of any size needs.
 */
export default async function BookingsHomePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const today = dateInZone(new Date(), zone);
  const now = new Date().toISOString();

  const canBuild = workspace.apps.bookings === true;

  const [services, staff, links, windows, closedDays, upcoming, week] = await Promise.all([
    listServices(orgId),
    listStaff(orgId),
    staffServiceLinks(orgId),
    orgWeekWindows(orgId),
    listClosedDays(orgId),
    listBookings(orgId, { from: now, states: ['pending', 'confirmed'], limit: 7 }),
    listBookings(orgId, { from: now, to: `${addDays(today, 7)}T23:59:59Z`, states: ['pending', 'confirmed'], limit: 200 }),
  ]);

  const liveServices = services.filter((service) => service.status === 'active');
  const bookableStaff = staff.filter((person) => person.status === 'active');
  const daysWithHours = new Set(windows.map((window) => window.staff_id));
  const servicesAssigned = new Set(links.map((link) => link.staff_id));
  const closedAhead = closedDays.filter((entry) => entry.day >= today);

  const idle = bookableStaff.filter((person) => !servicesAssigned.has(person.id) || !daysWithHours.has(person.id));

  const blockers: { title: string; body: string; href: string; label: string }[] = [];
  if (liveServices.length === 0) {
    blockers.push({
      title: 'No service is bookable',
      body:
        services.length === 0
          ? 'A service is what a customer picks: a name, a length, and the people who perform it. Nothing can be booked until one exists.'
          : `${services.length} service${services.length === 1 ? '' : 's'} exist${services.length === 1 ? 's' : ''} but none is active, so every booking page answers that it is not open.`,
      href: '/app/bookings/services/new',
      label: 'Add a service',
    });
  }
  if (bookableStaff.length === 0) {
    blockers.push({
      title: 'Nobody takes bookings',
      body: 'A booking is always with someone. Add the first team member and give them their working hours.',
      href: '/app/bookings/staff/new',
      label: 'Add a team member',
    });
  }
  if (idle.length > 0) {
    blockers.push({
      title: `${idle.length} team member${idle.length === 1 ? '' : 's'} cannot be booked with`,
      body: 'They are active but either offer no service or keep no weekly hours, so their calendar page opens with no times.',
      href: '/app/bookings/staff',
      label: 'Open the team',
    });
  }
  if (closedAhead.length > 0) {
    blockers.push({
      title: `${closedAhead.length} date${closedAhead.length === 1 ? '' : 's'} closed to everyone`,
      body: 'A workspace closure stops every booking page on that date, whoever’s week says otherwise. Remove one if the calendar looks wrong on a specific day.',
      href: '/app/bookings/availability',
      label: 'Open availability',
    });
  }

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Services, the team who performs them, their working hours, and the appointments customers made on the page that comes out of all three."
        actions={
          canBuild ? (
            <ButtonLink href="/app/bookings/appointments/new" variant="primary">
              <CalendarPlus size={15} />
              New appointment
            </ButtonLink>
          ) : undefined
        }
      />

      {!canBuild && (
        <p className="mb-4 max-w-[760px] rounded-md border border-[#f3ddb0] bg-[#fdf3e0] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#8a5300]">
          The Bookings app is switched off for this workspace. Everything here can still be read, and a page already
          shared stops answering until it is turned back on in Settings.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<CalendarDays size={16} />}
          label="Services"
          value={`${liveServices.length} bookable`}
          detail={`${services.length} in this workspace`}
          href="/app/bookings/services"
        />
        <Stat
          icon={<Users size={16} />}
          label="Team"
          value={`${bookableStaff.length} taking bookings`}
          detail={`${staff.length} listed`}
          href="/app/bookings/staff"
        />
        <Stat
          icon={<CalendarClock size={16} />}
          label="Next seven days"
          value={`${week.length} appointment${week.length === 1 ? '' : 's'}`}
          detail={`on the ${zone.replace(/_/g, ' ')} clock`}
          href="/app/bookings/calendar"
        />
        <Stat
          icon={<ListChecks size={16} />}
          label="Awaiting confirmation"
          value={String(week.filter((booking) => booking.state === 'pending').length)}
          detail="a member confirms, an owner or admin marks the rest"
          href="/app/bookings/appointments?state=pending"
        />
      </div>

      {blockers.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="What still stops a customer booking"
            description="Checked against the same tables the booking engine reads: the service, who offers it, the hours they keep, and the dates the workspace is shut."
          />
          <CardBody className="grid gap-2">
            {blockers.map((blocker) => (
              <div key={blocker.title} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-line bg-raised px-3 py-2.5">
                <CircleAlert size={15} className="mt-0.5 flex-none text-warning" />
                <span className="min-w-[220px] flex-1">
                  <span className="block text-[13px] font-medium text-ink">{blocker.title}</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-soft">{blocker.body}</span>
                </span>
                <Link
                  href={blocker.href}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:text-brand-dark"
                >
                  {blocker.label}
                  <ArrowRight size={13} />
                </Link>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader
          title="Coming up"
          description="The next seven appointments on this workspace’s diary, soonest first."
          action={
            <ButtonLink href="/app/bookings/calendar" size="sm">
              Open the calendar
            </ButtonLink>
          }
        />
        <CardBody className="p-0">
          {upcoming.length === 0 ? (
            <div className="px-4 py-4">
              <EmptyState
                icon={<CalendarClock size={22} />}
                title="Nothing on the diary yet"
                description="A booking appears the moment a customer finishes a booking page, or when the team records one for someone on the phone. Share the page address, or embed it on a published site with the Booking block."
                action={
                  <ButtonLink href="/app/bookings/services" size="sm">
                    Check the services
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((booking) => (
                <li key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
                  <span className="w-[168px] flex-none">
                    <span className="block text-[12.5px] font-medium text-ink">
                      {formatDateInZone(booking.starts_at, zone)}
                    </span>
                    <span className="block font-mono text-[11.5px] text-ink-soft">
                      {clockInZone(booking.starts_at, zone)} – {clockInZone(booking.ends_at, zone)}
                    </span>
                  </span>
                  <span className="min-w-[180px] flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{booking.customer_name}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {booking.service?.name ?? 'Removed service'} · {booking.staff?.name ?? 'Removed team member'}
                    </span>
                  </span>
                  <StatusBadge state={booking.state} />
                  <Link
                    href={`/app/bookings/appointments?q=${encodeURIComponent(booking.code)}`}
                    className="font-mono text-[11.5px] text-muted underline decoration-line hover:text-brand"
                  >
                    {booking.code}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          title="Booking pages"
          body={`The address a customer uses is /book/${workspace.org.slug}/‹service›, and every one of the ${liveServices.length} active service${liveServices.length === 1 ? '' : 's'} has one.`}
          href="/app/bookings/services"
          badge={<Badge tone="neutral">Services</Badge>}
        />
        <Tile
          title="Working hours"
          body={`${daysWithHours.size} of ${staff.length} team member${staff.length === 1 ? '' : 's'} keep a weekly grid, and a day can be added or taken off on top of it.`}
          href="/app/bookings/availability"
          badge={<Badge tone="neutral">Availability</Badge>}
        />
        <Tile
          title="All appointments"
          body="Filter by reference, customer, state, service or person, confirm or move one, and keep a note only this workspace reads."
          href="/app/bookings/appointments"
          badge={<Badge tone="neutral">Appointments</Badge>}
        />
      </div>

      <p className="mt-4 max-w-[760px] text-[12.5px] leading-relaxed text-muted">
        Embedding a page on a site you publish here is done with the Booking block, which loads the same page in an
        iframe on your own domain — no third-party frame, and the letters go out from this workspace’s own sender.
      </p>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="ui-card block px-4 py-3.5 transition-colors hover:bg-raised">
      <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-[17px] font-semibold text-ink">{value}</p>
      <p className="mt-1 truncate text-[11.5px] text-muted">{detail}</p>
    </Link>
  );
}

function Tile({ title, body, href, badge }: { title: string; body: string; href: string; badge: React.ReactNode }) {
  return (
    <Link href={href} className="ui-card block px-4 py-3.5 transition-colors hover:bg-raised">
      <p className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        {badge}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
    </Link>
  );
}

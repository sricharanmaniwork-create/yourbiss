import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listBookings, listClosedDays, listServices, listStaff } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { addDays, clockInZone, dateInZone, formatDateInZone, weekdayOf } from '@/lib/utils';
import { BOOKING_SOURCE_LABELS } from '@/components/bookings/types-client';
import { weekdayLabel } from '@/lib/bookings/types';
import type { Booking } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Booking calendar' };

/** A fortnight at a time — the same stretch the customer's slot picker pages through. */
const SPAN = 14;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A working fortnight rarely holds more than this for one workspace, and a page that
 * silently truncated would look like appointments went missing. When it does fill up, the
 * screen says so instead of hiding the rest.
 */
const ROW_LIMIT = 200;

/**
 * The team's diary: what is already booked, day by day, on one clock.
 *
 * Every time here is read in the workspace zone. A booking row carries the zone it was made
 * or moved in, because `reschedule_booking` writes it, so a person checking their own day
 * could otherwise read someone else's 09:00 as their 09:30 — the row's own zone is printed
 * beside the time whenever the two differ.
 *
 * Filters are links, not controls: the same address renders the same diary, so a calendar
 * view can be pasted into a message. It reads through the member's own session, so a row
 * this RLS policies withhold is a row that never reaches the page.
 */
export default async function BookingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; staff?: string; service?: string; scope?: string }>;
}) {
  const workspace = await requireWorkspace();
  const query = await searchParams;
  const zone = workspace.org.timezone;
  const today = dateInZone(new Date(), zone);

  const rawFrom = typeof query.from === 'string' && DATE_RE.test(query.from) ? query.from : today;
  // A hand-edited address should not be able to page through a century of rows.
  const from = rawFrom < addDays(today, -SPAN * 26) ? addDays(today, -SPAN * 26) : rawFrom > addDays(today, SPAN * 26) ? addDays(today, SPAN * 26) : rawFrom;
  const lastDay = addDays(from, SPAN - 1);

  const showAll = query.scope === 'all';
  const [services, staff, closedDays] = await Promise.all([
    listServices(workspace.org.id),
    listStaff(workspace.org.id),
    listClosedDays(workspace.org.id),
  ]);

  const bookings = await listBookings(workspace.org.id, {
    // ±1 day of slack in UTC: the bounds are instants, the span is a stretch of days on
    // the workspace clock, and the grouping below keeps only what truly falls inside.
    from: `${addDays(from, -1)}T00:00:00Z`,
    to: `${addDays(lastDay, 1)}T23:59:59Z`,
    states: showAll ? undefined : ['pending', 'confirmed'],
    staffId: query.staff,
    serviceId: query.service,
    limit: ROW_LIMIT,
  });

  const inSpan = bookings.filter((booking) => {
    const day = dateInZone(new Date(booking.starts_at), zone);
    return day >= from && day <= lastDay;
  });
  const truncated = bookings.length >= ROW_LIMIT;

  const byDay = new Map<string, Booking[]>();
  for (const booking of inSpan) {
    const day = dateInZone(new Date(booking.starts_at), zone);
    const list = byDay.get(day) ?? [];
    list.push(booking);
    byDay.set(day, list);
  }

  const closedOn = new Map(closedDays.map((entry) => [entry.day, entry.reason]));
  const staffName = new Map(staff.map((person) => [person.id, person.name]));
  const serviceName = new Map(services.map((service) => [service.id, service.name]));

  const activeService = services.find((service) => service.id === query.service) ?? null;
  const activeStaff = staff.find((person) => person.id === query.staff) ?? null;

  const href = (change: { from?: string; staff?: string | null; service?: string | null; scope?: string | null }) => {
    const params = new URLSearchParams();
    const nextFrom = change.from ?? from;
    if (nextFrom !== today) params.set('from', nextFrom);
    const nextStaff = 'staff' in change ? change.staff : query.staff;
    if (nextStaff) params.set('staff', nextStaff);
    const nextService = 'service' in change ? change.service : query.service;
    if (nextService) params.set('service', nextService);
    const nextScope = 'scope' in change ? change.scope : showAll ? 'all' : null;
    if (nextScope) params.set('scope', nextScope);
    const search = params.toString();
    return search ? `/app/bookings/calendar?${search}` : '/app/bookings/calendar';
  };

  const days = Array.from({ length: SPAN }, (_, index) => addDays(from, index));
  const booked = inSpan.length;

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings', label: 'Bookings' }}
        title="Calendar"
        description={`The next fortnight on one clock: every time here is read in ${zone.replace(/_/g, ' ')}, the zone this workspace bills in.`}
        actions={
          workspace.apps.bookings === true ? (
            <ButtonLink href="/app/bookings/appointments/new" variant="primary">
              <CalendarDays size={15} />
              New appointment
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <ButtonLink href={href({ from: addDays(from, -SPAN) })} size="sm">
            <ChevronLeft size={14} />
            Previous
          </ButtonLink>
          <ButtonLink href={href({ from: today })} size="sm">
            Today
          </ButtonLink>
          <ButtonLink href={href({ from: addDays(from, SPAN) })} size="sm">
            Next
            <ChevronRight size={14} />
          </ButtonLink>
        </div>
        <span className="text-[12.5px] text-muted">
          {formatDateInZone(`${from}T12:00:00Z`, 'UTC')} – {formatDateInZone(`${lastDay}T12:00:00Z`, 'UTC')}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <ButtonLink href={href({ scope: showAll ? null : 'all' })} size="sm">
            {showAll ? 'Only what is coming up' : 'Include past and cancelled'}
          </ButtonLink>
        </span>
      </div>

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Service</span>
          <Chip on={!activeService} href={href({ service: null })}>
            All
          </Chip>
          {services.slice(0, 12).map((service) => (
            <Chip key={service.id} on={service.id === query.service} href={href({ service: service.id })}>
              {service.name}
            </Chip>
          ))}
        </CardBody>
        <CardBody className="flex flex-wrap items-center gap-1.5 border-t border-line">
          <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Team</span>
          <Chip on={!activeStaff} href={href({ staff: null })}>
            Everyone
          </Chip>
          {staff.slice(0, 12).map((person) => (
            <Chip key={person.id} on={person.id === query.staff} href={href({ staff: person.id })}>
              {person.name}
            </Chip>
          ))}
        </CardBody>
      </Card>

      {truncated && (
        <p className="mb-3 rounded-md border border-[#f3ddb0] bg-[#fdf3e0] px-3 py-2 text-[12.5px] leading-relaxed text-[#8a5300]">
          This stretch holds more than {ROW_LIMIT} appointments, so the oldest ones after that are not listed. Narrow it
          with a service or a team member, or page to the next fortnight.
        </p>
      )}

      {booked === 0 && (
        <div className="ui-card">
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="Nothing on these days"
            description={
              showAll
                ? 'No appointment — booked, cancelled or completed — falls in this fortnight for the filter you picked.'
                : 'No pending or confirmed appointment falls in this fortnight for the filter you picked. A booking page only answers once a service is active, someone offers it, and their week has hours.'
            }
            action={
              <ButtonLink href={href({ scope: 'all', staff: null, service: null })} size="sm">
                Show every appointment
              </ButtonLink>
            }
          />
        </div>
      )}

      <div className="grid gap-2.5">
        {days.map((day) => {
          const list = (byDay.get(day) ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
          if (list.length === 0 && day < today) return null;
          const closure = closedOn.get(day);
          return (
            <div key={day} className="ui-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="text-[12.5px] font-semibold text-ink">{weekdayLabel(weekdayOf(day))}</span>
                <span className="text-[12px] text-muted">{formatDateInZone(`${day}T12:00:00Z`, 'UTC')}</span>
                {day === today && <Badge tone="brand">Today</Badge>}
                {closure !== undefined && (
                  <Badge tone="danger" dot>
                    Workspace closed{closure ? ` · ${closure}` : ''}
                  </Badge>
                )}
                <span className="ml-auto text-[11.5px] text-muted">
                  {list.length === 0 ? 'Nothing booked' : `${list.length} appointment${list.length === 1 ? '' : 's'}`}
                </span>
              </div>

              {list.length > 0 && (
                <ul className="divide-y divide-line">
                  {list.map((booking) => (
                    <li key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
                      <span className="w-[130px] flex-none font-mono text-[12.5px] text-ink">
                        {clockInZone(booking.starts_at, zone)}
                        <span className="text-muted"> – </span>
                        {clockInZone(booking.ends_at, zone)}
                      </span>
                      <span className="min-w-[150px] flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{booking.customer_name}</span>
                        <span className="block truncate text-[11.5px] text-muted">
                          {serviceName.get(booking.service_id) ?? booking.service?.name ?? 'Removed service'}
                          {' · '}
                          {staffName.get(booking.staff_id) ?? booking.staff?.name ?? 'Removed team member'}
                        </span>
                      </span>
                      {booking.timezone !== zone && (
                        <span className="font-mono text-[11px] text-muted" title="This booking is written in its own zone">
                          {clockInZone(booking.starts_at, booking.timezone)} {booking.timezone.split('/').pop()?.replace(/_/g, ' ')}
                        </span>
                      )}
                      <StatusBadge state={booking.state} />
                      <Badge tone="neutral">{BOOKING_SOURCE_LABELS[booking.source] ?? booking.source}</Badge>
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
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex max-w-[720px] items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
        <Lock size={13} className="mt-[3px] flex-none" />
        This is a reading of the diary, not the thing that changes it. Moving or cancelling an appointment is done on the
        row itself in the appointments list, where the database re-checks the hour before it accepts the new one.
      </p>
    </>
  );
}

function Chip({ on, href, children }: { on: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={
        on
          ? 'rounded-full border border-brand bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand-dark'
          : 'rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft hover:border-line-strong hover:bg-raised'
      }
    >
      {children}
    </Link>
  );
}

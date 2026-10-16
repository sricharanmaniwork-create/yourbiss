import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarOff, Users } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listClosedDays, listStaff, orgExceptions, orgWeekWindows } from '@/lib/repo';
import { ClosedDaysCard } from '@/components/bookings/closed-days-card';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { WEEKDAY_ORDER, toInputTime, weekdayLabel } from '@/lib/bookings/types';
import { dateInZone, formatDateInZone, weekdayOf } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Booking availability' };

/**
 * When the team can be booked, in the three layers the engine reads.
 *
 * `bookable_days()` decides a date in a fixed order: the workspace is closed, then the
 * person's own override for that date, then their weekly hours. This screen shows the same
 * three layers in the same order and nothing else, because every "why is that day empty"
 * question is answered by one of them — and a fourth place to look would be a fourth place
 * to be wrong.
 *
 * It is read-only apart from the closures. Weekly hours and per-person days belong to the
 * team member who owns them, so those rows link to their editor instead of duplicating it.
 */
export default async function BookingAvailabilityPage() {
  const workspace = await requireWorkspace();
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const [staff, windows, exceptions, closedDays] = await Promise.all([
    listStaff(workspace.org.id),
    orgWeekWindows(workspace.org.id),
    orgExceptions(workspace.org.id),
    listClosedDays(workspace.org.id),
  ]);

  // Which date is "today" for the filter is a workspace question, not a person's: this page
  // lists closures and overrides for the whole business, and its own dates are read on the
  // clock the billing address sits on.
  const today = dateInZone(new Date(), workspace.org.timezone);
  const nameById = new Map(staff.map((person) => [person.id, person.name]));

  const week = new Map<string, Map<number, string[]>>();
  for (const window of windows) {
    const perPerson = week.get(window.staff_id) ?? new Map<number, string[]>();
    const ranges = perPerson.get(window.weekday) ?? [];
    ranges.push(`${toInputTime(window.starts_at)}–${toInputTime(window.ends_at)}`);
    perPerson.set(window.weekday, ranges);
    week.set(window.staff_id, perPerson);
  }

  const upcoming = exceptions.filter((entry) => entry.day >= today);
  const past = exceptions.length - upcoming.length;

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings', label: 'Bookings' }}
        title="Availability"
        description="A date is bookable when the workspace is open, the team member is open, and their week is open at that hour. These are the three answers the calendar reads."
      />

      {staff.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={<Users size={22} />}
            title="No team, no hours"
            description="Availability is a property of a person, not of the workspace: nobody can be booked until the first team member exists and records the hours they keep."
            action={
              <ButtonLink href="/app/bookings/staff/new" variant="primary" size="sm">
                Add a team member
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <Card>
          <CardHeader
            title="Weekly hours"
            description="Each row is read in that person’s own time zone, which is what makes 09:00 mean the same thing to them that it means on their booking page."
          />
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Team member</TH>
                  {WEEKDAY_ORDER.map((value) => (
                    <TH key={value}>{weekdayLabel(value, true)}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {staff.map((person) => {
                  const perPerson = week.get(person.id);
                  return (
                    <TR key={person.id}>
                      <TD>
                        <Link href={`/app/bookings/staff/${person.id}?panel=hours`} className="block hover:text-brand">
                          <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted">
                            {person.timezone.replace(/_/g, ' ')}
                          </span>
                        </Link>
                        {person.status !== 'active' && (
                          <span className="mt-1 block">
                            <StatusBadge state={person.status} />
                          </span>
                        )}
                      </TD>
                      {WEEKDAY_ORDER.map((value) => {
                        const ranges = perPerson?.get(value);
                        return (
                          <TD key={value} className="align-top">
                            {ranges && ranges.length > 0 ? (
                              <span className="block font-mono text-[11.5px] leading-[1.5] text-ink-soft">
                                {ranges.map((range) => (
                                  <span key={range} className="block whitespace-nowrap">
                                    {range}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="text-[11.5px] text-muted">—</span>
                            )}
                          </TD>
                        );
                      })}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <div className="mt-4">
        <ClosedDaysCard
          orgId={workspace.org.id}
          days={closedDays}
          today={today}
          canAdmin={canAdmin}
        />
      </div>

      <Card className="mt-4 max-w-[720px]">
        <CardHeader
          title="Days that break the week"
          description="A holiday for one person, or a Saturday opened for an event. An override wins over the weekly hours for the date it names, for that person only."
        />
        <CardBody className="grid gap-1.5">
          {upcoming.length === 0 ? (
            <p className="rounded-md border border-line bg-raised px-3 py-4 text-center text-[12.5px] text-ink-muted">
              Nobody has set a day off or added extra hours from {formatDateInZone(`${today}T12:00:00Z`, 'UTC')} onward.
              Every date follows the weekly grid.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {upcoming.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line px-3 py-2.5">
                  <span className="min-w-[150px] text-[13px] font-medium text-ink">
                    {weekdayLabel(weekdayOf(entry.day), true)} {formatDateInZone(`${entry.day}T12:00:00Z`, 'UTC')}
                  </span>
                  <Badge tone={entry.kind === 'closed' ? 'warning' : 'brand'}>
                    {entry.kind === 'closed' ? 'Day off' : 'Extra hours'}
                  </Badge>
                  <span className="font-mono text-[11.5px] text-ink-soft">
                    {entry.kind === 'extra' && entry.starts_at && entry.ends_at
                      ? `${toInputTime(entry.starts_at)}–${toInputTime(entry.ends_at)}`
                      : 'No times'}
                  </span>
                  <Link
                    href={`/app/bookings/staff/${entry.staff_id}?panel=days`}
                    className="text-[12px] text-muted underline decoration-line hover:text-brand"
                  >
                    {nameById.get(entry.staff_id) ?? 'Removed team member'}
                  </Link>
                  {entry.reason && (
                    <span className="min-w-0 flex-1 truncate text-right text-[11.5px] text-muted">{entry.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {past > 0 && (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted">
              <CalendarOff size={13} className="mt-[2px] flex-none" />
              {past} past {past === 1 ? 'override is' : 'overrides are'} still stored. They only ever spoke for their own
              date, so they change nothing now; remove one from that person&apos;s Days off tab to clear the record.
            </p>
          )}
        </CardBody>
      </Card>

      {staff.length > 0 && (
        <p className="mt-4 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          Changing anything here changes what a booking page offers from now on, never an appointment that is already
          made: a confirmed booking keeps its time even if its hour is deleted afterwards, and moving it is a separate
          act on the appointment itself.
        </p>
      )}
    </>
  );
}

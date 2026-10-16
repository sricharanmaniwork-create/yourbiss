import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, UserPlus } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listStaff, orgWeekWindows, staffServiceLinks } from '@/lib/repo';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The roster, and the two things that make a person bookable.
 *
 * A name is not enough: a team member shows on a booking page only when they are
 * assigned to the service *and* have weekly hours, so both are counted here and the
 * missing one is named. That is the difference between "the calendar is broken" and a
 * list that says which box is still empty.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Booking team' };

export default async function BookingStaffPage() {
  const workspace = await requireWorkspace();
  const [staff, links, windows] = await Promise.all([
    listStaff(workspace.org.id),
    staffServiceLinks(workspace.org.id),
    orgWeekWindows(workspace.org.id),
  ]);

  const servicesByStaff = new Map<string, number>();
  for (const link of links) servicesByStaff.set(link.staff_id, (servicesByStaff.get(link.staff_id) ?? 0) + 1);
  // Distinct weekdays, not rows: two windows on one Tuesday are still one working day.
  const daysByStaff = new Map<string, Set<number>>();
  for (const window of windows) {
    const set = daysByStaff.get(window.staff_id) ?? new Set<number>();
    set.add(window.weekday);
    daysByStaff.set(window.staff_id, set);
  }

  const canBuild = workspace.apps.bookings === true;

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings', label: 'Bookings' }}
        title="Team"
        description="The people a customer can choose, the clock their hours are read in, and what each of them offers."
        actions={
          canBuild ? (
            <ButtonLink href="/app/bookings/staff/new" variant="primary">
              <UserPlus size={15} />
              New team member
            </ButtonLink>
          ) : undefined
        }
      />

      {staff.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={<UserPlus size={22} />}
            title="Nobody on the team yet"
            description="A booking is always with someone: a customer picks a service and then the person who performs it. Add the first one and give them their working hours."
            action={
              canBuild ? (
                <ButtonLink href="/app/bookings/staff/new" variant="primary" size="sm">
                  Add the first one
                  <ArrowRight size={14} />
                </ButtonLink>
              ) : (
                <p className="max-w-[420px] text-[12.5px] leading-relaxed text-muted">
                  The Bookings app is switched off for this workspace, so nobody can be added until an owner or admin
                  turns it back on in Settings.
                </p>
              )
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {staff.map((person) => {
            const count = servicesByStaff.get(person.id) ?? 0;
            const openDays = daysByStaff.get(person.id)?.size ?? 0;
            return (
              <li key={person.id} className="ui-card">
                <Link href={`/app/bookings/staff/${person.id}`} className="block px-4 py-3.5 transition-colors hover:bg-raised">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-[14px] font-semibold text-ink">{person.name}</p>
                    <StatusBadge state={person.status} />
                  </div>
                  <p className="mt-1.5 truncate font-mono text-[11.5px] text-muted">{person.slug}</p>
                  <p className="mt-2 text-[12px] text-muted">{person.timezone.replace(/_/g, ' ')}</p>
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={count === 0 ? 'warning' : 'neutral'}>
                      {count === 0 ? 'No services assigned' : `${count} service${count === 1 ? '' : 's'}`}
                    </Badge>
                    <Badge tone={openDays === 0 ? 'warning' : 'neutral'}>
                      {openDays === 0 ? 'No working hours' : `Open ${openDays} day${openDays === 1 ? '' : 's'} a week`}
                    </Badge>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!canBuild && staff.length > 0 && (
        <p className="mt-4 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          The Bookings app is switched off for this workspace, so the team can be read but not changed. Appointments
          already made keep their person and their time either way.
        </p>
      )}
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listServices, staffForService } from '@/lib/repo';
import { NewBookingCard } from '@/components/bookings/new-booking-card';
import { Card, CardBody, PageHeader } from '@/components/ui';
import { dateInZone } from '@/lib/utils';
import type { PublicStaff } from '@/lib/bookings/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New appointment' };

/**
 * Booking for a customer from inside the app.
 *
 * The screen needs a service that is live and at least one person who offers it, because
 * `slot_conflict()` refuses both halves otherwise — so rather than draw a calendar with no
 * possible answer, this says which of the two is missing and links to the place that fixes
 * it. The team read is the same RPC the booking page uses, so the grid is offered the
 * people a customer could pick.
 */
export default async function NewAppointmentPage() {
  const workspace = await requireWorkspace();

  if (workspace.apps.bookings !== true) {
    return (
      <>
        <PageHeader back={{ href: '/app/bookings/appointments', label: 'Appointments' }} title="New appointment" />
        <div className="ui-card max-w-[560px] px-5 py-5">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            The Bookings app is switched off for this workspace, so no appointment can be recorded. An owner or admin
            turns it back on in Settings.
          </p>
        </div>
      </>
    );
  }

  const services = await listServices(workspace.org.id);
  // One pass decides both halves: whether anything is bookable and which service the
  // screen opens on. `slot_conflict()` refuses a hidden or archived service, so the
  // grid a member clicks has to be built from an active one.
  const bookable = services.filter((service) => service.status === 'active');
  const first = bookable[0];

  if (!first) {
    return (
      <>
        <PageHeader back={{ href: '/app/bookings/appointments', label: 'Appointments' }} title="New appointment" />
        <Card className="max-w-[640px]">
          <CardBody className="px-5 py-6">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              There is nothing to book yet: a manual appointment needs a service that is active, because the booking
              engine refuses one that is hidden or archived.
            </p>
            <Link
              href="/app/bookings/services/new"
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-[12.5px] font-medium text-white hover:bg-brand-dark"
            >
              <CalendarPlus size={15} />
              Add a service
            </Link>
          </CardBody>
        </Card>
      </>
    );
  }

  const offering = await staffForService(first.id);
  const initialTeam: PublicStaff[] = offering.map((member) => ({
    id: member.id,
    name: member.name,
    slug: String(member.slug ?? ''),
    bio: member.bio ?? null,
    avatar_url: member.avatar_url ?? null,
    timezone: member.timezone,
  }));

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings/appointments', label: 'Appointments' }}
        title="New appointment"
        description="For the customer who called, walked in, or was booked by a colleague. It goes through the same conflict check as the booking page, so it cannot double-book anyone."
      />
      <NewBookingCard
        services={bookable.map((service) => ({
          id: service.id,
          name: service.name,
          color: /^#[0-9A-Fa-f]{6}$/.test(service.color) ? service.color : '#2E6BE6',
          timezone: service.timezone,
          durationMin: Number.isInteger(service.duration_min) ? service.duration_min : 60,
          horizonDays: Number.isInteger(service.max_horizon_days) ? service.max_horizon_days : 30,
        }))}
        initialServiceId={first.id}
        initialTeam={initialTeam}
        // The strip opens on this date, and it is the service's clock that decides which
        // day that is — the same rule the customer's page follows.
        today={dateInZone(new Date(), first.timezone)}
      />
    </>
  );
}

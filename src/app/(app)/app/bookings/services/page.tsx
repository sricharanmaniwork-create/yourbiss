import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarPlus } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listServices, staffServiceLinks } from '@/lib/repo';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Booking services' };

export default async function BookingServicesPage() {
  const workspace = await requireWorkspace();
  const [services, links] = await Promise.all([listServices(workspace.org.id), staffServiceLinks(workspace.org.id)]);

  const offeredBy = new Map<string, number>();
  for (const link of links) offeredBy.set(link.service_id, (offeredBy.get(link.service_id) ?? 0) + 1);

  const canBuild = workspace.apps.bookings === true;

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings', label: 'Bookings' }}
        title="Services"
        description="What customers can book, how long it takes, and the address their booking page lives at."
        actions={
          canBuild ? (
            <ButtonLink href="/app/bookings/services/new" variant="primary">
              <CalendarPlus size={15} />
              New service
            </ButtonLink>
          ) : undefined
        }
      />

      {services.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={<CalendarPlus size={22} />}
            title="No services yet"
            description="A service is the thing a customer picks: a name, a length, and the team members who can perform it. Nothing is bookable until at least one person is assigned to it."
            action={
              canBuild ? (
                <ButtonLink href="/app/bookings/services/new" variant="primary" size="sm">
                  Add the first one
                  <ArrowRight size={14} />
                </ButtonLink>
              ) : (
                <p className="max-w-[420px] text-[12.5px] leading-relaxed text-muted">
                  The Bookings app is switched off for this workspace, so nothing can be added until an owner or admin
                  turns it back on in Settings.
                </p>
              )
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => {
            const team = offeredBy.get(service.id) ?? 0;
            return (
              <li key={service.id} className="ui-card">
                <Link href={`/app/bookings/services/${service.id}`} className="block px-4 py-3.5 transition-colors hover:bg-raised">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-[14px] font-semibold text-ink">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 flex-none rounded-full align-middle"
                        style={{ backgroundColor: service.color }}
                        aria-hidden="true"
                      />
                      {service.name}
                    </p>
                    <StatusBadge state={service.status} />
                  </div>
                  <p className="mt-1.5 truncate font-mono text-[11.5px] text-muted">
                    /book/{workspace.org.slug}/{service.slug}
                  </p>
                  <p className="mt-2 text-[12px] text-muted">
                    {service.duration_min} min
                    {service.slot_step_min !== service.duration_min ? ` · every ${service.slot_step_min} min` : ''}
                    {service.capacity > 1 ? ` · ${service.capacity} at a time` : ''}
                  </p>
                  <p className="mt-1 text-[12px] text-muted">
                    {team === 0 ? (
                      <Badge tone="warning">Nobody offers it yet</Badge>
                    ) : (
                      `${team} team member${team === 1 ? '' : 's'}`
                    )}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!canBuild && services.length > 0 && (
        <p className="mt-4 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          The Bookings app is switched off for this workspace, so these services can be read but not changed. A booking
          page already shared keeps answering until the service is hidden — switching the app off is not a way to close
          one.
        </p>
      )}
    </>
  );
}

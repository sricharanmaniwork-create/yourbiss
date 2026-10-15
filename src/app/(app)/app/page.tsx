import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, FileText, Globe, Plus, Users } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { dashboardCounts, listBookings, listSites, recentActivity } from '@/lib/repo';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { isLive } from '@/lib/modules';
import { formatInZone } from '@/lib/utils';
import { addDays, dateInZone } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const workspace = await requireWorkspace();
  const { org } = workspace;

  const today = dateInZone(new Date(), org.timezone);
  const [counts, sites, upcoming, activity] = await Promise.all([
    dashboardCounts(org.id),
    listSites(org.id),
    listBookings(org.id, {
      from: `${today}T00:00:00Z`,
      to: `${addDays(today, 14)}T23:59:59Z`,
      states: ['pending', 'confirmed'],
      limit: 8,
    }),
    recentActivity(org.id, 10),
  ]);

  // The rail shows every app, but a link to a screen that is not in this build
  // is worse than no link, so the actions below follow the build state.
  const formsLive = isLive('forms');
  const bookingsLive = isLive('bookings');

  return (
    <>
      <PageHeader
        title={`Good to see you, ${org.name}`}
        description={`Today is ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: org.timezone }).format(new Date())} in ${org.timezone.replace('_', ' ')}.`}
        actions={
          <>
            {formsLive && (
              <ButtonLink href="/app/forms/new" variant="secondary" size="md">
                <FileText size={14} />
                New form
              </ButtonLink>
            )}
            <ButtonLink href="/app/websites" variant="primary" size="md">
              <Globe size={14} />
              Build a website
            </ButtonLink>
          </>
        }
      />

      <GettingStarted counts={counts} sites={sites} />

      <section aria-label="Key numbers" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Published pages" value={counts.published_pages} hint={`${counts.sites} site${counts.sites === 1 ? '' : 's'}`} href="/app/websites" icon={<Globe size={15} />} />
        <Stat label="Bookings in 14 days" value={counts.bookings_upcoming} hint={`${counts.bookings_30d} created in 30 days`} href="/app/bookings" icon={<CalendarDays size={15} />} />
        <Stat label="Responses this week" value={counts.responses_last_7d} hint={`${counts.form_responses} collected in total`} href="/app/forms" icon={<FileText size={15} />} />
        <Stat label="Team members" value={counts.members} hint={counts.services ? `${counts.staff} staff · ${counts.services} services` : 'No services yet'} href="/app/settings/members" icon={<Users size={15} />} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="ui-card" aria-labelledby="upcoming-bookings">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id="upcoming-bookings" className="text-[14px] font-semibold">
              Next bookings
            </h2>
            {bookingsLive && (
              <Link href="/app/bookings/calendar" className="text-[12.5px] font-medium text-brand hover:underline">
                Open calendar
              </Link>
            )}
          </header>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={19} />}
              title="Nothing booked yet"
              description={
                !bookingsLive
                  ? 'The Bookings app is not in this build yet, so no slot can be taken. Your services and staff will show up here once it ships.'
                  : counts.services === 0
                    ? 'Create a service with a duration and your working hours, then share the booking page.'
                    : 'Once a customer books a slot it appears here. Set your working hours so slots can open up.'
              }
              action={
                bookingsLive ? (
                  counts.services === 0 ? (
                    <ButtonLink href="/app/bookings/services/new" variant="primary" size="sm">
                      <Plus size={14} />
                      Create a service
                    </ButtonLink>
                  ) : (
                    <ButtonLink href="/app/bookings/availability" variant="secondary" size="sm">
                      Set working hours
                    </ButtonLink>
                  )
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((booking) => (
                <li key={booking.id} className="flex items-center gap-3 px-5 py-3">
                  <span
                    className="mt-[2px] h-9 w-1 flex-none rounded-full"
                    style={{ background: booking.service?.color ?? '#2e6be6' }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">
                      {booking.customer_name}
                      <span className="ml-2 font-normal text-muted">{booking.service?.name}</span>
                    </p>
                    <p className="truncate text-[12.5px] text-muted">
                      {formatInZone(booking.starts_at, booking.timezone)} · {booking.staff?.name ?? 'Unassigned'}
                    </p>
                  </div>
                  <StatusBadge state={booking.state} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ui-card" aria-labelledby="recent-activity">
          <header className="border-b border-line px-5 py-3.5">
            <h2 id="recent-activity" className="text-[14px] font-semibold">
              Recent activity
            </h2>
          </header>
          {activity.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Publishing a page, collecting a response or taking a booking is recorded here so the team can see what moved."
            />
          ) : (
            <ul className="divide-y divide-line">
              {activity.map((entry) => (
                <li key={entry.id} className="px-5 py-3">
                  <p className="text-[13px] text-ink">{entry.summary ?? entry.action.replace(/_/g, ' ')}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted">
                    {entry.app_key && <Badge tone="neutral">{entry.app_key}</Badge>}
                    <span>{formatInZone(entry.created_at, org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="ui-card group px-4 py-3.5 hover:border-brand">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">
        <span className="text-[#8b95a3] group-hover:text-brand">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-[24px] font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1.5 truncate text-[12px] text-muted">{hint}</p>
    </Link>
  );
}

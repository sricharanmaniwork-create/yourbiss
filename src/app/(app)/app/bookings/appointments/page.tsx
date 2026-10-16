import type { Metadata } from 'next';
import Link from 'next/link';
import { Filter, Inbox, Plus } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listBookings, listServices, listStaff } from '@/lib/repo';
import { AppointmentsTable } from '@/components/bookings/appointments-table';
import { Badge, ButtonLink, Card, CardBody, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { BOOKING_STATES, BOOKING_STATE_LABELS, type AppointmentDoc, type BookingState } from '@/components/bookings/types-client';
import { dateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Appointments' };

/** What the trigger will accept from each state, before the role check narrows it. */
const TRANSITIONS: Record<string, BookingState[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  cancelled: [],
  completed: [],
  no_show: [],
};
const ROW_LIMIT = 200;

/**
 * The working list: what is booked, with the acts the database will honour on each row.
 *
 * Filters are a GET form, so an address like this one is a saved view — and a member who
 * wants "everything pending for Priya" can paste it without rebuilding the filters. It is
 * read through the caller's own session, so `bookings_select` decides which rows exist here
 * at all.
 *
 * Two lists are computed server-side rather than left to the buttons. `allowed` narrows the
 * trigger's transitions by role, because `bclosed_write` is admin-only and a member offered
 * "completed" would only be refused. And a row whose service or person has since been
 * removed keeps its label from the join, or falls back to saying it was removed: an
 * appointment does not stop being owed because a service was archived.
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; staff?: string; service?: string; scope?: string; from?: string }>;
}) {
  const workspace = await requireWorkspace();
  const query = await searchParams;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const zone = workspace.org.timezone;
  const today = dateInZone(new Date(), zone);
  const now = new Date().toISOString();

  const scope = query.scope === 'past' || query.scope === 'all' ? query.scope : 'upcoming';
  const state = BOOKING_STATES.includes(query.state as BookingState) ? (query.state as BookingState) : undefined;

  const [services, staff, bookings] = await Promise.all([
    listServices(workspace.org.id),
    listStaff(workspace.org.id),
    listBookings(workspace.org.id, {
      from: scope === 'past' ? undefined : scope === 'upcoming' ? now : undefined,
      to: scope === 'past' ? now : undefined,
      states: scope === 'upcoming' && !state ? ['pending', 'confirmed'] : state ? [state] : undefined,
      staffId: query.staff,
      serviceId: query.service,
      search: query.q,
      limit: ROW_LIMIT,
    }),
  ]);

  const horizonById = new Map(services.map((service) => [service.id, service.max_horizon_days]));
  const colorById = new Map(services.map((service) => [service.id, service.color]));

  const rows: AppointmentDoc[] = bookings.map((booking) => {
    const fromTrigger = TRANSITIONS[booking.state] ?? [];
    return {
      id: booking.id,
      code: booking.code,
      customerName: booking.customer_name,
      customerEmail: booking.customer_email,
      customerPhone: booking.customer_phone,
      notes: booking.notes,
      internalNotes: booking.internal_notes,
      cancelReason: booking.cancel_reason,
      state: booking.state,
      source: booking.source,
      // A member may only call something off; an owner or admin gets the whole ladder.
      allowed: canAdmin ? fromTrigger : fromTrigger.filter((next) => next === 'cancelled'),
      serviceId: booking.service_id,
      serviceName: booking.service?.name ?? 'Removed service',
      color: /^#[0-9A-Fa-f]{6}$/.test(String(colorById.get(booking.service_id) ?? ''))
        ? String(colorById.get(booking.service_id))
        : '#2E6BE6',
      staffId: booking.staff_id,
      staffName: booking.staff?.name ?? 'Removed team member',
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      timezone: booking.timezone,
      createdAt: booking.created_at,
      // A service that has gone leaves its appointments with the widest grid the engine
      // itself clamps, rather than a made-up horizon.
      horizonDays: Number.isInteger(horizonById.get(booking.service_id)) ? Number(horizonById.get(booking.service_id)) : 90,
    } satisfies AppointmentDoc;
  });

  const filtersOn = Boolean(query.q || state || query.staff || query.service || scope !== 'upcoming');

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings', label: 'Bookings' }}
        title="Appointments"
        description="Every booking this workspace can read, with the state changes, the move and the internal note for each one."
        actions={
          workspace.apps.bookings === true ? (
            <ButtonLink href="/app/bookings/appointments/new" variant="primary">
              <Plus size={15} />
              New appointment
            </ButtonLink>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardBody>
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_repeat(3,minmax(140px,auto))_auto] md:items-end">
            <Field label="Reference, name or email" htmlFor="q">
              <Input id="q" name="q" defaultValue={query.q ?? ''} placeholder="K7M2PQ4X" maxLength={120} />
            </Field>
            <Field label="State" htmlFor="state">
              <Select id="state" name="state" defaultValue={state ?? ''}>
                <option value="">Any state</option>
                {BOOKING_STATES.map((value) => (
                  <option key={value} value={value}>
                    {BOOKING_STATE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Service" htmlFor="service">
              <Select id="service" name="service" defaultValue={query.service ?? ''}>
                <option value="">Any service</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Team member" htmlFor="staff">
              <Select id="staff" name="staff" defaultValue={query.staff ?? ''}>
                <option value="">Everyone</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
            <input type="hidden" name="scope" value={scope} />
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[12.5px] font-medium text-ink-soft hover:bg-raised"
            >
              <Filter size={14} />
              Apply
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
            <ScopeLink on={scope === 'upcoming'} href={scopeHref({ ...query, scope: 'upcoming' })}>
              Coming up
            </ScopeLink>
            <ScopeLink on={scope === 'past'} href={scopeHref({ ...query, scope: 'past' })}>
              Past
            </ScopeLink>
            <ScopeLink on={scope === 'all'} href={scopeHref({ ...query, scope: 'all' })}>
              Everything
            </ScopeLink>
            {filtersOn && (
              <Link href="/app/bookings/appointments" className="ml-auto text-[12px] text-muted underline decoration-line hover:text-brand">
                Clear the filters
              </Link>
            )}
          </div>
        </CardBody>
      </Card>

      {bookings.length >= ROW_LIMIT && (
        <p className="mb-3 rounded-md border border-[#f3ddb0] bg-[#fdf3e0] px-3 py-2 text-[12.5px] leading-relaxed text-[#8a5300]">
          This view holds more than {ROW_LIMIT} appointments, so only the first {ROW_LIMIT} are listed. Narrow it with a
          state, a service or a team member.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="ui-card">
          <EmptyState
            icon={<Inbox size={22} />}
            title={filtersOn ? 'Nothing matches this view' : 'No appointments yet'}
            description={
              filtersOn
                ? 'No booking matches the filter. A reference is eight characters and case-insensitive, and a name or address is matched anywhere inside it.'
                : 'Nothing has been booked on this workspace yet. A booking appears the moment a customer finishes a booking page, or when the team records one for someone on the phone.'
            }
            action={
              filtersOn ? (
                <ButtonLink href="/app/bookings/appointments" size="sm">
                  Show everything
                </ButtonLink>
              ) : (
                <ButtonLink href="/app/bookings/services" size="sm">
                  Check the services
                </ButtonLink>
              )
            }
          />
        </div>
      ) : (
        <AppointmentsTable rows={rows} zone={zone} today={today} canManage={workspace.apps.bookings === true} />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{rows.length} listed</Badge>
        <span className="text-[12px] text-muted">
          Times are shown in {zone.replace(/_/g, ' ')}; a booking written in another zone prints its own beside it.
        </span>
      </div>

      {!canAdmin && (
        <p className="mt-2 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          Members can cancel an appointment and add an internal note. Marking one confirmed, completed or a no-show is
          an owner or admin act, because the closed states are guarded by an admin-only policy as well as by the trigger.
        </p>
      )}

      {workspace.apps.bookings !== true && (
        <p className="mt-2 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          The Bookings app is switched off for this workspace, so these rows can be read but not acted on. Appointments
          already made are still real, and an owner or admin turns the app back on in Settings.
        </p>
      )}
    </>
  );
}

/** Keeps every filter the visitor already chose and moves only the date window. */
function scopeHref(query: { q?: string; state?: string; staff?: string; service?: string; scope?: string; from?: string }) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.state) params.set('state', query.state);
  if (query.staff) params.set('staff', query.staff);
  if (query.service) params.set('service', query.service);
  if (query.scope && query.scope !== 'upcoming') params.set('scope', query.scope);
  const search = params.toString();
  return search ? `/app/bookings/appointments?${search}` : '/app/bookings/appointments';
}

function ScopeLink({ on, href, children }: { on: boolean; href: string; children: React.ReactNode }) {
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

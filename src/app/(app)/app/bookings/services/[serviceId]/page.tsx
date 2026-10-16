import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/workspace';
import { requestOrigin } from '@/lib/app-url';
import { getService, listForms, listStaff, staffServiceLinks } from '@/lib/repo';
import { currencyChoices, isKnownTimeZone, timeZoneList } from '@/lib/timezones';
import { serviceDraftSchema } from '@/lib/bookings/types';
import { PageHeader } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui';
import { ServiceOverview } from '@/components/bookings/service-overview';
import type { ServiceDocument, StaffDocument } from '@/components/bookings/types-client';

/**
 * One service: its hours-of-business numbers, who offers it, where customers reach it.
 *
 * The row is read through the member's own session, so RLS decides whether it exists for
 * them. The `org_id` comparison after that only stops someone who belongs to two
 * workspaces from reaching the other one's service by pasting its id in while the first
 * workspace is selected.
 */
export const dynamic = 'force-dynamic';

interface Params {
  serviceId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { serviceId } = await params;
  const service = await getService(serviceId);
  return { title: service ? `Bookings — ${service.name}` : 'Bookings' };
}

export default async function ServiceOverviewRoute({ params }: { params: Promise<Params> }) {
  const { serviceId } = await params;
  const workspace = await requireWorkspace();

  const service = await getService(serviceId);
  if (!service || service.org_id !== workspace.org.id || service.status === 'archived') notFound();

  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  // A hand-edited or future-versioned row can hold numbers this build cannot place in a
  // field. Refusing the screen is the safe answer: falling back to defaults and letting
  // someone press save would rewrite a service with values nobody chose.
  const parsed = serviceDraftSchema.safeParse({
    name: service.name,
    slug: service.slug,
    description: service.description ?? '',
    duration_min: service.duration_min,
    buffer_before_min: service.buffer_before_min,
    buffer_after_min: service.buffer_after_min,
    slot_step_min: service.slot_step_min,
    min_lead_min: service.min_lead_min,
    max_horizon_days: service.max_horizon_days,
    daily_limit: service.daily_limit,
    capacity: service.capacity,
    price_cents: service.price_cents,
    currency: service.currency,
    location_kind: service.location_kind,
    timezone: service.timezone,
    color: service.color,
    intake_form_id: service.intake_form_id,
    status: service.status,
    sort_order: service.sort_order,
    page_config: service.page_config ?? {},
  });

  if (!parsed.success) {
    console.error('[yourbiss] booking service could not be read', {
      service_id: service.id,
      issues: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return (
      <>
        <PageHeader
          back={{ href: '/app/bookings/services', label: 'Services' }}
          title={service.name}
          description="This service is in the workspace, but its saved numbers are not something this build can read."
        />
        <div className="ui-card max-w-[720px] px-4 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            Nothing has been lost: the appointments already made against it are untouched and every customer keeps their
            reference. The row needs repairing where it was written before this screen will show it — saving from here
            would overwrite values this build could not read with the defaults it guessed.
          </p>
          <ButtonLink variant="secondary" href="/app/bookings/services" className="mt-4">
            Back to Services
          </ButtonLink>
        </div>
      </>
    );
  }

  const document: ServiceDocument = { ...parsed.data, id: service.id };

  const [staff, links, forms, origin] = await Promise.all([
    listStaff(workspace.org.id),
    staffServiceLinks(workspace.org.id),
    // The intake picker only lists a form the workspace actually has, and RLS has
    // already decided what this member may see.
    listForms(workspace.org.id),
    requestOrigin(),
  ]);

  const byStaff = new Map<string, string[]>();
  for (const link of links) {
    const list = byStaff.get(link.staff_id) ?? [];
    list.push(link.service_id);
    byStaff.set(link.staff_id, list);
  }

  const staffDocuments: StaffDocument[] = staff.map((person) => ({
    id: person.id,
    name: person.name,
    slug: String(person.slug ?? ''),
    bio: person.bio ?? '',
    avatar_url: person.avatar_url ?? '',
    // A zone the runtime does not know would make every Intl call on the page throw, so
    // the row falls back to the workspace's own clock rather than being trusted.
    timezone: isKnownTimeZone(person.timezone) ? person.timezone : workspace.org.timezone,
    status: person.status,
    sort_order: person.sort_order,
    user_id: person.user_id,
    service_ids: byStaff.get(person.id) ?? [],
    contacts: null,
  }));

  return (
    <ServiceOverview
      service={document}
      staff={staffDocuments}
      forms={forms.map((form) => ({ id: form.id, title: form.title }))}
      timezones={timeZoneList()}
      currencies={currencyChoices()}
      orgSlug={workspace.org.slug}
      origin={origin}
      // Same rule as the Forms screens: switching the Bookings app off stops writes and
      // leaves everything readable, rather than offering a save the policy would refuse.
      canManage={workspace.apps.bookings === true}
      canAdmin={canAdmin}
      offering={staffDocuments
        .filter((person) => person.status === 'active' && person.service_ids.includes(service.id))
        .map((person) => ({ id: person.id, name: person.name }))}
    />
  );
}

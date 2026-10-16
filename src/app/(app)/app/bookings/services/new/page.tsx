import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { NewServiceForm } from '@/components/bookings/new-service-form';
import { PageHeader } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New booking service' };

export default async function NewBookingServicePage() {
  const workspace = await requireWorkspace();

  if (workspace.apps.bookings !== true) {
    return (
      <>
        <PageHeader back={{ href: '/app/bookings/services', label: 'Services' }} title="New service" />
        <div className="ui-card max-w-[560px] px-5 py-5">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            The Bookings app is switched off for this workspace, so a service cannot be added. An owner or admin turns it
            back on in Settings.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings/services', label: 'Services' }}
        title="New service"
        description="Name it now, set its length and hours next. A service is only on a booking page once a team member offers it."
      />
      <NewServiceForm orgId={workspace.org.id} orgSlug={workspace.org.slug} />
    </>
  );
}

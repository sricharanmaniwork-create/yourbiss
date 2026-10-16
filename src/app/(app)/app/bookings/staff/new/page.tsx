import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { timeZoneList } from '@/lib/timezones';
import { NewStaffForm } from '@/components/bookings/new-staff-form';
import { PageHeader } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New booking team member' };

export default async function NewBookingStaffPage() {
  const workspace = await requireWorkspace();

  if (workspace.apps.bookings !== true) {
    return (
      <>
        <PageHeader back={{ href: '/app/bookings/staff', label: 'Team' }} title="New team member" />
        <div className="ui-card max-w-[560px] px-5 py-5">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            The Bookings app is switched off for this workspace, so nobody can be added. An owner or admin turns it back
            on in Settings.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings/staff', label: 'Team' }}
        title="New team member"
        description="Their name and the clock they work to. Assign services and set weekly hours on the next screen."
      />
      <NewStaffForm orgId={workspace.org.id} timezones={timeZoneList()} defaultTimezone={workspace.org.timezone} />
    </>
  );
}

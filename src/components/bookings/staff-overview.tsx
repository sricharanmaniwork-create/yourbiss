'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarX2, Eye, EyeOff, Trash2, UserRound } from 'lucide-react';
import { deleteStaff, setStaffStatus } from '@/lib/actions/bookings';
import { Badge, Button, Card, CardBody, Modal, PageHeader, StatusBadge, Tabs, toast, type TabItem } from '@/components/ui';
import { ExceptionEditor } from './exception-editor';
import { StaffProfileTab } from './staff-profile-tab';
import { WeekEditor } from './week-editor';
import type { AssignedService, StaffDocument, WeekWindowDoc } from './types-client';
import type { BookingException } from '@/lib/types';

type Panel = 'profile' | 'hours' | 'days';

/**
 * One team member: who they are, the hours they keep, and the days that break them.
 *
 * The three panels write three different tables, and none of them can make a slot appear
 * on their own — a time exists only when the service is active, this person offers it,
 * their week is open at that hour, and `slot_conflict()` finds nothing in the way. The
 * status strip says which of the two halves this screen owns is still missing, because
 * that is the question a booking page with no times always turns out to be.
 */
export function StaffOverview({
  staff,
  services,
  timezones,
  windows,
  exceptions,
  today,
  initialPanel,
  canManage,
  canAdmin,
}: {
  staff: StaffDocument;
  services: AssignedService[];
  timezones: string[];
  windows: WeekWindowDoc[];
  exceptions: BookingException[];
  today: string;
  initialPanel?: Panel;
  canManage: boolean;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(initialPanel ?? 'profile');
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const assignedNames = services.filter((service) => staff.service_ids.includes(service.id)).map((service) => service.name);
  const openDays = new Set(windows.map((window) => window.weekday)).size;

  const tabs: TabItem[] = [
    { id: 'profile', label: 'Profile', badge: staff.service_ids.length },
    { id: 'hours', label: 'Weekly hours', badge: windows.length },
    { id: 'days', label: 'Days off', badge: exceptions.length },
  ];

  const setStatus = (status: 'active' | 'hidden' | 'archived') => {
    startTransition(async () => {
      const result = await setStaffStatus(staff.id, status).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That change did not stick',
      }));
      if (!result.ok) {
        toast.error(result.error ?? 'That change did not stick');
        return;
      }
      toast.success(status === 'active' ? `${staff.name} is bookable again` : status === 'hidden' ? `${staff.name} is off the booking page` : 'Team member archived');
      if (status === 'archived') {
        router.push('/app/bookings/staff');
        return;
      }
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteStaff(staff.id).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That change did not stick',
      }));
      setConfirmDelete(false);
      if (!result.ok) {
        toast.error(result.error ?? 'This person is still referenced by bookings');
        return;
      }
      toast.success('Team member deleted');
      router.push('/app/bookings/staff');
    });
  };

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings/staff', label: 'Team' }}
        title={staff.name}
        description="Their profile, the hours they keep every week, and the dates that differ from it."
        actions={
          <>
            {canManage && staff.status === 'active' && (
              <Button variant="secondary" loading={pending} onClick={() => setStatus('hidden')}>
                <EyeOff size={14} />
                Hide
              </Button>
            )}
            {canManage && staff.status === 'hidden' && (
              <Button variant="primary" loading={pending} onClick={() => setStatus('active')}>
                <Eye size={14} />
                Make bookable
              </Button>
            )}
            {canAdmin && staff.status !== 'archived' && (
              <Button variant="ghost" loading={pending} onClick={() => setStatus('archived')}>
                Archive
              </Button>
            )}
            {canAdmin && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} />
                Delete
              </Button>
            )}
          </>
        }
      />

      <div className="ui-card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11.5px] text-muted">{staff.slug}</span>
          <StatusBadge state={staff.status} />
        </div>
        <p className="text-[12px] text-muted">{staff.timezone.replace(/_/g, ' ')}</p>
        <p className="text-[12px] text-muted">
          {staff.service_ids.length === 0 ? (
            <Badge tone="warning">No services assigned</Badge>
          ) : (
            `${staff.service_ids.length} service${staff.service_ids.length === 1 ? '' : 's'}: ${assignedNames.slice(0, 3).join(', ')}${assignedNames.length > 3 ? '…' : ''}`
          )}
        </p>
        <p className="text-[12px] text-muted">
          {windows.length === 0 ? (
            <Badge tone="warning">No weekly hours</Badge>
          ) : (
            `Open on ${openDays} day${openDays === 1 ? '' : 's'} each week`
          )}
        </p>
        {!canManage && <Badge tone="neutral">Read-only</Badge>}
      </div>

      {staff.status === 'active' && (staff.service_ids.length === 0 || windows.length === 0) && (
        <Card className="mb-4">
          <CardBody className="flex items-start gap-3">
            <UserRound size={16} className="mt-0.5 flex-none text-warning" />
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              {staff.service_ids.length === 0 && windows.length === 0
                ? 'This person offers nothing yet and has no hours, so no slot can be booked with them. Assign a service and set the week.'
                : staff.service_ids.length === 0
                  ? 'Their hours are set, but no service is assigned, so they never appear as a choice. Tick the services on the Profile tab.'
                  : 'They offer services, but the weekly calendar is empty, so their booking page has no times to show. Set the week on the hours tab.'}
            </p>
          </CardBody>
        </Card>
      )}

      <Tabs items={tabs} value={panel} onChange={(id) => setPanel(id as Panel)} className="mb-4" />

      {panel === 'profile' && (
        <StaffProfileTab
          staff={staff}
          services={services}
          timezones={timezones}
          canManage={canManage}
          canAdmin={canAdmin}
          onSaved={() => router.refresh()}
        />
      )}
      {panel === 'hours' && (
        <WeekEditor
          staffId={staff.id}
          staffName={staff.name}
          timezone={staff.timezone}
          windows={windows}
          canManage={canManage}
          onSaved={() => router.refresh()}
        />
      )}
      {panel === 'days' && (
        <ExceptionEditor
          staffId={staff.id}
          timezone={staff.timezone}
          exceptions={exceptions}
          today={today}
          canManage={canManage}
          onSaved={() => router.refresh()}
        />
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${staff.name}?`}
        description="Their hours, assignments and contact row go with them. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep them
            </Button>
            <Button variant="danger" loading={pending} onClick={remove}>
              Delete team member
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-soft">
          <CalendarX2 size={15} className="mt-0.5 flex-none text-muted" />
          Appointments already made with this person are kept on purpose, so a customer holding a reference can still
          read and cancel them. That is why the delete is refused while any booking exists — hiding them takes them off
          the booking page and keeps every appointment readable.
        </p>
      </Modal>
    </>
  );
}

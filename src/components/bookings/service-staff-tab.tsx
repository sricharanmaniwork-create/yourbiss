'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { setStaffServices } from '@/lib/actions/bookings';
import { Card, CardBody, CardHeader, Checkbox, EmptyState, FormStatus, Spinner, toast, useAction } from '@/components/ui';
import { initials } from '@/lib/utils';
import type { StaffDocument } from './types-client';

/**
 * Who stands behind this service.
 *
 * The pairing table is keyed by staff, not by service, and the only action that writes
 * it replaces one person's whole list — so a tick here means "this person's services,
 * plus or minus this one". `staff_for_service()` reads exactly that pairing, which is
 * why a service with nobody ticked has a live address and no times: the engine answers
 * `staff_does_not_offer_service` instead of inventing a slot.
 */
export function ServiceStaffTab({
  serviceId,
  serviceName,
  staff,
  canManage,
  onSaved,
}: {
  serviceId: string;
  serviceName: string;
  staff: StaffDocument[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { state, run } = useAction();
  const [savingId, setSavingId] = useState<string | null>(null);

  const assign = (person: StaffDocument, wanted: boolean) => {
    const next = wanted
      ? [...new Set([...person.service_ids, serviceId])]
      : person.service_ids.filter((id) => id !== serviceId);

    setSavingId(person.id);
    void run(async () => {
      const result = await setStaffServices(person.id, next);
      if (result.ok) {
        toast.success(wanted ? `${person.name} now offers ${serviceName}` : `${person.name} no longer offers ${serviceName}`);
        onSaved();
        router.refresh();
      }
      setSavingId(null);
      return result;
    });
  };

  const offering = staff.filter((person) => person.service_ids.includes(serviceId));

  return (
    <Card className="max-w-[820px]">
      <CardHeader
        title="Offered by"
        description={
          staff.length === 0
            ? 'Nobody has been added to the team yet, so this service cannot be booked.'
            : `${offering.length} of ${staff.length} team member${staff.length === 1 ? '' : 's'} can be booked for “${serviceName}”.`
        }
      />
      <CardBody className="grid gap-1">
        {staff.length === 0 ? (
          <EmptyState
            icon={<UserRound size={19} />}
            title="No team members yet"
            description="A service needs a person behind it before any slot can be offered. Add someone from the Bookings home."
          />
        ) : (
          staff.map((person) => {
            const checked = person.service_ids.includes(serviceId);
            return (
              <label
                key={person.id}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 ${canManage ? 'cursor-pointer hover:bg-raised' : 'cursor-default'}`}
              >
                <Checkbox
                  checked={checked}
                  disabled={!canManage || savingId !== null}
                  onChange={(event) => assign(person, event.target.checked)}
                />
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-raised text-[11.5px] font-semibold text-ink-soft">
                  {initials(person.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {person.status === 'active' ? 'Taking bookings' : 'Hidden from the booking page'} ·{' '}
                    {person.service_ids.length === 0 ? 'no services assigned' : `${person.service_ids.length} assigned`}
                  </span>
                </span>
                {savingId === person.id && <Spinner label="Saving" className="h-4 w-4" />}
              </label>
            );
          })
        )}
      </CardBody>

      <div className="border-t border-line px-4 py-3">
        <FormStatus state={state} />
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          {canManage
            ? 'Hiding a person keeps their assignments and their history; they simply stop appearing on the booking page.'
            : 'The Bookings app is switched off for this workspace, so assignments are read-only.'}
        </p>
      </div>
    </Card>
  );
}

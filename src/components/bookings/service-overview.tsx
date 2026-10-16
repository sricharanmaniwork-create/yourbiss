'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, EyeOff, Eye, Trash2 } from 'lucide-react';
import { deleteService, setServiceStatus } from '@/lib/actions/bookings';
import { Badge, Button, ButtonLink, Modal, PageHeader, StatusBadge, Tabs, toast, type TabItem } from '@/components/ui';
import { formatMoney } from '@/lib/utils';
import { ServiceDetailsTab } from './service-details-tab';
import { ServiceStaffTab } from './service-staff-tab';
import { ServiceShareTab } from './service-share-tab';
import type { ServiceDocument, StaffDocument } from './types-client';

type Panel = 'details' | 'team' | 'share';

/**
 * One service: what it is, who offers it, where customers reach it.
 *
 * Visibility is a header decision rather than a field on the form because it is judged
 * by a different rule — archiving takes an admin — and because a live booking page can
 * be turned off without touching the hours, the price or a single appointment.
 */
export function ServiceOverview({
  service,
  staff,
  forms,
  timezones,
  currencies,
  orgSlug,
  origin,
  canManage,
  canAdmin,
  offering,
}: {
  service: ServiceDocument;
  staff: StaffDocument[];
  forms: { id: string; title: string }[];
  timezones: string[];
  currencies: { code: string; label: string }[];
  orgSlug: string;
  origin: string;
  canManage: boolean;
  canAdmin: boolean;
  /** Who can be booked for this service right now, in the order the page shows them. */
  offering: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('details');
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const publicPath = `/book/${orgSlug}/${service.slug}`;
  const assigned = useMemo(() => staff.filter((person) => person.service_ids.includes(service.id)), [staff, service.id]);

  const tabs: TabItem[] = [
    { id: 'details', label: 'Details' },
    { id: 'team', label: 'Team', badge: assigned.length },
    { id: 'share', label: 'Share' },
  ];

  const setStatus = (status: 'active' | 'hidden' | 'archived') => {
    startTransition(async () => {
      const result = await setServiceStatus(service.id, status).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That change did not stick',
      }));
      if (!result.ok) {
        toast.error(result.error ?? 'That change did not stick');
        return;
      }
      toast.success(status === 'active' ? 'The service is bookable again' : status === 'hidden' ? 'Taken off the booking page' : 'Service archived');
      if (status === 'archived') {
        router.push('/app/bookings/services');
        return;
      }
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteService(service.id).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That change did not stick',
      }));
      setConfirmDelete(false);
      if (!result.ok) {
        toast.error(result.error ?? 'That service is still referenced by bookings');
        return;
      }
      toast.success('Service deleted');
      router.push('/app/bookings/services');
    });
  };

  return (
    <>
      <PageHeader
        back={{ href: '/app/bookings/services', label: 'Services' }}
        title={service.name}
        description={`Customers book this at ${publicPath}, or inside any page that embeds it.`}
        actions={
          <>
            {service.status === 'active' && (
              <ButtonLink href={publicPath} target="_blank" rel="noopener noreferrer" variant="secondary">
                <ExternalLink size={14} />
                Open page
              </ButtonLink>
            )}
            {canManage && service.status === 'active' && (
              <Button variant="secondary" loading={pending} onClick={() => setStatus('hidden')}>
                <EyeOff size={14} />
                Hide
              </Button>
            )}
            {canManage && service.status === 'hidden' && (
              <Button variant="primary" loading={pending} onClick={() => setStatus('active')}>
                <Eye size={14} />
                Make bookable
              </Button>
            )}
            {canAdmin && service.status !== 'archived' && (
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
          <span className="font-mono text-[11.5px] text-muted">{publicPath}</span>
          <StatusBadge state={service.status} />
          {service.status === 'active' && assigned.length === 0 && <Badge tone="warning">Nobody offers it yet</Badge>}
        </div>
        <p className="text-[12px] text-muted">
          {service.duration_min} min
          {service.buffer_before_min > 0 || service.buffer_after_min > 0
            ? ` · ${service.buffer_before_min} before, ${service.buffer_after_min} after`
            : ''}
        </p>
        <p className="text-[12px] text-muted">
          {service.capacity > 1 ? `${service.capacity} at a time` : 'One at a time'} · up to {service.max_horizon_days} days ahead
        </p>
        <p className="text-[12px] text-muted">
          {service.price_cents === 0 ? 'Free' : formatMoney(service.price_cents, service.currency)}
        </p>
        {!canManage && <Badge tone="neutral">Read-only</Badge>}
      </div>

      <Tabs items={tabs} value={panel} onChange={(id) => setPanel(id as Panel)} className="mb-4" />

      {panel === 'details' && (
        <ServiceDetailsTab
          service={service}
          forms={forms}
          timezones={timezones}
          currencies={currencies}
          canManage={canManage}
          onSaved={() => router.refresh()}
        />
      )}
      {panel === 'team' && (
        <ServiceStaffTab
          serviceId={service.id}
          serviceName={service.name}
          staff={staff}
          canManage={canManage}
          onSaved={() => router.refresh()}
        />
      )}
      {panel === 'share' && (
        <ServiceShareTab service={service} orgSlug={orgSlug} origin={origin} offering={offering} />
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${service.name}”?`}
        description="The address stops working and the service leaves the list. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending} onClick={remove}>
              Delete service
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-ink-soft">
          Appointments already made against this service are kept on purpose, so a customer holding a reference can still
          read and cancel them. That is also why the delete is refused while any booking exists — archiving hides the
          service and keeps every appointment readable.
        </p>
      </Modal>
    </>
  );
}

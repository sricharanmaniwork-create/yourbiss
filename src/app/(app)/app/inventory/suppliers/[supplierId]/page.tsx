import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getInvSupplier, listInvPurchases } from '@/lib/repo';
import { deleteInvSupplier, setInvSupplierStatus } from '@/lib/actions/inventory';
import { ArchiveToggle } from '@/components/inventory/archive-toggle';
import { DeleteButton } from '@/components/inventory/delete-button';
import { SupplierForm } from '@/components/inventory/supplier-form';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, StatusBadge } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  supplierId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { supplierId } = await params;
  const supplier = await getInvSupplier(supplierId);
  return { title: supplier ? supplier.name : 'Supplier' };
}

/**
 * A supplier and everything this workspace has asked of them.
 *
 * The money figure is the sum of their orders&rsquo; lines, counted on the way in
 * rather than stored against the supplier — an order&rsquo;s value belongs to its
 * lines, and a second copy of that number on a different row is a number that can be
 * wrong without anything noticing.
 */
export default async function SupplierDetailPage({ params }: { params: Promise<Params> }) {
  const { supplierId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const supplier = await getInvSupplier(supplierId);
  if (!supplier || supplier.org_id !== orgId) notFound();

  const orders = await listInvPurchases(orgId, { supplierId: supplier.id, limit: 250 });

  const open = orders.filter((order) => order.status === 'draft' || order.status === 'ordered' || order.status === 'partially_received');
  const value = orders.reduce((sum, order) => sum + (order.total ?? 0), 0);
  const awaiting = open.reduce((sum, order) => sum + (order.outstanding_qty ?? 0), 0);
  const lastPlaced = orders[0]?.order_date ?? null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/app/inventory/suppliers"
            className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand"
          >
            ← Suppliers
          </Link>
          <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[20px] font-semibold text-ink">
            {supplier.name}
            <StatusBadge state={supplier.status} />
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {orders.length} order{orders.length === 1 ? '' : 's'} placed
            {orders.length > 0 ? ` · ${formatAmount(value, currency, locale)} between them` : ''}
            {lastPlaced ? ` · last on ${formatDateInZone(`${lastPlaced}T12:00:00Z`, 'UTC')}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2">
          <ButtonLink href="/app/inventory/purchases/new" variant="primary">
            Order from them
          </ButtonLink>
          <ArchiveToggle
            status={supplier.status}
            subject={supplier.name}
            archive={() => setInvSupplierStatus(supplier.id, 'archived')}
            restore={() => setInvSupplierStatus(supplier.id, 'active')}
          />
          {canAdmin && (
            <DeleteButton
              action={() => deleteInvSupplier(supplier.id)}
              redirectTo="/app/inventory/suppliers"
              title={`Delete ${supplier.name}?`}
              body="Any purchase order that names them has to be deleted first, and one that has received goods cannot be deleted at all. Archiving keeps their orders and the stock those orders produced intact, and is almost always what is meant."
              label="Delete supplier"
            />
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Orders" value={String(orders.length)} note="everything ever written to them" />
        <Figure
          label="Still open"
          value={String(open.length)}
          note={open.length > 0 ? 'draft, sent or part received' : 'nothing pending'}
          tone={open.length > 0 ? 'warning' : 'success'}
        />
        <Figure
          label="Goods awaited"
          value={String(awaiting)}
          note="units ordered on open orders and not yet received"
        />
        <Figure label="Total placed" value={formatAmount(value, currency, locale)} note="the sum of their orders’ lines" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid gap-4">
          <SupplierForm orgId={orgId} supplier={supplier} />

          <Card>
            <CardHeader
              title="Orders"
              description="Newest first, with what has arrived against what was asked for."
              action={
                <ButtonLink href="/app/inventory/purchases" size="sm">
                  All orders
                </ButtonLink>
              }
            />
            <CardBody className="p-0">
              {orders.length === 0 ? (
                <div className="px-4 py-5">
                  <EmptyState
                    icon={<FileText size={22} />}
                    title="Nothing ordered yet"
                    description="Their details are on file, so the first purchase order for them is one screen away."
                    action={
                      <ButtonLink href="/app/inventory/purchases/new" size="sm">
                        Write an order
                      </ButtonLink>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {orders.map((order) => (
                    <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-[180px] flex-1">
                        <Link
                          href={`/app/inventory/purchases/${order.id}`}
                          className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                        >
                          {order.number}
                        </Link>
                        <span className="block truncate text-[11.5px] text-muted">
                          {order.line_count ?? 0} line{(order.line_count ?? 0) === 1 ? '' : 's'} · placed{' '}
                          {formatDateInZone(`${order.order_date}T12:00:00Z`, 'UTC')}
                        </span>
                      </span>
                      {(order.outstanding_qty ?? 0) > 0 && (
                        <Badge tone="neutral">{order.outstanding_qty} awaited</Badge>
                      )}
                      <span className="text-[12.5px] font-semibold text-ink">
                        {formatAmount(order.total ?? 0, currency, locale)}
                      </span>
                      <StatusBadge state={order.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="Where they are" />
            <CardBody className="grid gap-2.5">
              <Line label="Contact person" value={supplier.contact} />
              <Line label="Email" value={supplier.email} />
              <Line label="Phone" value={supplier.phone} />
              <Line label="Address" value={supplier.address} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notes" />
            <CardBody>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">
                {supplier.notes || 'Nothing has been written about this supplier.'}
              </p>
              <p className="mt-3 text-[11.5px] text-muted">
                Added {formatDateInZone(supplier.created_at, zone)} · last changed{' '}
                {formatDateInZone(supplier.updated_at, zone)}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Line({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-[13px]">
      <span className="text-muted">{label}: </span>
      <span className="break-words text-ink">{value || '—'}</span>
    </p>
  );
}

function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'warning' | 'success';
}) {
  return (
    <div className="ui-card px-4 py-3.5">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</p>
      <p
        className={
          tone === 'warning'
            ? 'mt-2 text-[17px] font-semibold text-[#8a5300]'
            : tone === 'success'
              ? 'mt-2 text-[17px] font-semibold text-[#0b6b3c]'
              : 'mt-2 text-[17px] font-semibold text-ink'
        }
      >
        {value}
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{note}</p>
    </div>
  );
}

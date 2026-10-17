import type { Metadata } from 'next';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { invCounts, listInvPurchases, listInvSuppliers } from '@/lib/repo';
import { ButtonLink, Card, CardBody, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';
import type { InvPurchaseStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Purchase orders' };

const STATUSES: InvPurchaseStatus[] = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'];

/**
 * Every order written, in whatever state it reached.
 *
 * A value here is the sum of its lines, counted by the read rather than stored on the
 * header — the same arithmetic the order screen uses, so a list and a document cannot
 * report different totals for one set of boxes.
 */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; supplier?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const query = await searchParams;

  const status = (STATUSES as string[]).includes(query.status ?? '') ? (query.status as InvPurchaseStatus) : undefined;

  const [purchases, suppliers, counts] = await Promise.all([
    listInvPurchases(orgId, { status, supplierId: query.supplier || undefined, search: query.q, limit: 250 }),
    listInvSuppliers(orgId, { status: 'active', limit: 300 }),
    invCounts(orgId),
  ]);

  const filtering = !!(query.q || status || query.supplier);
  const shownValue = purchases.reduce((sum, purchase) => sum + (purchase.total ?? 0), 0);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Purchase orders</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {purchases.length} shown of what this workspace has written. {counts.purchases_open} still open, worth{' '}
            {formatAmount(counts.purchases_value, currency, locale)}, and {counts.awaiting_goods} of them have goods not
            yet arrived.
          </p>
        </div>
        <ButtonLink href="/app/inventory/purchases/new" variant="primary">
          New purchase order
        </ButtonLink>
      </div>

      <Card>
        <CardBody className="border-b border-line">
          <form
            method="get"
            className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_repeat(2,minmax(160px,auto))_auto] md:items-end"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ''}
                placeholder="Order number or note"
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Status</span>
              <select
                name="status"
                defaultValue={status ?? ''}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
              >
                <option value="">Every status</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Supplier</span>
              <select
                name="supplier"
                defaultValue={query.supplier ?? ''}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
              >
                <option value="">Anyone</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <ButtonLink href="/app/inventory/purchases" variant="ghost">
                Clear
              </ButtonLink>
              <button
                type="submit"
                className="h-9 rounded-md border border-brand bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-dark"
              >
                Filter
              </button>
            </div>
          </form>
        </CardBody>

        <CardBody className="p-0">
          {purchases.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                icon={<Truck size={22} />}
                title={filtering ? 'No order matches this' : 'No order yet'}
                description="An order starts as a draft, takes its number from the workspace's own counter, and only reaches a supplier when it is sent."
                action={
                  <ButtonLink href="/app/inventory/purchases/new" size="sm">
                    Write the first one
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Number</TH>
                <TH>Supplier</TH>
                <TH>Placed</TH>
                <TH align="right">Expected</TH>
                <TH align="right">Lines</TH>
                <TH align="right">Arrived</TH>
                <TH align="right">Value</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {purchases.map((purchase) => (
                  <TR key={purchase.id}>
                    <TD className="font-medium">
                      <Link href={`/app/inventory/purchases/${purchase.id}`} className="text-ink hover:text-brand">
                        {purchase.number}
                      </Link>
                      {purchase.notes && (
                        <span className="block max-w-[260px] truncate text-[11.5px] font-normal text-muted">
                          {purchase.notes}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Link href={`/app/inventory/suppliers/${purchase.supplier_id}`} className="text-[12.5px] hover:text-brand">
                        {purchase.supplier?.name ?? 'supplier removed'}
                      </Link>
                    </TD>
                    <TD className="text-[12px] text-ink-soft">
                      {formatDateInZone(`${purchase.order_date}T12:00:00Z`, 'UTC')}
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {purchase.expected_date ? formatDateInZone(`${purchase.expected_date}T12:00:00Z`, 'UTC') : '—'}
                    </TD>
                    <TD align="right" className="text-[12px]">
                      {purchase.line_count ?? 0}
                    </TD>
                    <TD align="right" className="text-[12px]">
                      <span className="font-medium">{purchase.received_qty ?? 0}</span>
                      <span className="text-muted">
                        /{(purchase.received_qty ?? 0) + (purchase.outstanding_qty ?? 0)} in
                      </span>
                    </TD>
                    <TD align="right" className="text-[12.5px] font-semibold">
                      {formatAmount(purchase.total ?? 0, currency, locale)}
                    </TD>
                    <TD>
                      <StatusBadge state={purchase.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        {purchases.length} order{purchases.length === 1 ? '' : 's'} listed, {formatAmount(shownValue, currency, locale)}{' '}
        between them. An order that has been sent cannot be edited — the supplier holds the same terms, and the database
        refuses a change; cancel it and order the difference instead.
      </p>
    </>
  );
}

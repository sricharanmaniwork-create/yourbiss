import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listStoreOrders, storeCounts } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';
import type { StoreOrderStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Orders' };

const STATUSES = ['placed', 'confirmed', 'fulfilled', 'cancelled'] as const;

/**
 * The order list.
 *
 * Status is a SQL predicate and payment is a null check, because both are columns; the
 * line count and the units come from a second keyed read of the lines, and the money is
 * printed straight off the order row. A list that re-added its own lines would be a
 * second opinion about a document that already has one — and would be free to disagree
 * with the total the buyer was emailed.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; paid?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const query = await searchParams;

  const status = (STATUSES as readonly string[]).includes(query.status ?? '') ? (query.status as StoreOrderStatus) : undefined;
  const paid = query.paid === 'paid' || query.paid === 'unpaid' ? query.paid : undefined;

  const [orders, counts] = await Promise.all([
    listStoreOrders(orgId, { search: query.q, status, paid }),
    storeCounts(orgId),
  ]);

  const filtering = !!(query.q || status || paid);
  const worth = orders.reduce((sum, order) => sum + Number(order.total), 0);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Orders</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {orders.length} listed · {counts.orders} not cancelled, {counts.awaiting} waiting to be confirmed and{' '}
            {counts.unpaid} still owing {formatAmount(counts.unpaid_value, currency, locale)}. What is on the shelf is
            Inventory&rsquo;s business; this list is the paperwork a visitor wrote.
          </p>
        </div>
        <ButtonLink href="/app/store/settings" variant="secondary">
          Storefront settings
        </ButtonLink>
      </div>

      <Card>
        <CardBody className="border-b border-line">
          <form
            method="get"
            className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(150px,auto))_auto_auto] md:items-end"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ''}
                placeholder="Number, name or email"
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
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Payment</span>
              <select
                name="paid"
                defaultValue={paid ?? ''}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
              >
                <option value="">Paid and unpaid</option>
                <option value="unpaid">Money still to arrive</option>
                <option value="paid">Marked paid</option>
              </select>
            </label>

            <div className="flex gap-2">
              <ButtonLink href="/app/store/orders" variant="ghost">
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
          {orders.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                icon={<ClipboardList size={22} />}
                title={filtering ? 'Nothing matches this' : 'No order yet'}
                description={
                  filtering
                    ? 'Loosen the filter — a cancelled order only appears when status is set to Cancelled or Every status.'
                    : 'An order lands here the moment a visitor checks out a cart on your website. Nothing has to be typed for it to appear.'
                }
                action={
                  counts.for_sale === 0 ? (
                    <ButtonLink href="/app/inventory/items" size="sm">
                      Put something on sale
                    </ButtonLink>
                  ) : (
                    <ButtonLink href="/app/websites" size="sm">
                      Open the website
                    </ButtonLink>
                  )
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Number</TH>
                <TH>Bought by</TH>
                <TH align="right">Lines</TH>
                <TH align="right">Units</TH>
                <TH align="right">Total</TH>
                <TH>Status</TH>
                <TH align="right">Payment</TH>
                <TH align="right">Placed</TH>
              </THead>
              <TBody>
                {orders.map((order) => (
                  <TR key={order.id}>
                    <TD className="font-medium">
                      <Link href={`/app/store/orders/${order.id}`} className="text-ink hover:text-brand">
                        {order.number}
                      </Link>
                    </TD>
                    <TD>
                      {order.buyer_name}
                      <span className="block text-[11.5px] font-normal text-muted">{order.buyer_email}</span>
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {order.line_count ?? 0}
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {order.units ?? 0}
                    </TD>
                    <TD align="right" className="text-[12.5px] font-semibold">
                      {formatAmount(Number(order.total), currency, locale)}
                      {Number(order.tax_total) > 0 && (
                        <span className="block text-[11px] font-normal text-muted">
                          incl. {formatAmount(Number(order.tax_total), currency, locale)} tax
                        </span>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge state={order.status} />
                    </TD>
                    <TD align="right">
                      {order.paid_at ? (
                        <span className="text-[12px] text-[#0b6b3c]">
                          paid {formatDateInZone(order.paid_at, zone)}
                        </span>
                      ) : order.status === 'cancelled' ? (
                        <span className="text-[12px] text-muted">—</span>
                      ) : (
                        <Badge tone="warning">not paid</Badge>
                      )}
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {formatDateInZone(order.created_at, zone)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[12px] leading-relaxed text-muted">
        <span>
          These {orders.length} {orders.length === 1 ? 'order' : 'orders'} come to{' '}
          {formatAmount(worth, currency, locale)} at the totals the shop wrote when each basket was priced.
        </span>
        <span className="text-[11.5px]">Dates are shown in {zone}.</span>
      </p>
    </>
  );
}

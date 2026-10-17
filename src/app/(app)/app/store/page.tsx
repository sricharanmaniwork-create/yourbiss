import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Banknote, ClipboardList, Globe, Package, ShoppingCart } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getStoreSettings, listSites, listStoreOrders, storeCounts } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { formatAmount, formatDateInZone, formatInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Store' };

/**
 * The shop counter.
 *
 * Every figure here is one the database already keeps: the header comes from
 * `youbiss.store_counts`, the money on an order is the total `store_place_order` wrote
 * when the basket was priced, and a quantity on the shelf is still Inventory&rsquo;s sum.
 * Nothing on this screen adds a line up again to check itself, which is the difference
 * between a hub and a second opinion.
 *
 * The one thing worth noticing is what is *not* here: there is no takings figure that
 * treats an order as paid. Payment is a timestamp an owner sets when the money actually
 * arrives, so "collected" and "ordered" are two different numbers on purpose.
 */
export default async function StoreHomePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;

  const [counts, recent, needing, unpaid, settings, sites] = await Promise.all([
    storeCounts(orgId),
    listStoreOrders(orgId, { limit: 8 }),
    listStoreOrders(orgId, { status: 'placed', limit: 6 }),
    listStoreOrders(orgId, { paid: 'unpaid', statuses: ['confirmed', 'fulfilled'], limit: 6 }),
    getStoreSettings(orgId),
    listSites(orgId),
  ]);

  const fee = Number(settings?.shipping_flat ?? 0);

  return (
    <>
      <PageHeader
        title="Store"
        description="What the website sells, the orders a visitor wrote, and what has to be confirmed, shipped and chased for money."
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/app/inventory/items?sale=1" variant="secondary">
              Items on sale
            </ButtonLink>
            <ButtonLink href="/app/store/orders" variant="primary">
              All orders
            </ButtonLink>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<ClipboardList size={16} />}
          label="Orders"
          value={String(counts.orders)}
          detail={`${counts.orders_30d} placed in the last 30 days`}
          href="/app/store/orders"
        />
        <Stat
          icon={<AlertTriangle size={16} />}
          label="Waiting on you"
          value={String(counts.awaiting)}
          detail={`${counts.open - counts.awaiting} confirmed and still to ship`}
          href="/app/store/orders?status=placed"
        />
        <Stat
          icon={<Banknote size={16} />}
          label="Ordered, not paid"
          value={formatAmount(counts.unpaid_value, currency, locale)}
          detail={`${counts.unpaid} order${counts.unpaid === 1 ? '' : 's'} with the money still to arrive`}
          href="/app/store/orders?paid=unpaid"
        />
        <Stat
          icon={<ShoppingCart size={16} />}
          label="Collected, 30 days"
          value={formatAmount(counts.collected_30d, currency, locale)}
          detail={`${formatAmount(counts.revenue_30d, currency, locale)} ordered in the same window`}
          href="/app/store/orders"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="New orders"
            description="Placed by a visitor and not confirmed yet. Confirming is what takes the goods off the shelf."
            action={
              needing.length > 0 ? (
                <ButtonLink href="/app/store/orders?status=placed" size="sm">
                  See all
                </ButtonLink>
              ) : undefined
            }
          />
          <CardBody className="p-0">
            {needing.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<ClipboardList size={22} />}
                  title={counts.orders === 0 ? 'No order has come in yet' : 'Nothing is waiting for a decision'}
                  description={
                    counts.orders === 0
                      ? 'Put a product grid and a cart on a page of your website, publish it, and the shop is open. A basket only becomes an order when a visitor leaves an address.'
                      : 'Every order here has been confirmed, shipped or called off. A new one appears the moment somebody checks out.'
                  }
                  action={
                    sites.length > 0 ? (
                      <ButtonLink href={`/app/websites/${sites[0]?.id}`} size="sm">
                        Open the website
                      </ButtonLink>
                    ) : (
                      <ButtonLink href="/app/websites" size="sm">
                        Build a site
                      </ButtonLink>
                    )
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {needing.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link
                        href={`/app/store/orders/${order.id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {order.number}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        {order.buyer_name} · {order.line_count ?? 0} line{(order.line_count ?? 0) === 1 ? '' : 's'} ·{' '}
                        {formatInZone(order.created_at, zone, { hour: '2-digit', minute: '2-digit' })}{' '}
                        {formatDateInZone(order.created_at, zone)}
                      </span>
                    </span>
                    <span className="text-[12.5px] font-semibold text-ink">
                      {formatAmount(Number(order.total), currency, locale)}
                    </span>
                    <StatusBadge state={order.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Confirmed or shipped, still owed"
            description="The goods have gone or are going; the money has not landed yet. Payment is marked by hand, because nothing takes it automatically."
            action={
              unpaid.length > 0 ? (
                <ButtonLink href="/app/store/orders?paid=unpaid" size="sm">
                  See all
                </ButtonLink>
              ) : undefined
            }
          />
          <CardBody className="p-0">
            {unpaid.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<Banknote size={22} />}
                  title="Nothing is owed"
                  description="An order that leaves the shelf with the money still to come is listed here until somebody marks it paid."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {unpaid.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link
                        href={`/app/store/orders/${order.id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {order.buyer_name}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        {order.number} · {order.status.replace(/_/g, ' ')}{' '}
                        {formatDateInZone(order.updated_at, zone)}
                      </span>
                    </span>
                    <Badge tone="warning">{formatAmount(Number(order.total), currency, locale)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          title={`${counts.for_sale} item${counts.for_sale === 1 ? '' : 's'} on sale`}
          body="A shop sells exactly the items that are switched on for the storefront, one at a time, out of Inventory's list. Nothing appears in a cart until it is turned on."
          href="/app/inventory/items?sale=1"
        />
        <Tile
          title={`Delivery at ${formatAmount(fee, currency, locale)}`}
          body={
            fee > 0
              ? 'One flat fee added to every basket, whatever is in it. Set it on the Storefront tab.'
              : 'Nothing is added for delivery right now. A flat fee per order is set on the Storefront tab.'
          }
          href="/app/store/settings"
        />
        <Tile
          title={`${counts.sellable_untracked} sold without a count`}
          body="Services and uncounted products can be ordered as many times as a visitor likes, because there is no shelf for them to run out of."
          href="/app/inventory/items"
        />
        <Tile
          title="Where the cart lives"
          body={
            sites.length > 0
              ? `A product grid and a cart block sit on ${sites[0]?.name}, built from the same canvas as the rest of the site.`
              : 'A website comes first: the storefront is two blocks on a page, not a separate shop to deploy.'
          }
          href={sites.length > 0 ? `/app/websites/${sites[0]?.id}` : '/app/websites'}
        />
      </div>

      {recent.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="The last orders"
            description="Whatever a visitor left, newest first — the whole list is one click away."
            action={
              <ButtonLink href="/app/store/orders" size="sm">
                All orders
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {recent.map((order) => (
                <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="min-w-[180px] flex-1">
                    <Link
                      href={`/app/store/orders/${order.id}`}
                      className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                    >
                      {order.number} · {order.buyer_name}
                    </Link>
                    <span className="block truncate text-[11.5px] text-muted">
                      {order.units ?? 0} unit{(order.units ?? 0) === 1 ? '' : 's'} ·{' '}
                      {order.paid_at ? `paid ${formatDateInZone(order.paid_at, zone)}` : 'not paid yet'}
                    </span>
                  </span>
                  <span className="text-[12.5px] font-semibold text-ink">
                    {formatAmount(Number(order.total), currency, locale)}
                  </span>
                  <StatusBadge state={order.status} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <Package size={14} className="mt-0.5 flex-none" aria-hidden="true" />
        A visitor&rsquo;s cart sends item ids and quantities and nothing else. The price, the tax and the delivery fee
        are read from this workspace when the order is written, and the stock a confirmed order takes is the same
        ledger every other Inventory screen reads.
      </p>

      <p className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <Globe size={14} className="mt-0.5 flex-none" aria-hidden="true" />
        Dates and times are shown in {zone}. An order&rsquo;s number is issued by the same counter the purchase orders
        use, so two documents in one workspace never share a reference.
      </p>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="ui-card block px-4 py-3.5 transition-colors hover:bg-raised">
      <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-[17px] font-semibold text-ink">{value}</p>
      <p className="mt-1 truncate text-[11.5px] text-muted">{detail}</p>
    </Link>
  );
}

function Tile({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link href={href} className="ui-card block px-4 py-3.5 transition-colors hover:bg-raised">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
    </Link>
  );
}

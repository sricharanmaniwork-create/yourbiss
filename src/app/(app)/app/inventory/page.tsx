import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowDownLeft, Boxes, Package, Truck, Users } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { invCounts, isLowStock, listInvItems, listInvMovements, listInvPurchases } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inventory' };

/**
 * The stockroom hub.
 *
 * Every quantity here is the ledger's own sum: the four header numbers come from
 * `youbiss.inv_counts` and the two problem lists come from the same grouped read the
 * item page uses, so a shelf that says 3 here says 3 when it is clicked. Nothing is
 * estimated, and nothing that looks like stock is stored in a column that could fall
 * out of step with the movements underneath it.
 */
export default async function InventoryHomePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;

  const [counts, activeItems, awaiting, movements] = await Promise.all([
    invCounts(orgId),
    listInvItems(orgId, { status: 'active' }),
    listInvPurchases(orgId, { statuses: ['ordered', 'partially_received'], limit: 6 }),
    listInvMovements(orgId, { limit: 8 }),
  ]);

  // Both panels come off one read of the list, so an item cannot be in one and missing
  // from the other, and the header number is the two panels added — which is what a
  // pair of separate counts would not be, because an empty shelf is also a low one.
  const empty = activeItems.filter((item) => item.track_stock && item.stock.on_hand <= 0);
  const needsOrdering = activeItems.filter((item) => isLowStock(item) && item.stock.on_hand > 0);
  const short = empty.length + needsOrdering.length;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="What is on the shelf, what it is worth, who supplies it, and what has been ordered and has not arrived."
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/app/inventory/items/new" variant="secondary">
              Add an item
            </ButtonLink>
            <ButtonLink href="/app/inventory/purchases/new" variant="primary">
              New purchase order
            </ButtonLink>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Boxes size={16} />}
          label="Active items"
          value={String(counts.items)}
          detail={`${counts.products} products · ${counts.services} services · ${counts.tracked} counted`}
          href="/app/inventory/items"
        />
        <Stat
          icon={<Package size={16} />}
          label="Stock value"
          value={formatAmount(counts.stock_value, currency, locale)}
          detail="the units on hand valued at each item's cost"
          href="/app/inventory/items"
        />
        <Stat
          icon={<AlertTriangle size={16} />}
          label="Needs ordering"
          value={String(short)}
          detail={`${empty.length} with nothing left`}
          href="/app/inventory/items"
        />
        <Stat
          icon={<Truck size={16} />}
          label="Ordered, not arrived"
          value={String(counts.awaiting_goods)}
          detail={`${counts.purchases_open} open orders worth ${formatAmount(counts.purchases_value, currency, locale)}`}
          href="/app/inventory/purchases"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Nothing left"
            description="Counted items at zero. They stay in the list until they are archived, because the movements underneath them are history."
            action={
              <ButtonLink href="/app/inventory/items?out=1" size="sm">
                See all
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            {empty.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<Package size={22} />}
                  title="Every counted item has something on the shelf"
                  description="A quantity here is the sum of the ledger for that item, so it can only change by an entry being added — never by typing over a number."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {empty.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link
                        href={`/app/inventory/items/${item.id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {item.name}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        {item.sku ?? 'no code'} ·{' '}
                        {item.stock.last_movement_at
                          ? `last moved ${formatDateInZone(item.stock.last_movement_at, zone)}`
                          : 'nothing has moved it yet'}
                      </span>
                    </span>
                    <Badge tone="danger">0 {item.unit}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Under the level you set"
            description={
              needsOrdering.length === 0
                ? 'A reorder point is a number you decide, and an item without one is never listed here.'
                : `${needsOrdering.length} item${needsOrdering.length === 1 ? '' : 's'} at or below their reorder point.`
            }
            action={
              <ButtonLink href="/app/inventory/items?low=1" size="sm">
                See all
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            {needsOrdering.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<AlertTriangle size={22} />}
                  title="Nothing is running short"
                  description="Set a reorder point on an item and it appears here as soon as the ledger drops to it."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {needsOrdering.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link
                        href={`/app/inventory/items/${item.id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {item.name}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        reorder at {item.reorder_point} {item.unit}
                      </span>
                    </span>
                    <Badge tone="warning">
                      {item.stock.on_hand} {item.unit}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Goods on order"
            description="Sent to a supplier and not fully arrived, most recently placed first."
            action={
              <ButtonLink href="/app/inventory/purchases" size="sm">
                All orders
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            {awaiting.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<Truck size={22} />}
                  title="Nothing is on its way"
                  description="An order is a draft until it is sent. Sending it freezes its lines and starts the wait for the goods."
                  action={
                    <ButtonLink href="/app/inventory/purchases/new" size="sm">
                      Write one
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {awaiting.map((purchase) => (
                  <li key={purchase.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link
                        href={`/app/inventory/purchases/${purchase.id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {purchase.number}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        {purchase.supplier?.name ?? 'supplier gone'} ·{' '}
                        {purchase.expected_date ? `due ${formatDateInZone(purchase.expected_date, zone)}` : 'no date given'}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-muted">{purchase.outstanding_qty ?? 0} awaiting</span>
                    <StatusBadge state={purchase.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="The ledger"
            description={`${counts.movements_30d} entries in the last 30 days, ${counts.receipts_30d} of them goods arriving.`}
          />
          <CardBody className="p-0">
            {movements.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<ArrowDownLeft size={22} />}
                  title="No movement yet"
                  description="Count what is already on the shelves with an opening entry, and every change after that writes itself."
                  action={
                    <ButtonLink href="/app/inventory/items" size="sm">
                      Pick an item
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {movements.map((movement) => (
                  <li key={movement.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link
                        href={`/app/inventory/items/${movement.item_id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {movement.item?.name ?? 'an item'}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        {movement.reason.replace(/_/g, ' ')}
                        {movement.reference ? ` · ${movement.reference}` : ''} ·{' '}
                        {formatDateInZone(movement.created_at, zone)}
                      </span>
                    </span>
                    <span
                      className={
                        movement.delta >= 0
                          ? 'text-[12.5px] font-semibold text-[#0b6b3c]'
                          : 'text-[12.5px] font-semibold text-[#a50f0f]'
                      }
                    >
                      {movement.delta >= 0 ? '+' : ''}
                      {movement.delta} {movement.item?.unit ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          title="Items"
          body={`${counts.tracked} of them keep a count. A service is on the same list because it is sold on the same documents — it just has no shelf to run out of.`}
          href="/app/inventory/items"
        />
        <Tile
          title="Purchase orders"
          body="What was asked of a supplier, and how much of it has actually arrived. Goods enter the shelf through an order or a manual entry, never by editing a quantity."
          href="/app/inventory/purchases"
        />
        <Tile
          title="Suppliers"
          body={`${counts.suppliers} on file. Each one carries the orders they were sent, so a history is one click away rather than a search.`}
          href="/app/inventory/suppliers"
        />
        <Tile
          title="Switched off, not deleted"
          body="An item that stops being sold is archived: it leaves the lists and keeps every movement and every line it is named on. Turn Inventory off in Settings and the data stays."
          href="/app/settings/apps"
        />
      </div>

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <Users size={14} className="mt-0.5 flex-none" aria-hidden="true" />
        Stock is written by everybody in the workspace who can see the app; only an owner or admin can delete a row, and
        the database refuses a delete that would break a document somebody already relied on.
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

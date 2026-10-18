import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Boxes, PackageCheck, Phone, User } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getStoreOrder, listOrderMovements } from '@/lib/repo';
import { deleteStoreOrder } from '@/lib/actions/store';
import { DeleteButton } from '@/components/inventory/delete-button';
import { OrderActions } from '@/components/store/order-actions';
import { Badge, Card, CardBody, CardHeader, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatAmount, formatDateInZone, formatInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  orderId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { orderId } = await params;
  const detail = await getStoreOrder(orderId);
  return { title: detail ? `Order ${detail.order.number}` : 'Order' };
}

/**
 * One order, exactly as the checkout wrote it.
 *
 * Every number on this screen is read off the document, not worked out again: the line
 * carries the price and tax rate the item held at that moment, and the total is the
 * column the database generated from them. That is what makes a receipt a buyer received
 * and a screen an owner reads say the same thing a year later, after the item has been
 * renamed, repriced or archived.
 *
 * The stock entries underneath it are shown separately, because they are a different
 * fact: an order says what was asked for, and the ledger says what actually left the
 * shelf — which only happens once the order is confirmed.
 */
export default async function OrderDetailPage({ params }: { params: Promise<Params> }) {
  const { orderId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const detail = await getStoreOrder(orderId);
  if (!detail || detail.order.org_id !== orgId) notFound();

  const { order, lines } = detail;
  const movements = await listOrderMovements(orgId, order.number);

  const trackedLines = lines.filter((line) => line.item?.track_stock).length;
  const units = lines.reduce((sum, line) => sum + Number(line.qty), 0);
  const paidLabel = order.paid_at ? formatDateInZone(order.paid_at, zone) : null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/store/orders" className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand">
            ← Orders
          </Link>
          <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[20px] font-semibold text-ink">
            {order.number}
            <StatusBadge state={order.status} />
            {order.paid_at ? <Badge tone="success">paid</Badge> : order.status === 'cancelled' ? null : <Badge tone="warning">not paid</Badge>}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Placed {formatInZone(order.created_at, zone, { hour: '2-digit', minute: '2-digit' })}{' '}
            {formatDateInZone(order.created_at, zone)} by{' '}
            <Link href={`mailto:${order.buyer_email}`} className="text-brand hover:text-brand-dark">
              {order.buyer_email}
            </Link>
            {order.contact ? (
              <>
                {' · '}
                <Link href={`/app/crm/contacts/${order.contact.id}`} className="hover:text-brand">
                  a contact in CRM
                </Link>
              </>
            ) : (
              ''
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-3">
          <OrderActions
            orderId={order.id}
            number={order.number}
            status={order.status}
            paidLabel={paidLabel}
            trackedLines={trackedLines}
          />
          {canAdmin && order.status === 'placed' && (
            <DeleteButton
              action={deleteStoreOrder}
              id={order.id}
              redirectTo="/app/store/orders"
              title={`Delete ${order.number}?`}
              body="Only an order nobody has confirmed can be erased, because nothing has moved on its account yet. Anything else stays: a cancelled order is a record that a person asked, and deleting it would leave the shelf with an entry no document explains."
              label="Delete order"
            />
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Total" value={formatAmount(Number(order.total), currency, locale)} note="the sum of the lines, plus delivery" />
        <Figure
          label="Lines"
          value={String(lines.length)}
          note={`${units} unit${units === 1 ? '' : 's'} ordered`}
        />
        <Figure
          label="Moved on the shelf"
          value={String(movements.length)}
          note={
            order.status === 'placed'
              ? 'confirming is what takes the goods out'
              : order.status === 'cancelled'
                ? 'a cancellation puts counted lines back'
                : 'entries the ledger holds for this order'
          }
          tone={order.status === 'placed' ? 'warning' : undefined}
        />
        <Figure
          label="Owed"
          value={order.paid_at || order.status === 'cancelled' ? formatAmount(0, currency, locale) : formatAmount(Number(order.total), currency, locale)}
          note={
            order.paid_at
              ? `marked paid ${paidLabel}${order.paid_via ? ` by ${order.paid_via.replace(/_/g, ' ')}` : ''}`
              : order.status === 'cancelled'
                ? 'nothing is owed on a called-off order'
                : 'recorded by hand when the money arrives'
          }
          tone={order.paid_at || order.status === 'cancelled' ? 'success' : 'warning'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="What was ordered"
              description="Each line holds the name, price and tax rate the item carried at the moment the basket was priced."
            />
            <CardBody className="p-0">
              {lines.length === 0 ? (
                <div className="px-4 py-5">
                  <EmptyState
                    icon={<Boxes size={22} />}
                    title="This order has no lines"
                    description="An order is only ever written with at least one, so an empty document here means the lines were removed by hand."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TH>Item</TH>
                    <TH align="right">Quantity</TH>
                    <TH align="right">Price</TH>
                    <TH align="right">Tax</TH>
                    <TH align="right">Line total</TH>
                  </THead>
                  <TBody>
                    {lines.map((line) => (
                      <TR key={line.id}>
                        <TD className="font-medium">
                          {line.item ? (
                            <Link
                              href={`/app/inventory/items/${line.item_id}`}
                              className="text-ink hover:text-brand"
                            >
                              {line.description}
                            </Link>
                          ) : (
                            line.description
                          )}
                          <span className="block text-[11.5px] font-normal text-muted">
                            {line.item?.sku ?? 'no code'}
                            {line.item && !line.item.sell_online ? ' · not on sale now' : ''}
                            {line.item && !line.item.track_stock ? ' · never counted' : ''}
                          </span>
                        </TD>
                        <TD align="right">
                          {line.qty} {line.item?.unit ?? ''}
                        </TD>
                        <TD align="right" className="text-[12px]">
                          {formatAmount(Number(line.unit_price), currency, locale)}
                        </TD>
                        <TD align="right" className="text-[12px] text-muted">
                          {Number(line.tax_rate_pct)}% · {formatAmount(Number(line.tax_amount), currency, locale)}
                        </TD>
                        <TD align="right" className="text-[12.5px] font-semibold">
                          {formatAmount(Number(line.total), currency, locale)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What left the shelf" description="The ledger entries this order is answerable for, matched by its number." />
            <CardBody className="p-0">
              {movements.length === 0 ? (
                <div className="px-4 py-5">
                  <EmptyState
                    icon={<PackageCheck size={22} />}
                    title={order.status === 'placed' ? 'Nothing has moved yet' : 'No stock entry for this order'}
                    description={
                      order.status === 'placed'
                        ? 'Confirming the order writes one entry per counted line, and refuses the whole move if a shelf is short. Until then, this document is a request.'
                        : 'No line on this order is counted in Inventory, so there was nothing for it to move.'
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {movements.map((movement) => (
                    <li key={movement.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link
                          href={`/app/inventory/items/${movement.item_id}`}
                          className="min-w-[140px] flex-1 truncate text-[13px] font-medium text-ink hover:text-brand"
                        >
                          {movement.item?.name ?? 'an item'}
                        </Link>
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
                        <Badge tone={movement.reason === 'sale' ? 'neutral' : 'brand'}>
                          {movement.reason.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] text-muted">
                        {movement.reference} · {formatDateInZone(movement.created_at, zone)} ·{' '}
                        {movement.author?.display_name ?? movement.author?.email ?? 'the system'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="The money" description="Read off the order — the same figures the buyer’s receipt was written from." />
            <CardBody>
              <dl className="grid gap-2 text-[13px]">
                <Row label="Lines" value={formatAmount(Number(order.subtotal), currency, locale)} />
                <Row label="Delivery" value={formatAmount(Number(order.shipping), currency, locale)} />
                <Row label="Tax" value={formatAmount(Number(order.tax_total), currency, locale)} />
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
                  <dt className="text-[13px] font-semibold text-ink">Total</dt>
                  <dd className="text-[15px] font-semibold text-ink">
                    {formatAmount(Number(order.total), currency, locale)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                {order.paid_at
                  ? `Paid ${paidLabel}${order.paid_via ? ` by ${order.paid_via.replace(/_/g, ' ')}` : ''}.`
                  : 'No payment recorded. Money that arrives by bank, UPI or cash is marked here by whoever receives it.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Who it goes to" />
            <CardBody>
              <p className="flex items-start gap-2 text-[13px] font-medium text-ink">
                <User size={14} className="mt-1 flex-none text-muted" aria-hidden="true" />
                {order.buyer_name}
              </p>
              {order.buyer_phone && (
                <p className="mt-1.5 flex items-start gap-2 text-[13px] text-ink-soft">
                  <Phone size={14} className="mt-1 flex-none text-muted" aria-hidden="true" />
                  {order.buyer_phone}
                </p>
              )}
              <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">{order.ship_address}</p>
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                Frozen the moment the order was written: a delivery address can be corrected while an order is still
                placed, and not after.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What the buyer said" />
            <CardBody>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">
                {order.notes || 'Nothing was written with this order.'}
              </p>
              <p className="mt-3 text-[11.5px] text-muted">
                Opened {formatDateInZone(order.created_at, zone)} · last touched {formatDateInZone(order.updated_at, zone)}
              </p>
            </CardBody>
          </Card>

          {order.status !== 'placed' && (
            <Card>
              <CardBody>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  This order has been {order.status === 'cancelled' ? 'called off' : order.status}. Its number, its
                  lines and its totals are what the buyer was emailed, and the database will refuse a change to any of
                  them. What can still happen is the money being marked, and an entry added to the ledger.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
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
      <p className="mt-2 flex items-baseline gap-2">
        <span
          className={
            tone === 'warning'
              ? 'text-[17px] font-semibold text-[#8a5300]'
              : tone === 'success'
                ? 'text-[17px] font-semibold text-[#0b6b3c]'
                : 'text-[17px] font-semibold text-ink'
          }
        >
          {value}
        </span>
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{note}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-ink-soft">{label}</dt>
      <dd className="text-[12.5px] font-medium text-ink">{value}</dd>
    </div>
  );
}

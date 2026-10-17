import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PackageCheck } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getInvPurchase, listInvItems, listInvMovements, listInvSuppliers } from '@/lib/repo';
import { deleteInvPurchase } from '@/lib/actions/inventory';
import { DeleteButton } from '@/components/inventory/delete-button';
import { PurchaseActions } from '@/components/inventory/purchase-actions';
import { PurchaseForm } from '@/components/inventory/purchase-form';
import { PurchaseLines } from '@/components/inventory/purchase-lines';
import { Badge, Card, CardBody, CardHeader, EmptyState, StatusBadge } from '@/components/ui';
import { formatAmount, formatDateInZone, dateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  purchaseId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { purchaseId } = await params;
  const detail = await getInvPurchase(purchaseId);
  return { title: detail ? `Purchase ${detail.purchase.number}` : 'Purchase order' };
}

/**
 * One order, its lines and what arrived against them.
 *
 * The header, the lines and the status are three different things read from three
 * different places, and only the last of them is derived: the status column holds what
 * the lines add up to, which is why there is no status field on this screen. Goods get
 * onto a shelf through the Receive control alone, because that is the one path that
 * writes the ledger entry and the line&rsquo;s received quantity in the same decision.
 */
export default async function PurchaseDetailPage({ params }: { params: Promise<Params> }) {
  const { purchaseId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const detail = await getInvPurchase(purchaseId);
  if (!detail || detail.purchase.org_id !== orgId) notFound();

  const { purchase, lines } = detail;

  const [items, suppliers, receipts] = await Promise.all([
    listInvItems(orgId, { status: 'active', limit: 500 }),
    listInvSuppliers(orgId, { limit: 300 }),
    listInvMovements(orgId, { reason: 'purchase', limit: 200 }),
  ]);

  const lineIds = new Set(lines.map((line) => line.id));
  const againstThis = receipts.filter((movement) => movement.purchase_line_id && lineIds.has(movement.purchase_line_id));

  const ordered = lines.reduce((sum, line) => sum + Number(line.qty), 0);
  const arrived = lines.reduce((sum, line) => sum + Number(line.received_qty), 0);
  const short = ordered - arrived;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/app/inventory/purchases"
            className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand"
          >
            ← Purchase orders
          </Link>
          <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[20px] font-semibold text-ink">
            {purchase.number}
            <StatusBadge state={purchase.status} />
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            <Link href={`/app/inventory/suppliers/${purchase.supplier_id}`} className="hover:text-brand">
              {purchase.supplier?.name ?? 'a supplier no longer on file'}
            </Link>
            {purchase.supplier?.contact ? ` · ${purchase.supplier.contact}` : ''} · placed{' '}
            {formatDateInZone(`${purchase.order_date}T12:00:00Z`, 'UTC')}
            {purchase.expected_date
              ? ` · due ${formatDateInZone(`${purchase.expected_date}T12:00:00Z`, 'UTC')}`
              : ' · no delivery date given'}
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-3">
          <PurchaseActions
            purchaseId={purchase.id}
            status={purchase.status}
            lineCount={lines.length}
            number={purchase.number}
          />
          {canAdmin && (
            <DeleteButton
              action={() => deleteInvPurchase(purchase.id)}
              redirectTo="/app/inventory/purchases"
              title={`Delete ${purchase.number}?`}
              body="An order with goods received on it cannot be deleted, and should not be: those movements are the reason the shelf holds what it holds. Cancel it instead, and the history stays readable."
              label="Delete order"
            />
          )}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Lines" value={String(lines.length)} note={purchase.status === 'draft' ? 'still editable' : 'frozen with the order'} />
        <Figure
          label="Ordered"
          value={String(ordered)}
          note={`${lines.reduce((sum, line) => sum + Number(line.received_qty), 0)} already arrived`}
        />
        <Figure
          label="Still to come"
          value={String(short)}
          note={short > 0 ? 'goods the supplier has not delivered' : 'everything is in'}
          tone={short > 0 ? 'warning' : 'success'}
        />
        <Figure
          label="Value"
          value={formatAmount(purchase.total ?? 0, currency, locale)}
          note="the sum of the lines"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <PurchaseForm
            orgId={orgId}
            purchase={purchase}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
            today={dateInZone(new Date(), zone)}
          />

          <PurchaseLines
            purchaseId={purchase.id}
            status={purchase.status}
            items={items.map((item) => ({ id: item.id, name: item.name, unit: item.unit, cost: item.cost }))}
            lines={lines}
            currency={currency}
            locale={locale}
          />
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="What arrived against it"
              description="Every entry these lines put on a shelf, in the order they were recorded."
            />
            <CardBody className="p-0">
              {againstThis.length === 0 ? (
                <div className="px-4 py-5">
                  <EmptyState
                    icon={<PackageCheck size={22} />}
                    title="Nothing has come in yet"
                    description="Receiving is per line, and each receipt writes one entry onto the item's ledger. Until then, the shelf is unchanged."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {againstThis.map((movement) => (
                    <li key={movement.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link
                          href={`/app/inventory/items/${movement.item_id}`}
                          className="min-w-[140px] flex-1 truncate text-[13px] font-medium text-ink hover:text-brand"
                        >
                          {movement.item?.name ?? 'an item'}
                        </Link>
                        <Badge tone="success">
                          +{movement.delta} {movement.item?.unit ?? ''}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] text-muted">
                        {formatAmount(movement.unit_cost ?? 0, currency, locale)} each ·{' '}
                        {formatDateInZone(movement.created_at, zone)} ·{' '}
                        {movement.author?.display_name ?? movement.author?.email ?? 'the system'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notes on the order" />
            <CardBody>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">
                {purchase.notes || 'Nothing was written when this was placed.'}
              </p>
              <p className="mt-3 text-[11.5px] text-muted">
                Opened {formatDateInZone(purchase.created_at, zone)}
                {purchase.created_by ? ' by a member of this workspace' : ''} · last touched{' '}
                {formatDateInZone(purchase.updated_at, zone)}
              </p>
            </CardBody>
          </Card>

          {purchase.status !== 'draft' && (
            <Card>
              <CardBody>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  This order has been sent. Its number, supplier, dates and lines are what the supplier was given, and
                  the database will refuse a change to any of them. What can still happen is goods arriving.
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

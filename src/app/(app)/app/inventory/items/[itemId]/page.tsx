import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, History } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getInvItem, isLowStock, listInvMovements } from '@/lib/repo';
import { deleteInvItem, setInvItemStatus } from '@/lib/actions/inventory';
import { ArchiveToggle } from '@/components/inventory/archive-toggle';
import { DeleteButton } from '@/components/inventory/delete-button';
import { ItemForm } from '@/components/inventory/item-form';
import { MovementForm } from '@/components/inventory/movement-form';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, StatusBadge } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  itemId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { itemId } = await params;
  const item = await getInvItem(itemId);
  return { title: item ? item.name : 'Item' };
}

/**
 * One item, its shelf and the entries that made it.
 *
 * The quantity at the top and the running total underneath are the same grouped sum
 * read twice from the same function, so the screen cannot show a number its own
 * history refutes. There is no way to set the quantity here: an error is corrected by
 * the opposite entry, which keeps the story of how the shelf got to where it is.
 */
export default async function ItemDetailPage({ params }: { params: Promise<Params> }) {
  const { itemId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const storeEnabled = workspace.apps.store === true;

  const item = await getInvItem(itemId);
  if (!item || item.org_id !== orgId) notFound();

  const movements = await listInvMovements(orgId, { itemId: item.id, limit: 60 });

  const signed = (delta: number) => `${delta >= 0 ? '+' : ''}${delta}`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/inventory/items" className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand">
            ← Items
          </Link>
          <h1 className="text-[20px] font-semibold text-ink">{item.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <StatusBadge state={item.status} />
            <Badge tone={item.kind === 'product' ? 'neutral' : 'brand'}>{item.kind}</Badge>
            {item.sell_online && <Badge tone={storeEnabled ? 'success' : 'warning'}>on the storefront</Badge>}
            <span>
              {item.sku ?? 'no code'} · sells at {formatAmount(item.price, currency, locale)}
              {item.tax_rate_pct > 0 ? ` plus ${item.tax_rate_pct}% tax` : ''} · costs{' '}
              {formatAmount(item.cost, currency, locale)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/app/inventory/purchases/new" variant="primary">
            Order more
            <ArrowRight size={14} aria-hidden="true" />
          </ButtonLink>
          <ArchiveToggle
            status={item.status}
            subject={item.name}
            id={item.id}
            setStatus={setInvItemStatus}
          />
          {canAdmin && (
            <DeleteButton
              action={deleteInvItem}
              id={item.id}
              redirectTo="/app/inventory/items"
              title={`Delete ${item.name}?`}
              body="The database will refuse this while the item has stock history or appears on a purchase order, and it is right to: those are records of things that happened. Archiving takes it out of the lists and keeps everything."
              label="Delete item"
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid gap-4">
          <Card>
            <CardHeader
              title={item.track_stock ? 'On the shelf' : 'Not counted'}
              description={
                item.track_stock
                  ? 'A sum of every entry below. Nothing on this screen can change it directly.'
                  : 'A service, or a product this workspace has decided not to keep a count of. It can still be ordered and sold.'
              }
            />
            <CardBody>
              {item.track_stock ? (
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <p
                      className={
                        item.stock.on_hand <= 0
                          ? 'text-[30px] font-semibold leading-none text-[#a50f0f]'
                          : isLowStock(item)
                            ? 'text-[30px] font-semibold leading-none text-[#8a5300]'
                            : 'text-[30px] font-semibold leading-none text-ink'
                      }
                    >
                      {item.stock.on_hand}
                      <span className="ml-1.5 text-[13px] font-medium text-muted">{item.unit}</span>
                    </p>
                    <p className="mt-1.5 text-[12px] text-muted">
                      {item.stock.movements} ledger entr{item.stock.movements === 1 ? 'y' : 'ies'}
                      {item.stock.last_movement_at ? `, last ${formatDateInZone(item.stock.last_movement_at, zone)}` : ''}
                    </p>
                  </div>

                  {isLowStock(item) && (
                    <p className="max-w-[280px] rounded-md border border-[#f3ddb0] bg-[#fdf3e0] px-3 py-2 text-[12.5px] leading-relaxed text-[#8a5300]">
                      At or under the reorder point of {item.reorder_point} {item.unit}. Worth putting on a purchase
                      order.
                    </p>
                  )}

                  <p className="text-[12.5px] text-muted">
                    At the cost on file of {formatAmount(item.cost, currency, locale)}, that is{' '}
                    <span className="font-semibold text-ink">
                      {formatAmount(item.stock.on_hand * item.cost, currency, locale)}
                    </span>{' '}
                    of stock.
                  </p>
                </div>
              ) : (
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  Purchase orders can still name this item, and a receipt against them will not move a shelf.
                </p>
              )}
            </CardBody>
          </Card>

          <ItemForm orgId={orgId} item={item} hasHistory={item.stock.movements > 0} storeEnabled={storeEnabled} />

          <Card>
            <CardHeader title="Description" />
            <CardBody>
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-soft">
                {item.description || 'Nobody has written what this is yet.'}
              </p>
              {item.image_url && (
                <img src={item.image_url} alt="" className="mt-3 max-h-[220px] w-auto rounded-md border border-line" />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          {item.track_stock && (
            <Card>
              <CardHeader
                title="Add to the ledger"
                description="Opening counts, goods sold, returns and corrections. A purchase that arrived is recorded on its order, not here."
              />
              <CardBody>
                <MovementForm
                  itemId={item.id}
                  unit={item.unit}
                  onHand={item.stock.on_hand}
                  trackStock={item.track_stock}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Every entry"
              description="Newest first. An entry never changes once it is written, so this list is also the audit."
            />
            <CardBody className="p-0">
              {movements.length === 0 ? (
                <div className="px-4 py-5">
                  <EmptyState
                    icon={<History size={22} />}
                    title="No entry yet"
                    description={
                      item.track_stock
                        ? 'Count what is physically there with an opening entry, and the shelf starts from that.'
                        : 'This item is not counted, so nothing will appear here.'
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {movements.map((movement) => (
                    <li key={movement.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span
                          className={
                            movement.delta >= 0
                              ? 'min-w-[70px] text-[13.5px] font-semibold text-[#0b6b3c]'
                              : 'min-w-[70px] text-[13.5px] font-semibold text-[#a50f0f]'
                          }
                        >
                          {signed(movement.delta)} {movement.item?.unit ?? item.unit}
                        </span>
                        <span className="text-[11.5px] uppercase tracking-[0.04em] text-muted">
                          {movement.reason.replace(/_/g, ' ')}
                        </span>
                        {movement.unit_cost !== null && (
                          <span className="text-[11.5px] text-muted">
                            at {formatAmount(movement.unit_cost, currency, locale)}
                          </span>
                        )}
                        <span className="ml-auto text-[11.5px] text-muted">
                          {formatDateInZone(movement.created_at, zone)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-muted">
                        {movement.reference ? `${movement.reference} · ` : ''}
                        {movement.author?.display_name ?? movement.author?.email ?? 'the system'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

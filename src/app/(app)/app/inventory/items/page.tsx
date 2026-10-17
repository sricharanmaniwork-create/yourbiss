import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { invCounts, isLowStock, listInvItems } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';
import type { InvItemKind } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Items' };

const KINDS = ['product', 'service'] as const;

/**
 * The item list.
 *
 * The quantity column is the only number on this page that moves, and it is the
 * ledger&rsquo;s sum, read through the same function the hub and the item screen use.
 * "Needs ordering" and "nothing left" cannot be SQL predicates for the same reason,
 * so they narrow the rows after the read — the alternative is a second implementation
 * of a sum, which is how a stock list starts disagreeing with the shelf.
 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; status?: string; low?: string; out?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const query = await searchParams;

  const status = query.status === 'archived' ? 'archived' : query.status === 'all' ? undefined : 'active';
  const kind = (KINDS as readonly string[]).includes(query.kind ?? '') ? (query.kind as InvItemKind) : undefined;

  const [items, counts] = await Promise.all([
    listInvItems(orgId, {
      search: query.q,
      kind,
      status,
      lowOnly: query.low === '1',
      outOnly: query.out === '1',
    }),
    invCounts(orgId),
  ]);

  const filtering = !!(query.q || kind || query.low === '1' || query.out === '1' || query.status);
  const totalOnShelf = items
    .filter((item) => item.track_stock)
    .reduce((sum, item) => sum + item.stock.on_hand, 0);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Items</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {items.length} listed · {counts.items} active, {counts.tracked} of them keep a count. Their quantities are the
            ledger&rsquo;s, not a field, and together the counted rows below are {totalOnShelf} units on the shelf.
          </p>
        </div>
        <ButtonLink href="/app/inventory/items/new" variant="primary">
          Add an item
        </ButtonLink>
      </div>

      <Card>
        <CardBody className="border-b border-line">
          <form
            method="get"
            className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(140px,auto))_auto_auto] md:items-end"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ''}
                placeholder="Name or code"
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Type</span>
              <select
                name="kind"
                defaultValue={kind ?? ''}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
              >
                <option value="">Products and services</option>
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Status</span>
              <select
                name="status"
                defaultValue={query.status ?? 'active'}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">Everything</option>
              </select>
            </label>

            <div className="flex flex-wrap gap-2">
              <Check name="low" on={query.low === '1'} label="Needs ordering" />
              <Check name="out" on={query.out === '1'} label="Nothing left" />
            </div>

            <div className="flex gap-2">
              <ButtonLink href="/app/inventory/items" variant="ghost">
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
          {items.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                icon={<Boxes size={22} />}
                title={filtering ? 'Nothing matches this' : 'No item yet'}
                description={
                  filtering
                    ? 'Loosen the filter — an archived item only appears when status is set to Archived or Everything.'
                    : 'A product is something with a quantity; a service is something sold without one. Both can be quoted, ordered and put on an invoice.'
                }
                action={
                  <ButtonLink href="/app/inventory/items/new" size="sm">
                    Add the first item
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH align="right">On hand</TH>
                <TH align="right">Reorder at</TH>
                <TH align="right">Cost</TH>
                <TH align="right">Sells at</TH>
                <TH>Status</TH>
                <TH align="right">Last moved</TH>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-medium">
                      <Link href={`/app/inventory/items/${item.id}`} className="text-ink hover:text-brand">
                        {item.name}
                      </Link>
                      <span className="block text-[11.5px] font-normal text-muted">{item.sku ?? 'no code'}</span>
                    </TD>
                    <TD>
                      <Badge tone={item.kind === 'product' ? 'neutral' : 'brand'}>{item.kind}</Badge>
                    </TD>
                    <TD align="right">
                      {!item.track_stock ? (
                        <span className="text-[12px] text-muted">not counted</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span
                            className={
                              item.stock.on_hand <= 0
                                ? 'font-semibold text-[#a50f0f]'
                                : isLowStock(item)
                                  ? 'font-semibold text-[#8a5300]'
                                  : 'font-semibold text-ink'
                            }
                          >
                            {item.stock.on_hand}
                          </span>
                          <span className="text-[11.5px] text-muted">{item.unit}</span>
                          {isLowStock(item) && <Badge tone={item.stock.on_hand <= 0 ? 'danger' : 'warning'}>low</Badge>}
                        </span>
                      )}
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {item.track_stock ? item.reorder_point ?? '—' : '—'}
                    </TD>
                    <TD align="right" className="text-[12px]">
                      {formatAmount(item.cost, currency, locale)}
                    </TD>
                    <TD align="right" className="text-[12px]">
                      {formatAmount(item.price, currency, locale)}
                    </TD>
                    <TD>
                      <StatusBadge state={item.status} />
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {item.stock.movements === 0
                        ? 'never'
                        : `${item.stock.movements} entr${item.stock.movements === 1 ? 'y' : 'ies'} · ${
                            item.stock.last_movement_at ? formatDateInZone(item.stock.last_movement_at, zone) : '—'
                          }`}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        A quantity is the sum of the item&rsquo;s ledger, and a value is that quantity times the cost written on the
        item — which is why changing a cost changes what the shelf is worth without changing what is on it. Dates are
        shown in {zone}.
      </p>
    </>
  );
}

function Check({ name, on, label }: { name: string; on: boolean; label: string }) {
  return (
    <label
      className={`flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-[12.5px] ${
        on ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line-strong bg-surface text-ink-soft'
      }`}
    >
      <input type="checkbox" name={name} value="1" defaultChecked={on} className="h-3.5 w-3.5 accent-[#2563eb]" />
      {label}
    </label>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { invCounts, listInvSuppliers } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Suppliers' };

/**
 * Who the workspace buys from.
 *
 * The order counts beside each name come from the purchases read rather than a column,
 * because an order is the only thing that ties a supplier to money, and a count stored
 * on the supplier would be a second opinion about somebody else&rsquo;s table.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const query = await searchParams;

  const status = query.status === 'archived' ? 'archived' : query.status === 'all' ? undefined : 'active';

  const [suppliers, counts] = await Promise.all([
    listInvSuppliers(orgId, { search: query.q, status, limit: 400 }),
    invCounts(orgId),
  ]);

  const filtering = !!(query.q || query.status);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Suppliers</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {suppliers.length} shown, {counts.suppliers} of them active. A purchase order always names one, which is why
            a supplier with orders on file cannot be deleted and only archived.
          </p>
        </div>
        <ButtonLink href="/app/inventory/suppliers/new" variant="primary">
          Add a supplier
        </ButtonLink>
      </div>

      <Card>
        <CardBody className="border-b border-line">
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(150px,auto)_auto] md:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ''}
                placeholder="Name, contact or email"
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
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

            <div className="flex gap-2">
              <ButtonLink href="/app/inventory/suppliers" variant="ghost">
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
          {suppliers.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                icon={<Users size={22} />}
                title={filtering ? 'No supplier matches this' : 'No supplier yet'}
                description="Add the people you buy from before writing a purchase order — an order has to name one, and a half-remembered phone number is easier to fix now than during a delivery."
                action={
                  <ButtonLink href="/app/inventory/suppliers/new" size="sm">
                    Add the first supplier
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Name</TH>
                <TH>Contact</TH>
                <TH>Reach</TH>
                <TH align="right">Orders</TH>
                <TH align="right">Open</TH>
                <TH align="right">Last ordered</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {suppliers.map((supplier) => (
                  <TR key={supplier.id}>
                    <TD className="font-medium">
                      <Link href={`/app/inventory/suppliers/${supplier.id}`} className="text-ink hover:text-brand">
                        {supplier.name}
                      </Link>
                      {supplier.address && (
                        <span className="block max-w-[280px] truncate text-[11.5px] font-normal text-muted">
                          {supplier.address}
                        </span>
                      )}
                    </TD>
                    <TD className="text-[12.5px] text-ink-soft">{supplier.contact ?? '—'}</TD>
                    <TD className="text-[12px] text-ink-soft">
                      {!supplier.email && !supplier.phone ? (
                        <span className="text-muted">Nothing on file</span>
                      ) : (
                        <span className="flex flex-col gap-0.5">
                          {supplier.email && <span className="break-all">{supplier.email}</span>}
                          {supplier.phone && <span>{supplier.phone}</span>}
                        </span>
                      )}
                    </TD>
                    <TD align="right" className="text-[12.5px]">
                      {supplier.orders === 0 ? (
                        <span className="text-muted">none</span>
                      ) : (
                        <Badge tone="neutral">{supplier.orders}</Badge>
                      )}
                    </TD>
                    <TD align="right" className="text-[12.5px]">
                      {supplier.open_orders > 0 ? (
                        <Badge tone="warning">{supplier.open_orders}</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TD>
                    <TD align="right" className="text-[12px] text-muted">
                      {supplier.last_ordered_at ? formatDateInZone(supplier.last_ordered_at, zone) : 'never'}
                    </TD>
                    <TD>
                      <StatusBadge state={supplier.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}

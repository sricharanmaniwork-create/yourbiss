import type { Metadata } from 'next';
import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { crmCounts, listCrmLeads } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';
import type { CrmLeadStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leads' };

const FILTERS: { value: CrmLeadStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'converted', label: 'Converted' },
  { value: 'unqualified', label: 'Not qualified' },
];

const STATUSES = new Set<string>(FILTERS.map((filter) => filter.value));

/**
 * The lead list.
 *
 * Filtering is a plain GET form rather than a widget: a link in an email, a back
 * button and a bookmarked set of results all work without any script deciding what
 * the list should be, and the counts in the header come from the same function the
 * hub uses, so the two pages cannot show different numbers.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; owner?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const query = await searchParams;

  const status = STATUSES.has(query.status ?? '') ? (query.status as CrmLeadStatus | 'all') : 'all';
  const statuses = status === 'all' ? undefined : [status];

  const [leads, counts] = await Promise.all([
    listCrmLeads(orgId, { statuses, search: query.q, ownerId: query.owner, limit: 300 }),
    crmCounts(orgId),
  ]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Leads</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {counts.leads_open} being worked, {counts.leads_new} nobody has picked up yet. A lead becomes a customer
            through Convert, which makes the contact and the deal in one step.
          </p>
        </div>
        <ButtonLink href="/app/crm/leads/new" variant="primary">
          Add a lead
        </ButtonLink>
      </div>

      <Card>
        <CardBody className="border-b border-line">
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_repeat(2,minmax(140px,auto))_auto] md:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ''}
                placeholder="Name, email or company"
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Status</span>
              <select
                name="status"
                defaultValue={status}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand"
              >
                {FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Owner id</span>
              <input
                type="text"
                name="owner"
                defaultValue={query.owner ?? ''}
                placeholder="paste a member id"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-[12px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
            </label>

            <div className="flex gap-2">
              <ButtonLink href="/app/crm/leads" variant="ghost">
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
          <p className="mt-2 text-[11.5px] text-muted">
            Owner is matched by the member’s own id, the same one the team list in Settings shows.
          </p>
        </CardBody>

        <CardBody className="p-0">
          {leads.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                icon={<Badge tone="neutral">Leads</Badge>}
                title={STATUSES.has(status) && status !== 'all' ? `No lead is “${status}”` : 'No lead matches this'}
                description="A lead is somebody interested who is not yet a customer: typed in after a phone call, or picked up from a form response or a booking."
                action={
                  <ButtonLink href="/app/crm/leads/new" size="sm">
                    Add the first lead
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH>Reach</TH>
                <TH>Status</TH>
                <TH>Owner</TH>
                <TH>Arrived</TH>
              </THead>
              <TBody>
                {leads.map((lead) => (
                  <TR key={lead.id}>
                    <TD className="font-medium">
                      <Link href={`/app/crm/leads/${lead.id}`} className="text-ink hover:text-brand">
                        {lead.name}
                      </Link>
                    </TD>
                    <TD className="text-ink-soft">{lead.company ?? '—'}</TD>
                    <TD className="text-[12px] text-ink-soft">{lead.email ?? lead.phone ?? 'Nothing on file'}</TD>
                    <TD>
                      <StatusBadge state={lead.status} />
                    </TD>
                    <TD className="text-[12px] text-muted">{lead.owner?.display_name ?? 'Nobody yet'}</TD>
                    <TD className="text-[12px] text-muted">{formatDateInZone(lead.created_at, zone)}</TD>
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

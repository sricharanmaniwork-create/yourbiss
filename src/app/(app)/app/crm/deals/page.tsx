import type { Metadata } from 'next';
import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { crmCounts, listCrmDeals, listCrmStages } from '@/lib/repo';
import { DealBoard } from '@/components/crm/deal-board';
import { SeedPipelineButton } from '@/components/crm/seed-pipeline';
import { ButtonLink, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { formatAmount } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Deals' };

/**
 * The pipeline.
 *
 * Every card, in every column, comes from one read of this workspace&rsquo;s deals and
 * one of its stages: the totals on a column header and the number on the hub are then
 * the same arithmetic over the same rows, which is the only way two screens can be
 * relied on to agree about money.
 */
export default async function DealsPage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;

  const [stages, deals, counts] = await Promise.all([
    listCrmStages(orgId),
    listCrmDeals(orgId, { limit: 400 }),
    crmCounts(orgId),
  ]);

  if (stages.length === 0) {
    return (
      <>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold text-ink">Deals</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-muted">
              A deal sits on a stage, so a board needs a funnel before it can show anything.
            </p>
          </div>
        </div>
        <Card>
          <CardHeader
            title="No pipeline yet"
            description="Six names any sales day already uses, written into this workspace’s own rows — then renamed by whoever owns the funnel."
          />
          <CardBody>
            <SeedPipelineButton orgId={orgId} />
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Deals</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {counts.deals_open} open, worth {formatAmount(Number(counts.deals_value), workspace.org.currency, workspace.org.locale)}{' '}
            together. {counts.won_30d} landed in the last 30 days for{' '}
            {formatAmount(Number(counts.won_30d_value), workspace.org.currency, workspace.org.locale)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/crm/pipeline" className="text-[12.5px] text-muted hover:text-brand">
            Stage names and order
          </Link>
          <ButtonLink href="/app/crm/deals/new" variant="primary">
            Add a deal
          </ButtonLink>
        </div>
      </div>

      {deals.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<span className="text-brand">Deals</span>}
              title="The board is empty"
              description="A deal is the money side of a relationship — a title, what it is worth, and where it sits. Converting a lead opens one at the same time."
              action={
                <ButtonLink href="/app/crm/deals/new" size="sm">
                  Open the first deal
                </ButtonLink>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <DealBoard
          deals={deals}
          stages={stages}
          currency={workspace.org.currency}
          locale={workspace.org.locale}
        />
      )}

      <p className="mt-3 max-w-[760px] text-[12px] leading-relaxed text-muted">
        Drag a card, or use the small select on it — both write only the stage, and the database decides whether that
        means the deal is won, lost or still on its way. Re-opening a closed deal clears its close date, so a month
        counts it once.
      </p>
    </>
  );
}

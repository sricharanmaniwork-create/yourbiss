import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { crmCounts, listCrmStages } from '@/lib/repo';
import { PipelineEditor } from '@/components/crm/pipeline-editor';
import { SeedPipelineButton } from '@/components/crm/seed-pipeline';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { formatAmount } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'CRM pipeline' };

/**
 * The funnel, as this workspace actually sells.
 *
 * Only an owner or admin gets here, because every write to `crm_stages` is
 * admin-gated in the database — a member who pastes the URL is told so plainly
 * instead of seeing a form whose buttons all fail. The deal counts per column come
 * from the same read the board uses, so a stage never shows one number here and
 * another there.
 */
export default async function PipelinePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const [stages, counts] = await Promise.all([listCrmStages(orgId), crmCounts(orgId)]);

  if (!canAdmin) {
    return (
      <>
        <PageHeader
          back={{ href: '/app/crm', label: 'CRM' }}
          title="Pipeline"
          description="The stages a deal moves through, and the two it can close on."
        />
        <Card className="max-w-[680px]">
          <CardBody>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Shaping the funnel belongs to an owner or admin of this workspace: renaming a stage changes what every
              deal on it is called, and removing one moves money off the board. Ask whoever runs the workspace to put
              the stages here, or to move a deal for you.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/app/crm', label: 'CRM' }}
        title="Pipeline"
        description="Name the stages your business actually walks a customer through."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Stages"
            description="Drag order is set with the arrows; the position numbers are kept in gaps of ten so a new stage can still drop between two."
          />
          <CardBody>
            {stages.length === 0 ? (
              <div className="grid gap-4">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  Nothing here yet, so a deal has nowhere to sit and the board is empty. The default pipeline is six
                  stages — Qualification, Meeting set, Proposal sent, Negotiation, Won and Lost — and you can rename the
                  open ones afterwards.
                </p>
                <SeedPipelineButton orgId={orgId} />
              </div>
            ) : (
              <PipelineEditor orgId={orgId} stages={stages} />
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="What the board holds" />
            <CardBody className="grid gap-2.5">
              <p className="text-[13px] text-ink">
                <span className="font-semibold">{counts.deals_open}</span> open{' '}
                {counts.deals_open === 1 ? 'deal' : 'deals'} worth{' '}
                <span className="font-semibold">{formatAmount(Number(counts.deals_value), workspace.org.currency, workspace.org.locale)}</span>
              </p>
              <p className="text-[12.5px] leading-relaxed text-muted">
                Only deals sitting on an open stage are counted as money in flight: one that has landed is revenue for
                its month, and one that was lost is a lesson. The won and lost columns hold those rows, which is why the
                board totals and this number can never disagree.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Rules the database keeps" />
            <CardBody>
              <ul className="grid gap-2 text-[12.5px] leading-relaxed text-muted">
                <li>A stage keeps its kind forever. Turning “Proposal sent” into “Won” would re-date every deal that ever sat on it.</li>
                <li>Won and Lost each exist exactly once, cannot be removed, and are the only things that write a deal&rsquo;s close date.</li>
                <li>A stage with deals on it cannot be deleted — move them first, so nothing silently disappears from a total.</li>
                <li>Stage names are unique per workspace, because two columns called “Proposal” make a board unreadable.</li>
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

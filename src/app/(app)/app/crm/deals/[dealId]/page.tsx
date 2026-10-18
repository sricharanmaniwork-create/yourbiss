import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/workspace';
import { getCrmDeal, listCrmActivities, listCrmContacts, listCrmLeads, listCrmStages, listMembers } from '@/lib/repo';
import { deleteCrmDeal } from '@/lib/actions/crm';
import { ActivityComposer } from '@/components/crm/activity-composer';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { DealForm } from '@/components/crm/deal-form';
import { DeleteButton } from '@/components/crm/delete-button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  dealId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { dealId } = await params;
  const deal = await getCrmDeal(dealId);
  return { title: deal ? deal.title : 'Deal' };
}

/**
 * A deal on its own: the money, the stage that decides whether it counts, and the
 * conversation around it.
 *
 * There is no won/lost switch on this screen. Choosing a stage whose kind is `won`
 * or `lost` is what closes a deal — the trigger writes the date — and moving it back
 * to an open stage clears both, which is why the numbers here always agree with the
 * column the card sits in on the board.
 */
export default async function DealDetailPage({ params }: { params: Promise<Params> }) {
  const { dealId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const now = new Date().toISOString();

  const deal = await getCrmDeal(dealId);
  if (!deal || deal.org_id !== orgId) notFound();

  const [stages, contacts, leads, activities, members] = await Promise.all([
    listCrmStages(orgId),
    listCrmContacts(orgId, { limit: 300 }),
    listCrmLeads(orgId, { limit: 300 }),
    listCrmActivities(orgId, { dealId: deal.id }),
    listMembers(orgId),
  ]);

  const team = members.map((member) => ({
    id: member.user_id,
    name: member.profile?.display_name ?? member.profile?.email ?? 'A member',
  }));

  const daysOpen = Math.max(
    0,
    Math.floor((new Date(now).getTime() - new Date(deal.created_at).getTime()) / 86_400_000),
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/crm/deals" className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand">
            ← Deals
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[20px] font-semibold text-ink">
            {deal.title}
            {deal.won_at ? <Badge tone="success">won</Badge> : deal.lost_at ? <Badge tone="danger">lost</Badge> : null}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {formatAmount(Number(deal.amount), workspace.org.currency, workspace.org.locale)} ·{' '}
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: deal.stage?.color ?? '#9AA5B1' }}
                aria-hidden="true"
              />
              {deal.stage?.name ?? 'removed stage'}
            </span>{' '}
            · open {daysOpen === 1 ? '1 day' : `${daysOpen} days`} · created{' '}
            {formatDateInZone(deal.created_at, workspace.org.timezone)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {deal.contact_id && (
            <Badge tone="neutral">
              <Link href={`/app/crm/contacts/${deal.contact_id}`} className="hover:text-brand">
                {deal.contact?.name ?? 'the contact'}
              </Link>
            </Badge>
          )}
          {deal.lead_id && (
            <Badge tone="neutral">
              <Link href={`/app/crm/leads/${deal.lead_id}`} className="hover:text-brand">
                {deal.lead?.name ?? 'the lead'}
              </Link>
            </Badge>
          )}
          {canAdmin && (
            <DeleteButton
              action={deleteCrmDeal}
              id={deal.id}
              redirectTo="/app/crm/deals"
              title={`Delete “${deal.title}”?`}
              body="The deal leaves the board and its value leaves the totals. Its history is deleted with it; the contact and the lead it was named on stay, because they are the relationship and not the sale."
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <DealForm
            orgId={orgId}
            deal={deal}
            stages={stages}
            contacts={contacts.map((contact) => ({ id: contact.id, name: contact.name, company: contact.company }))}
            leads={leads.map((lead) => ({ id: lead.id, name: lead.name, company: lead.company }))}
            members={team}
            selfId={workspace.userId}
          />

          <Card>
            <CardHeader title="How it closed" description="The stage decides this, and its date is written by the database." />
            <CardBody>
              {deal.won_at ? (
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  Landed on {formatDateInZone(deal.won_at, workspace.org.timezone)} —{' '}
                  {formatAmount(Number(deal.amount), workspace.org.currency, workspace.org.locale)} counted as revenue in
                  the month it was won.
                </p>
              ) : deal.lost_at ? (
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  Ended on {formatDateInZone(deal.lost_at, workspace.org.timezone)}.
                  {deal.lost_reason ? ` Reason given: ${deal.lost_reason}` : ' No reason was written down.'}
                </p>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  Still on the board{deal.expected_close ? `, expected to close by ${formatDateInZone(deal.expected_close, workspace.org.timezone)}` : ''}.
                  Dragging this card onto the won or lost column on <Link href="/app/crm/deals" className="text-brand hover:text-brand-dark">the board</Link>{' '}
                  closes it.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="Who owns it" description="A deal can be nobody's yet; that is a thing to fix, not an error." />
            <CardBody className="flex flex-wrap items-center gap-3">
              {deal.owner ? (
                <span className="text-[13px] text-ink">{deal.owner.display_name}</span>
              ) : (
                <span className="text-[12.5px] leading-relaxed text-muted">
                  Nobody has taken this one. Name somebody on the form and it appears in their list.
                </span>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Notes, calls, meetings and tasks on this deal." />
            <CardBody>
              <ActivityTimeline
                activities={activities}
                userId={workspace.userId}
                canAdmin={canAdmin}
                timezone={workspace.org.timezone}
                locale={workspace.org.locale}
                nowIso={now}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Write something down" />
            <CardBody>
              <ActivityComposer target={{ dealId: deal.id }} members={team} selfId={workspace.userId} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

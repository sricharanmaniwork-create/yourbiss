import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, FileText } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getCrmLead, listCrmActivities, listCrmStages, listCrmDeals, listMembers } from '@/lib/repo';
import { deleteCrmLead } from '@/lib/actions/crm';
import { ActivityComposer } from '@/components/crm/activity-composer';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { ConvertPanel } from '@/components/crm/convert-panel';
import { DeleteButton } from '@/components/crm/delete-button';
import { LeadForm } from '@/components/crm/lead-form';
import { Badge, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  leadId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { leadId } = await params;
  const lead = await getCrmLead(leadId);
  return { title: lead ? lead.name : 'Lead' };
}

/**
 * One lead: what it says, what it became, and everything written about it.
 *
 * Read through the member&rsquo;s own session, so a lead in a workspace this person
 * does not belong to does not exist at all — and the `org_id` comparison after that
 * is what stops somebody with two workspaces from reaching the other one&rsquo;s lead by
 * pasting its id into the address bar.
 */
export default async function LeadDetailPage({ params }: { params: Promise<Params> }) {
  const { leadId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const now = new Date().toISOString();

  const lead = await getCrmLead(leadId);
  if (!lead || lead.org_id !== orgId) notFound();

  const [stages, activities, deals, members] = await Promise.all([
    listCrmStages(orgId),
    listCrmActivities(orgId, { leadId: lead.id }),
    listCrmDeals(orgId, { limit: 20 }),
    listMembers(orgId),
  ]);

  const leadDeals = deals.filter((deal) => deal.lead_id === lead.id);
  const team = members.map((member) => ({
    id: member.user_id,
    name: member.profile?.display_name ?? member.profile?.email ?? 'A member',
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/crm/leads" className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand">
            ← Leads
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[20px] font-semibold text-ink">
            {lead.name}
            <StatusBadge state={lead.status} />
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {lead.company ? `${lead.company} · ` : ''}
            arrived {formatDateInZone(lead.created_at, workspace.org.timezone)} from {lead.source.replace(/_/g, ' ')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lead.status !== 'converted' && stages.some((stage) => stage.kind === 'open') && (
            <ConvertPanel lead={lead} stages={stages} currency={workspace.org.currency} />
          )}
          {canAdmin && (
            <DeleteButton
              action={deleteCrmLead}
              id={lead.id}
              redirectTo="/app/crm/leads"
              title={`Delete the lead “${lead.name}”?`}
              body="Their history goes with them. A lead that was already converted keeps the contact it made — deleting the lead does not delete the customer."
            />
          )}
        </div>
      </div>

      {lead.status === 'converted' && (
        <Card className="mb-4">
          <CardHeader title="Converted" description={`This row is the record of the conversion, so the name and address are frozen as they were.`} />
          <CardBody className="flex flex-wrap items-center gap-3">
            {lead.converted_contact_id && (
              <Badge tone="success">
                <Link href={`/app/crm/contacts/${lead.converted_contact_id}`} className="hover:text-brand">
                  The contact they became
                </Link>
              </Badge>
            )}
            {lead.converted_deal_id && (
              <Badge tone="brand">
                <Link href={`/app/crm/deals/${lead.converted_deal_id}`} className="hover:text-brand">
                  The deal that opened
                </Link>
              </Badge>
            )}
            {lead.converted_at && (
              <span className="text-[12px] text-muted">on {formatDateInZone(lead.converted_at, workspace.org.timezone)}</span>
            )}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <LeadForm orgId={orgId} lead={lead} members={team} selfId={workspace.userId} />

          <Card>
            <CardHeader title="Where this came from" description="A lead can point at the response or the appointment that made it." />
            <CardBody className="grid gap-2">
              {lead.form_submission_id ? (
                <Link href={`/app/forms`} className="inline-flex items-center gap-2 text-[13px] text-brand hover:text-brand-dark">
                  <FileText size={14} aria-hidden="true" />
                  A form response — open the responses in Forms
                </Link>
              ) : null}
              {lead.booking_id ? (
                <Link href={`/app/bookings/appointments`} className="inline-flex items-center gap-2 text-[13px] text-brand hover:text-brand-dark">
                  <CalendarDays size={14} aria-hidden="true" />
                  An appointment — open the diary
                </Link>
              ) : null}
              {!lead.form_submission_id && !lead.booking_id && (
                <p className="text-[12.5px] leading-relaxed text-muted">
                  Typed in by hand. When a form response or a booking is turned into a lead, the link to it is kept
                  here, so the answer somebody gave is still readable next to what was done about it.
                </p>
              )}

              {leadDeals.length > 0 && (
                <ul className="mt-1 space-y-1 border-t border-line pt-2">
                  {leadDeals.map((deal) => (
                    <li key={deal.id} className="text-[12.5px]">
                      <Link href={`/app/crm/deals/${deal.id}`} className="text-brand hover:text-brand-dark">
                        {deal.title}
                      </Link>
                      <span className="text-muted"> · {deal.stage?.name ?? 'removed stage'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="History" description="Notes, calls, meetings and tasks on this lead." />
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

          {stages.length === 0 && lead.status !== 'converted' && (
            <Card>
              <CardBody>
                <p className="text-[12.5px] leading-relaxed text-ink-soft">
                  Converting needs a pipeline: the deal this lead opens has to start on a stage. An owner or admin
                  creates one on the pipeline screen.
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Write something down" />
            <CardBody>
              <ActivityComposer target={{ leadId: lead.id }} members={team} selfId={workspace.userId} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

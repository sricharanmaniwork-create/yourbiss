import type { Metadata } from 'next';
import Link from 'next/link';
import { Contact, Target, TrendingUp, Trophy } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { crmCounts, listCrmLeads, listCrmStages, listCrmTasks } from '@/lib/repo';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { SeedPipelineButton } from '@/components/crm/seed-pipeline';
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'CRM' };

/**
 * The CRM hub: what is waiting for somebody, and what is stopping the workspace from
 * catching people at all.
 *
 * Three reads and one function decide the whole page — the funnel, the eleven counts
 * `youbiss.crm_counts` answers in a single round trip, the leads nobody has touched
 * and the tasks still open. Nothing here is derived from what the browser already
 * has, which is why "3 new leads" and the number on the leads page cannot disagree.
 */
export default async function CrmHomePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const now = new Date().toISOString();

  const [stages, counts, waiting, tasks] = await Promise.all([
    listCrmStages(orgId),
    crmCounts(orgId),
    listCrmLeads(orgId, { statuses: ['new'], limit: 6 }),
    listCrmTasks(orgId, { limit: 8 }),
  ]);

  const hasPipeline = stages.length > 0;

  return (
    <>
      <PageHeader
        title="CRM"
        description="Who arrived, who is being followed up with, what the money in flight is worth, and what the team wrote down about it."
        actions={
          <div className="flex gap-2">
            <ButtonLink href="/app/crm/leads/new" variant="secondary">
              Add a lead
            </ButtonLink>
            <ButtonLink href="/app/crm/deals/new" variant="primary">
              Add a deal
            </ButtonLink>
          </div>
        }
      />

      {!hasPipeline && (
        <Card className="mb-4">
          <CardHeader
            title="The pipeline has no stages yet"
            description="A funnel is the workspace’s own list, so nothing is created behind your back. These six are the names a sales day already uses, and every one of them can be renamed afterwards."
          />
          <CardBody className="flex flex-col gap-3">
            <SeedPipelineButton orgId={orgId} />
            <p className="text-[12px] leading-relaxed text-muted">
              Deals are the only thing that needs a pipeline: leads, contacts and history work without one, so nothing
              else on this page is waiting for the button above.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Target size={16} />}
          label="Leads to work"
          value={String(counts.leads_open)}
          detail={`${counts.leads_new} untouched · ${counts.leads_7d} arrived this week`}
          href="/app/crm/leads?status=new"
        />
        <Stat
          icon={<Contact size={16} />}
          label="Contacts"
          value={String(counts.contacts)}
          detail={`${counts.converted_30d} converted in the last 30 days`}
          href="/app/crm/contacts"
        />
        <Stat
          icon={<TrendingUp size={16} />}
          label="In flight"
          value={formatAmount(Number(counts.deals_value), currency, locale)}
          detail={`${counts.deals_open} open deal${counts.deals_open === 1 ? '' : 's'} on the board`}
          href="/app/crm/deals"
        />
        <Stat
          icon={<Trophy size={16} />}
          label="Landed"
          value={formatAmount(Number(counts.won_30d_value), currency, locale)}
          detail={`${counts.won_30d} won, ${counts.lost_30d} lost in 30 days`}
          href="/app/crm/deals"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Nobody has picked these up"
            description="Leads still sitting at New, soonest first."
            action={
              <ButtonLink href="/app/crm/leads" size="sm">
                All leads
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            {waiting.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<Target size={22} />}
                  title="No lead is waiting"
                  description="A lead is somebody who has shown interest but is not yet a contact: typed in from a call, or picked up from a form response or a booking."
                  action={
                    <ButtonLink href="/app/crm/leads/new" size="sm">
                      Add the first lead
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {waiting.map((lead) => (
                  <li key={lead.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-[180px] flex-1">
                      <Link href={`/app/crm/leads/${lead.id}`} className="block truncate text-[13px] font-medium text-ink hover:text-brand">
                        {lead.name}
                      </Link>
                      <span className="block truncate text-[11.5px] text-muted">
                        {lead.company || 'No company'} · arrived {formatDateInZone(lead.created_at, zone)}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-muted">
                      {lead.owner ? lead.owner.display_name : 'nobody owns it'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Open tasks"
            description={
              counts.tasks_overdue > 0
                ? `${counts.tasks_overdue} of them are past their due date.`
                : 'A task belongs to a person and a record, which is what makes it findable later.'
            }
          />
          <CardBody>
            <ActivityTimeline
              activities={tasks}
              userId={workspace.userId}
              canAdmin={canAdmin}
              timezone={zone}
              locale={locale}
              nowIso={now}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          title="Leads"
          body={`${counts.leads_open} being worked, ${counts.converted_30d} became a customer in the last 30 days. A lead converts once, into a contact and a deal, and the record of that stays.`}
          href="/app/crm/leads"
        />
        <Tile
          title="Deals"
          body={`A card moves by dragging it or by picking the stage: ${counts.deals_open} open, worth ${formatAmount(Number(counts.deals_value), currency, locale)} together.`}
          href="/app/crm/deals"
        />
        <Tile
          title="Contacts"
          body="The people this workspace has a relationship with, each with their history attached — calls, meetings, notes and tasks."
          href="/app/crm/contacts"
        />
        <Tile
          title="Pipeline"
          body={
            canAdmin
              ? 'Rename a stage, recolor it, put it in another place or remove an empty one. The two closing stages stay, because a deal has to close somewhere.'
              : 'An owner or admin sets the stage names. Ask for a stage to be added or moved and it will appear here.'
          }
          href="/app/crm/pipeline"
          adminOnly
          show={canAdmin}
        />
      </div>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="ui-card block px-4 py-3.5 transition-colors hover:bg-raised">
      <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">
        <span className="text-brand">{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-[17px] font-semibold text-ink">{value}</p>
      <p className="mt-1 truncate text-[11.5px] text-muted">{detail}</p>
    </Link>
  );
}

function Tile({
  title,
  body,
  href,
  adminOnly,
  show,
}: {
  title: string;
  body: string;
  href: string;
  adminOnly?: boolean;
  show?: boolean;
}) {
  if (adminOnly && show === false) return null;
  return (
    <Link href={href} className="ui-card block px-4 py-3.5 transition-colors hover:bg-raised">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
    </Link>
  );
}

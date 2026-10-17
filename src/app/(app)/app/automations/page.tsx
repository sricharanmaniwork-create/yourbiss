import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, AlertTriangle, CheckCircle2, ListChecks, Power, Workflow, Zap } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { automationEvents, automationsCounts, listAutomationRules, listAutomationRuns } from '@/lib/repo';
import { describeRule, eventLabel } from '@/lib/automations/describe';
import { appLabel } from '@/lib/modules';
import { RunNow } from '@/components/automations/run-now';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Automations' };

/**
 * Where the rules are, and whether they are doing anything.
 *
 * The two numbers that matter are at the top: how many rules are switched on, and how
 * many of them could not be carried out. A rule that silently does nothing is the only
 * real way this app can waste somebody's day, so a failure is not a footnote here — it is
 * one of the four header numbers, and the reason the runner wrote down is printed beside
 * the run that failed.
 *
 * Both counts come from `youbiss.automations_counts`, the same single read every other
 * hub in the suite uses, so the header and the lists underneath it cannot disagree.
 */
export default async function AutomationsHomePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;

  const [counts, rules, events, runs] = await Promise.all([
    automationsCounts(orgId),
    listAutomationRules(orgId),
    automationEvents(),
    listAutomationRuns(orgId, { limit: 8 }),
  ]);

  const on = rules.filter((rule) => rule.enabled);
  const off = rules.filter((rule) => !rule.enabled);
  const failures = runs.filter((run) => run.outcome === 'failed');
  const skipped = counts.runs_24h - counts.done_24h - counts.failed_24h;

  return (
    <>
      <PageHeader
        title="Automations"
        description="Watch for something the other apps already record, and answer it with a letter or an entry in CRM. Nothing here creates an event — a rule can only be written for one that really fires."
        actions={
          <div className="flex gap-2">
            <RunNow orgId={orgId} />
            <ButtonLink href="/app/automations/rules/new" variant="primary">
              <Zap size={14} aria-hidden="true" />
              New rule
            </ButtonLink>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<ListChecks size={16} />} label="Rules" value={counts.rules} detail={`${off.length} written but switched off`} href="/app/automations/rules" />
        <Stat icon={<Power size={16} />} label="Switched on" value={counts.enabled} detail={counts.enabled === 0 ? 'so nothing runs, however much happens' : 'these are read on every pass'} href="/app/automations/rules?state=on" />
        <Stat icon={<CheckCircle2 size={16} />} label="Carried out today" value={counts.done_24h} detail={`${Math.max(skipped, 0)} looked at and left alone`} href="/app/automations/runs?outcome=done" />
        <Stat
          icon={<AlertTriangle size={16} />}
          label="Could not be done"
          value={counts.failed_24h}
          tone={counts.failed_24h > 0 ? 'danger' : 'plain'}
          detail={counts.failed_24h > 0 ? 'each one says why in the run log' : 'no action has failed in the last day'}
          href="/app/automations/runs?outcome=failed"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="grid content-start gap-3">
          <Card>
            <CardHeader
              title="Switched on"
              description={
                counts.last_run_at
                  ? `Last pass ${formatDateInZone(counts.last_run_at, zone)}. ${counts.events_24h} event(s) reached the timeline today.`
                  : 'No rule has run yet in this workspace.'
              }
              action={
                <ButtonLink href="/app/automations/rules/new" size="sm">
                  New rule
                </ButtonLink>
              }
            />
            <CardBody className="p-0">
              {on.length === 0 ? (
                <div className="px-4 py-4">
                  <EmptyState
                    icon={<Workflow size={22} />}
                    title="Nothing is switched on"
                    description="A new rule starts switched off, and switching it on makes it responsible from that moment forward — never for the events that came before. Write one, read it back, then flip it."
                    action={
                      <ButtonLink href="/app/automations/rules/new" variant="primary" size="md">
                        Write a rule
                      </ButtonLink>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {on.map((rule) => (
                    <li key={rule.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <Link href={`/app/automations/rules/${rule.id}`} className="min-w-[200px] flex-1 text-[13.5px] font-medium text-ink hover:text-brand">
                          {rule.name}
                        </Link>
                        <Badge tone="success" dot>
                          On
                        </Badge>
                      </div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{describeRule(rule, events)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {off.length > 0 && (
            <Card>
              <CardHeader
                title="Written, switched off"
                description="These rules are saved and change nothing until they are switched on."
                action={
                  <ButtonLink href="/app/automations/rules?state=off" size="sm">
                    See all
                  </ButtonLink>
                }
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {off.slice(0, 5).map((rule) => (
                    <li key={rule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <Link href={`/app/automations/rules/${rule.id}`} className="min-w-[180px] flex-1 truncate text-[13px] font-medium text-ink hover:text-brand">
                        {rule.name}
                      </Link>
                      <span className="text-[12px] text-muted">{eventLabel(events, rule)}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {failures.length > 0 && (
            <Card>
              <CardHeader
                title="The last things that could not be done"
                description="A letter with no mail host behind it, or an event whose record has gone, is written down rather than skipped."
                action={
                  <ButtonLink href="/app/automations/runs?outcome=failed" size="sm">
                    Run log
                  </ButtonLink>
                }
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {failures.map((run) => (
                    <li key={run.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium text-ink">{run.rule?.name ?? 'a rule since removed'}</span>
                        <span className="text-[11.5px] text-muted">{formatDateInZone(run.created_at, zone)}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-danger">{run.detail ?? 'no reason was recorded'}</p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <Card className="content-start">
          <CardHeader
            title="What can fire here"
            description="The events the other apps write into their own timeline, and the parts of the record a condition may ask about."
          />
          <CardBody className="max-h-[620px] overflow-y-auto p-0">
            <ul className="divide-y divide-line">
              {events.map((event) => (
                <li key={`${event.app}|${event.entity_type}|${event.action}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-medium text-ink">{event.label}</span>
                    <Badge tone="neutral">{appLabel(event.app)}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    {event.fields.map((field) => field.label).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
          <CardBody className="border-t border-line bg-raised">
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
              <Activity size={14} className="mt-[2px] flex-none" aria-hidden="true" />
              This list is the database&rsquo;s own: a rule cannot name an event that is not in it, so nothing here can
              be a promise the suite does not keep.
            </p>
          </CardBody>
        </Card>
      </div>

      {runs.length > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Recent runs"
            description="One row per rule per event, which is why the same order never gets the same letter twice."
            action={
              <ButtonLink href="/app/automations/runs" size="sm">
                All runs
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <StatusBadge state={run.outcome} />
                  <span className="min-w-[160px] flex-1 truncate text-[13px] text-ink">
                    {run.rule?.name ?? 'a rule since removed'}
                  </span>
                  <span className="min-w-[200px] flex-[2] truncate text-[12.5px] text-muted">
                    {run.event?.summary ?? 'the event is no longer in the timeline'}
                  </span>
                  <span className="text-[11.5px] text-muted">{formatDateInZone(run.created_at, zone)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
  href,
  tone = 'plain',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  href: string;
  tone?: 'plain' | 'danger';
}) {
  return (
    <Link href={href} className="ui-card flex min-w-0 flex-col gap-1 px-4 py-3.5 transition-colors hover:border-brand">
      <span className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">
        <span className={tone === 'danger' ? 'text-danger' : 'text-brand'}>{icon}</span>
        {label}
      </span>
      <span className={tone === 'danger' ? 'text-[22px] font-semibold text-danger' : 'text-[22px] font-semibold text-ink'}>{value}</span>
      <span className="text-[12px] leading-snug text-muted">{detail}</span>
    </Link>
  );
}

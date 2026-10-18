import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { History, Power } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { automationEvents, getAutomationRule, listAutomationRuns } from '@/lib/repo';
import { deleteAutomationRule } from '@/lib/actions/automations';
import { describeAction, describeCondition, eventLabel } from '@/lib/automations/describe';
import { RuleForm } from '@/components/automations/rule-form';
import { RuleSwitch } from '@/components/automations/rule-switch';
import { DeleteButton } from '@/components/inventory/delete-button';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, StatusBadge } from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  ruleId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { ruleId } = await params;
  const rule = await getAutomationRule(ruleId);
  return { title: rule ? rule.name : 'Rule' };
}

/**
 * One rule, read back in the order it runs, with its own history underneath.
 *
 * The sentence at the top is the whole rule in English — what it watches, what has to be
 * true, what it does — because the thing a person is checking when they open a rule is
 * whether it says what they meant. Everything in it comes from the two JSON columns and
 * the catalogue in `public.automation_events`, so it cannot disagree with the runner that
 * reads those same columns.
 */
export default async function AutomationRulePage({ params }: { params: Promise<Params> }) {
  const { ruleId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  const rule = await getAutomationRule(ruleId);
  if (!rule || rule.org_id !== orgId) notFound();

  const [events, runs] = await Promise.all([automationEvents(), listAutomationRuns(orgId, { ruleId: rule.id, limit: 30 })]);
  const label = eventLabel(events, rule);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/automations/rules" className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand">
            ← Rules
          </Link>
          <h1 className="text-[20px] font-semibold text-ink">{rule.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <StatusBadge state={rule.enabled ? 'enabled' : 'disabled'} />
            <span>{label}</span>
          </p>
        </div>
        <ButtonLink href={`/app/automations/runs?rule=${rule.id}`} variant="secondary">
          <History size={14} aria-hidden="true" />
          Its runs
        </ButtonLink>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="What this rule says" description="Written in the order the runner works through it." />
            <CardBody className="grid gap-4">
              <section>
                <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">When</h4>
                <p className="mt-1 text-[13.5px] text-ink">{label}</p>
              </section>

              <section>
                <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Only if</h4>
                {rule.conditions.length === 0 ? (
                  <p className="mt-1 text-[13px] text-muted">Always — every event of that kind is answered.</p>
                ) : (
                  <ul className="mt-1 grid gap-1">
                    {rule.conditions.map((condition, index) => (
                      <li key={index} className="text-[13px] text-ink">
                        {describeCondition(condition, events.find((e) => e.app === rule.app && e.entity_type === rule.entity_type && e.action === rule.action))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">Then do</h4>
                <ol className="mt-1 grid gap-1">
                  {rule.actions.map((action, index) => (
                    <li key={index} className="text-[13px] text-ink">
                      {index + 1}. {describeAction(action)}
                      {action.type === 'letter' && (
                        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">
                          Subject: {action.subject}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
                It answers events from{' '}
                <strong className="font-medium text-ink-soft">{formatDateInZone(rule.watched_from, zone)}</strong> onward
                {rule.enabled
                  ? '' : ' — and nothing at all until it is switched on, when that moment moves to the time of the switch.'}
              </p>
            </CardBody>
          </Card>

          <RuleForm orgId={orgId} events={events} rule={rule} />
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Switched on" description="The one thing that makes this rule real." />
            <CardBody>
              <div className="flex items-start gap-3">
                <Power size={16} className={rule.enabled ? 'mt-[3px] text-success' : 'mt-[3px] text-muted'} aria-hidden="true" />
                <RuleSwitch ruleId={rule.id} enabled={rule.enabled} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Runs"
              description={
                runs.length === 0
                  ? 'Nothing yet.'
                  : `${runs.filter((r) => r.outcome === 'done').length} carried out, ${runs.filter((r) => r.outcome === 'skipped').length} left alone, ${runs.filter((r) => r.outcome === 'failed').length} that could not be.`
              }
              action={
                <ButtonLink href={`/app/automations/runs?rule=${rule.id}`} size="sm">
                  All
                </ButtonLink>
              }
            />
            <CardBody className="p-0">
              {runs.length === 0 ? (
                <div className="px-4 py-4">
                  <EmptyState
                    icon={<History size={20} />}
                    title="This rule has not run"
                    description="Either nothing of that kind has happened since it was switched on, or the scheduler has not made a pass yet. The run log is written whether the answer is yes or no, so an empty one here is a fact rather than a silence."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {runs.map((run) => (
                    <li key={run.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <StatusBadge state={run.outcome} />
                        <span className="text-[11.5px] text-muted">{formatDateInZone(run.created_at, zone)}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
                        {run.event?.summary ?? 'the event is no longer in the timeline'}
                      </p>
                      {run.detail && (
                        <p className={run.outcome === 'failed' ? 'mt-0.5 text-[12px] text-danger' : 'mt-0.5 text-[12px] text-muted'}>
                          {run.detail}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {canAdmin && (
            <Card>
              <CardHeader title="Remove this rule" description="Only an owner or admin can, and only once it is switched off." />
              <CardBody>
                <DeleteButton
                  action={deleteAutomationRule}
                  id={rule.id}
                  redirectTo="/app/automations/rules"
                  title={`Remove “${rule.name}”?`}
                  body="Its runs go with it, so the log will stop saying what this rule decided. Events it already answered stay answered: an order keeps its letter and a CRM entry keeps its note."
                  label="Remove the rule"
                />
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  Switching it off does the same job and keeps the history, which is what to do with a rule that was
                  simply a bad idea.
                </p>
              </CardBody>
            </Card>
          )}

          <Badge tone="neutral" className="w-fit">
            Written {formatDateInZone(rule.created_at, zone)}
          </Badge>
        </div>
      </div>
    </>
  );
}

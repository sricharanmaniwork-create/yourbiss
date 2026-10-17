import type { Metadata } from 'next';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { automationEvents, listAutomationRules, listAutomationRuns } from '@/lib/repo';
import { describeAction, eventLabel } from '@/lib/automations/describe';
import { RuleSwitch } from '@/components/automations/rule-switch';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rules' };

/**
 * Every rule in the workspace, with the switch beside it.
 *
 * The switch is here rather than only on the rule&rsquo;s own screen because the honest way
 * to work with automations is to write a rule, leave it off, and turn it on the day you
 * are ready for it to send. That is two clicks on this list and none on the form.
 *
 * The last-run column reads the recent runs this page already fetched, so a rule that has
 * never fired says "never" instead of looking the same as one that fires hourly — which is
 * the difference between a rule to keep and a rule to delete.
 */
export default async function AutomationRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const query = await searchParams;

  const state = query.state === 'on' || query.state === 'off' ? query.state : 'all';

  const [rules, events, runs] = await Promise.all([
    listAutomationRules(orgId),
    automationEvents(),
    listAutomationRuns(orgId, { limit: 200 }),
  ]);

  const shown = rules.filter((rule) => (state === 'all' ? true : state === 'on' ? rule.enabled : !rule.enabled));

  const last = new Map<string, { at: string; outcome: string }>();
  for (const run of runs) {
    if (!last.has(run.rule_id)) last.set(run.rule_id, { at: run.created_at, outcome: run.outcome });
  }

  return (
    <>
      <PageHeader
        title="Rules"
        description="What this workspace watches for, and what it does about it."
        actions={
          <ButtonLink href="/app/automations/rules/new" variant="primary">
            <Zap size={14} aria-hidden="true" />
            New rule
          </ButtonLink>
        }
      />

      <div className="mb-4 flex gap-1.5">
        {(
          [
            ['all', `${rules.length} in total`],
            ['on', `${rules.filter((r) => r.enabled).length} switched on`],
            ['off', `${rules.filter((r) => !r.enabled).length} switched off`],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={value === 'all' ? '/app/automations/rules' : `/app/automations/rules?state=${value}`}
            className={
              state === value
                ? 'rounded-full border border-brand bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand-dark'
                : 'rounded-full border border-line-strong bg-surface px-3 py-1 text-[12px] text-muted hover:border-brand hover:text-brand'
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <Card>
        {shown.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              icon={<Zap size={22} />}
              title={state === 'all' ? 'No rules yet' : `Nothing is ${state === 'on' ? 'switched on' : 'switched off'}`}
              description={
                state === 'all'
                  ? 'A rule is one event, up to six questions about the record it happened to, and one to four things to do about it. The overview lists the events that can fire.'
                  : 'Change the filter above to see the rest.'
              }
              action={
                state === 'all' ? (
                  <ButtonLink href="/app/automations/rules/new" variant="primary" size="md">
                    Write a rule
                  </ButtonLink>
                ) : undefined
              }
            />
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Rule</TH>
                <TH>Watches for</TH>
                <TH>Then does</TH>
                <TH>Last run</TH>
                <TH className="w-[92px]">On</TH>
              </tr>
            </THead>
            <TBody>
              {shown.map((rule) => {
                const recent = last.get(rule.id);
                return (
                  <TR key={rule.id}>
                    <TD>
                      <Link href={`/app/automations/rules/${rule.id}`} className="text-[13px] font-medium text-ink hover:text-brand">
                        {rule.name}
                      </Link>
                      {rule.conditions.length > 0 && (
                        <p className="mt-0.5 text-[12px] text-muted">
                          only if {rule.conditions.length} {rule.conditions.length === 1 ? 'thing is true' : 'things are true'}
                        </p>
                      )}
                    </TD>
                    <TD>
                      <span className="text-[12.5px] text-ink-soft">{eventLabel(events, rule)}</span>
                    </TD>
                    <TD>
                      <ul className="grid gap-0.5">
                        {rule.actions.map((action, index) => (
                          <li key={index} className="text-[12.5px] text-ink-soft">
                            {describeAction(action)}
                          </li>
                        ))}
                      </ul>
                    </TD>
                    <TD>
                      {recent ? (
                        <div className="flex items-center gap-2">
                          <Badge tone={recent.outcome === 'done' ? 'success' : recent.outcome === 'failed' ? 'danger' : 'neutral'}>
                            {recent.outcome === 'done' ? 'ran' : recent.outcome === 'failed' ? 'failed' : 'skipped'}
                          </Badge>
                          <span className="text-[12px] text-muted">{formatDateInZone(recent.at, zone)}</span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-muted">never</span>
                      )}
                    </TD>
                    <TD>
                      <RuleSwitch ruleId={rule.id} enabled={rule.enabled} compact />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { History } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listAutomationRules, listAutomationRuns } from '@/lib/repo';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Run log' };

const OUTCOMES = ['done', 'skipped', 'failed'] as const;

/**
 * Every decision a rule has made, newest first.
 *
 * A row here is written whether the rule answered the event or not, which is what makes
 * this a log rather than a list of successes: `skipped` means the event arrived and the
 * rule left it alone — the conditions said no, or the app that owns the event is switched
 * off — and the count of them is the difference between a rule that is discriminating and
 * one that is not firing at all.
 *
 * Nothing on this screen can be changed. The browser holds SELECT on `automation_runs` and
 * no other right, so a run is a record of something that happened — including the failed
 * ones, whose reason is the runner&rsquo;s own sentence rather than a code.
 */
export default async function AutomationRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; rule?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const query = await searchParams;

  const outcome = OUTCOMES.find((value) => value === query.outcome);
  const ruleId = query.rule;

  const [runs, rules] = await Promise.all([
    listAutomationRuns(orgId, { outcome, ruleId, limit: 120 }),
    listAutomationRules(orgId),
  ]);

  const active = rules.filter((rule) => rule.enabled).length;

  return (
    <>
      <PageHeader
        title="Run log"
        description={
          runs.length === 0
            ? 'Nothing has been written here yet — a pass only records the events it was shown.'
            : `${runs.length} decision(s) shown, of ${active} switched-on rule(s). Each row is one rule meeting one event, and it can only be written once.`
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link
          href={ruleId ? `/app/automations/runs?rule=${ruleId}` : '/app/automations/runs'}
          className={
            !outcome
              ? 'rounded-full border border-brand bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand-dark'
              : 'rounded-full border border-line-strong bg-surface px-3 py-1 text-[12px] text-muted hover:border-brand hover:text-brand'
          }
        >
          Everything
        </Link>
        {OUTCOMES.map((value) => {
          const href = ruleId ? `/app/automations/runs?outcome=${value}&rule=${ruleId}` : `/app/automations/runs?outcome=${value}`;
          return (
            <Link
              key={value}
              href={href}
              className={
                outcome === value
                  ? 'rounded-full border border-brand bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand-dark'
                  : 'rounded-full border border-line-strong bg-surface px-3 py-1 text-[12px] text-muted hover:border-brand hover:text-brand'
              }
            >
              {value === 'done' ? 'Carried out' : value === 'skipped' ? 'Left alone' : 'Could not be done'}
            </Link>
          );
        })}
        {ruleId && (
          <Badge tone="brand" className="self-center">
            only {rules.find((rule) => rule.id === ruleId)?.name ?? 'one rule'}
          </Badge>
        )}
      </div>

      <Card>
        {runs.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              icon={<History size={22} />}
              title={outcome ? `No ${outcome} runs to show` : 'No runs yet'}
              description={
                active === 0
                  ? 'No rule is switched on, so nothing is being asked about anything. Switch one on and the next pass starts recording.'
                  : 'The rules are switched on and have not been shown an event they recognise. Either nothing of that kind has happened since they were switched on, or the scheduler has not run — "Run now" on the overview makes a pass immediately.'
              }
            />
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-[130px]">Outcome</TH>
                <TH>Rule</TH>
                <TH>Event it was shown</TH>
                <TH>What it says</TH>
                <TH className="w-[150px]">When</TH>
              </tr>
            </THead>
            <TBody>
              {runs.map((run) => (
                <TR key={run.id}>
                  <TD>
                    <StatusBadge state={run.outcome} />
                  </TD>
                  <TD>
                    {run.rule ? (
                      <Link href={`/app/automations/rules/${run.rule.id}`} className="text-[13px] font-medium text-ink hover:text-brand">
                        {run.rule.name}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-muted">a rule since removed</span>
                    )}
                  </TD>
                  <TD>
                    <span className="text-[12.5px] text-ink-soft">{run.event?.summary ?? 'the event is no longer in the timeline'}</span>
                  </TD>
                  <TD>
                    <span className={run.outcome === 'failed' ? 'text-[12.5px] text-danger' : 'text-[12.5px] text-muted'}>
                      {run.detail ?? (run.outcome === 'skipped' ? 'the conditions said no' : 'nothing to report')}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-[12px] text-muted">{formatDateInZone(run.created_at, zone)}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

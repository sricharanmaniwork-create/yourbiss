import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ClipboardList, ListChecks } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { boardCounts, boardRollup } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Projects' };

/**
 * Every board in the workspace, with the state of its cards on the same line.
 *
 * The four numbers are read from `youbiss.board_counts` and the per-board figures from
 * `youbiss.board_project_stats`, both single calls that re-check membership before they
 * count. That is what lets the header and the list agree: one set of numbers, worked out by
 * the database, rather than a count that Node assembled from rows it happened to fetch.
 *
 * Overdue is the number worth looking at, because a card with no date is only late, while a
 * board nobody opens is quietly dead.
 */
export default async function BoardHomePage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;

  const [counts, boards] = await Promise.all([boardCounts(orgId), boardRollup(orgId)]);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Boards for the work that is not a lead, an order or a booking. Lanes on the left, cards moving right, and the lane you mark as finished is what makes a card done."
        actions={
          <ButtonLink href="/app/board/new" variant="primary">
            <ListChecks size={14} aria-hidden="true" />
            New board
          </ButtonLink>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<ClipboardList size={16} />}
          label="Boards"
          value={counts.boards}
          detail={`${counts.active_boards} active — a paused or completed board keeps its cards`}
        />
        <Stat icon={<ListChecks size={16} />} label="Open cards" value={counts.open} detail={`${counts.cards} card(s) in total, finished ones included`} />
        <Stat
          icon={<AlertTriangle size={16} />}
          label="Past their due day"
          value={counts.overdue}
          tone={counts.overdue > 0 ? 'danger' : 'plain'}
          detail={counts.overdue > 0 ? 'a due day means the end of that day in your timezone' : 'nothing is late right now'}
        />
        <Stat
          icon={<CheckCircle2 size={16} />}
          label="Finished this week"
          value={counts.done_7d}
          detail={`${counts.mine_open} open card(s) assigned to you`}
          href="/app/board/tasks"
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="content-start">
          <CardHeader
            title="Boards"
            description={boards.length === 0 ? undefined : `${boards.length} board(s) in this workspace`}
            action={
              <ButtonLink href="/app/board/new" size="sm">
                New board
              </ButtonLink>
            }
          />
          <CardBody className="p-0">
            {boards.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  icon={<ClipboardList size={22} />}
                  title="No boards yet"
                  description="Starting a board gives it three lanes — To do, In progress, Done — and you rename or remove them from there. Nothing is filled in for you: the first card is the one somebody has to write."
                  action={
                    <ButtonLink href="/app/board/new" variant="primary" size="md">
                      Start a board
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {boards.map((board) => (
                  <li key={board.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Link href={`/app/board/${board.id}`} className="min-w-[200px] flex-1 text-[13.5px] font-medium text-ink hover:text-brand">
                        {board.name}
                      </Link>
                      <StatusBadge state={board.status} />
                    </div>
                    {board.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{board.summary}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                      <span className="text-ink-soft">
                        {board.open} open
                        <span className="text-muted"> / {board.cards} card(s)</span>
                      </span>
                      <span className="text-muted">{board.done} finished</span>
                      {board.overdue > 0 && (
                        <span className="font-medium text-danger">{board.overdue} past due</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="content-start">
          <CardHeader title="How a card becomes finished" />
          <CardBody className="grid gap-3">
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              Dragging a card into the lane whose settings say &ldquo;this is finished&rdquo; is what marks work as
              done. The database stamps the moment and writes a line in the activity timeline; dragging it back out
              un-finishes it, and the timeline records that too.
            </p>
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              Because finishing is a line in the timeline like any other app&rsquo;s, a rule in{' '}
              <Link href="/app/automations/rules/new" className="text-brand hover:text-brand-dark">
                Automations
              </Link>{' '}
              can be written for a card being added, finished or reopened.
            </p>
            <p className="text-[12px] leading-relaxed text-muted">
              A lane that still holds cards cannot be deleted — move them somewhere else first. Deleting a board takes
              its lanes and cards with it, and only the owner or an admin can do that.
            </p>
          </CardBody>
          <CardBody className="border-t border-line bg-raised">
            <Badge tone="neutral">No time tracking, no dependencies, no Gantt</Badge>
          </CardBody>
        </Card>
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
  tone = 'plain',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  href?: string;
  tone?: 'plain' | 'danger';
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">
        <span className={tone === 'danger' ? 'text-danger' : 'text-brand'}>{icon}</span>
        {label}
      </span>
      <span className={tone === 'danger' ? 'text-[22px] font-semibold text-danger' : 'text-[22px] font-semibold text-ink'}>
        {value}
      </span>
      <span className="text-[12px] leading-snug text-muted">{detail}</span>
    </>
  );

  if (!href) {
    return <div className="ui-card flex min-w-0 flex-col gap-1 px-4 py-3.5">{body}</div>;
  }

  return (
    <Link href={href} className="ui-card flex min-w-0 flex-col gap-1 px-4 py-3.5 transition-colors hover:border-brand">
      {body}
    </Link>
  );
}

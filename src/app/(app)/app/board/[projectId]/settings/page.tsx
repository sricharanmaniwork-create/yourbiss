import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/workspace';
import { getBoardProject, listBoardCards, listBoardColumns } from '@/lib/repo';
import { deleteBoard } from '@/lib/actions/board';
import { BoardForm } from '@/components/board/board-form';
import { DeleteButton } from '@/components/board/delete-button';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface Params {
  projectId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return { title: 'Board settings' };
  const board = await getBoardProject(projectId);
  return { title: board ? `${board.name} — settings` : 'Board settings' };
}

/**
 * The board&rsquo;s own settings: what it is called, what it is for, and whether it is still
 * going on.
 *
 * Lanes are listed here rather than edited here, because a lane belongs to the board it is
 * standing on — renaming one or marking it as the finished one happens on the canvas, next to
 * the cards it decides the state of. What this page adds is the one destructive thing:
 * deleting the board, which takes its lanes and every card on it, and which only the owner or
 * an admin is allowed to do.
 */
export default async function BoardSettingsPage({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) notFound();

  const workspace = await requireWorkspace();
  const board = await getBoardProject(projectId);
  if (!board || board.org_id !== workspace.org.id) notFound();

  const [lanes, cards] = await Promise.all([listBoardColumns(board.id), listBoardCards(board.id)]);
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  return (
    <>
      <PageHeader
        back={{ href: `/app/board/${board.id}`, label: board.name }}
        title="Board settings"
        description="Name, purpose and state. The lanes and cards stay where they are."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <BoardForm orgId={workspace.org.id} board={board} />

        <div className="grid content-start gap-3">
          <Card>
            <CardHeader
              title="Lanes"
              description={`${lanes.length} on this board`}
              action={
                <a href={`/app/board/${board.id}`} className="text-[12.5px] font-medium text-brand hover:underline">
                  Edit on the board
                </a>
              }
            />
            <CardBody className="p-0">
              <ul className="divide-y divide-line">
                {lanes.map((lane) => {
                  const holding = cards.filter((card) => card.column_id === lane.id);
                  const open = holding.filter((card) => card.completed_at === null).length;
                  return (
                    <li key={lane.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-[120px] flex-1 truncate text-[13px] font-medium text-ink">{lane.name}</span>
                      {lane.is_done && (
                        <Badge tone="success" dot>
                          finished
                        </Badge>
                      )}
                      <span className="text-[12px] text-muted">
                        {open} open / {holding.length} card(s)
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
            <CardBody className="border-t border-line bg-raised">
              <p className="text-[12px] leading-relaxed text-muted">
                A lane holding cards cannot be deleted, and a board can always have more than one lane marked as
                finished — for instance &ldquo;Shipped&rdquo; and &ldquo;Cancelled&rdquo;, both of which stop the work.
              </p>
            </CardBody>
          </Card>

          {canAdmin ? (
            <Card>
              <CardHeader title="Deleting this board" description="Goes with its lanes and every card on them." />
              <CardBody>
                <DeleteButton
                  action={() => deleteBoard(board.id)}
                  redirectTo="/app/board"
                  title={`Delete “${board.name}”?`}
                  body={`${cards.length} card(s) across ${lanes.length} lane(s) go with it. This cannot be undone, and an Automations rule that watches this board will simply stop finding events to act on.`}
                  label="Delete board"
                />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Deleting this board" />
              <CardBody>
                <p className="text-[12.5px] leading-relaxed text-muted">
                  Only the owner or an admin can delete a board. Everything else on this page — the name, what it is
                  for, whether it is still going on — is open to any member.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

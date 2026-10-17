import type { Metadata } from 'next';
import { Inbox } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listDoneLanes, listMyBoardCards } from '@/lib/repo';
import { MyTaskList } from '@/components/board/my-task-list';
import { ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My tasks' };

/**
 * One person&rsquo;s open cards, from every board in the workspace.
 *
 * This crosses boards on purpose, which is why it is a page rather than a filter on one: the
 * question it answers is what is on me today, not what is on a wall. It reads only cards
 * assigned to the signed-in user that are not finished, in due-date order, with the undated
 * ones at the end.
 */
export default async function MyTasksPage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const now = new Date();

  const [cards, doneLanes] = await Promise.all([listMyBoardCards(orgId, workspace.userId), listDoneLanes(orgId)]);

  // First finished lane per board, which is the leftmost one — listDoneLanes reads in the
  // same order the canvas draws in.
  const doneByBoard: Record<string, string> = {};
  for (const lane of doneLanes) {
    if (!doneByBoard[lane.project_id]) doneByBoard[lane.project_id] = lane.id;
  }

  const overdue = cards.filter((card) => card.due_at !== null && new Date(card.due_at).getTime() < now.getTime())
    .length;

  return (
    <>
      <PageHeader
        title="My tasks"
        description="Open cards assigned to you, on every board in this workspace. Finishing one here moves it into that board's finished lane — the same thing a drag on the board does."
        actions={
          <ButtonLink href="/app/board">Back to boards</ButtonLink>
        }
      />

      <Card>
        <CardHeader
          title="Open work assigned to you"
          description={
            cards.length === 0
              ? 'Nothing is standing on a board with your name on it.'
              : `${cards.length} card(s), soonest due first. ${
                  overdue > 0 ? `${overdue} of them are past their due day.` : 'None of them are past their due day.'
                }`
          }
        />
        <CardBody className="p-0">
          {cards.length === 0 ? (
            <EmptyState
              icon={<Inbox size={22} />}
              title="Nothing is on you"
              description="Either the boards in this workspace have no open cards assigned to you, or every card that was is standing in a finished lane. Assigning someone happens by opening a card on a board."
              action={
                <ButtonLink href="/app/board" variant="primary" size="md">
                  See the boards
                </ButtonLink>
              }
            />
          ) : (
            <MyTaskList cards={cards} doneByBoard={doneByBoard} zone={workspace.org.timezone} nowIso={now.toISOString()} />
          )}
        </CardBody>
      </Card>
    </>
  );
}

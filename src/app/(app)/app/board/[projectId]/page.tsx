import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Settings2 } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getBoardProject, listBoardCards, listBoardColumns, listMembers } from '@/lib/repo';
import { BoardCanvas } from '@/components/board/board-canvas';
import { ButtonLink, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface Params {
  projectId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return { title: 'Board' };
  const board = await getBoardProject(projectId);
  return { title: board ? board.name : 'Board' };
}

/**
 * One board, open.
 *
 * The id in the URL is checked for shape before it reaches the database, and the board that
 * comes back is checked for whose workspace it is in. The first check is what turns a
 * hand-typed address into a &ldquo;not found&rdquo; page instead of a Postgres error; the second
 * is a belt on top of row-level security, which already refuses to show another
 * workspace&rsquo;s board.
 */
export default async function BoardDetailPage({ params }: { params: Promise<Params> }) {
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) notFound();

  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;

  const board = await getBoardProject(projectId);
  if (!board || board.org_id !== orgId) notFound();

  const [lanes, cards, members] = await Promise.all([
    listBoardColumns(board.id),
    listBoardCards(board.id),
    listMembers(orgId),
  ]);

  const team = members.map((member) => ({
    id: member.user_id,
    name: member.profile?.display_name ?? member.profile?.email ?? 'A member',
  }));

  return (
    <>
      <PageHeader
        back={{ href: '/app/board', label: 'Projects' }}
        title={board.name}
        description={board.summary ?? undefined}
        actions={
          <ButtonLink href={`/app/board/${board.id}/settings`}>
            <Settings2 size={14} aria-hidden="true" />
            Board settings
          </ButtonLink>
        }
      />

      {board.status !== 'active' && (
        <p className="mb-4 rounded-md border border-[#f6dfbc] bg-[#fdf6e3] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#7a5b12]">
          This board is {board.status === 'paused' ? 'paused' : 'completed'}. Cards still move and still finish — the
          state is a note to whoever reads the list that no new work is expected here.
        </p>
      )}

      <BoardCanvas
        board={board}
        lanes={lanes}
        cards={cards}
        members={team}
        zone={workspace.org.timezone}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}

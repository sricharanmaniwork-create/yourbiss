import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { BoardForm } from '@/components/board/board-form';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New board' };

/**
 * Starting a board.
 *
 * One name is asked for, because one name is what a board needs — the lanes come with it,
 * made in the same database call, so the screen after this one is a board you can drop cards
 * on rather than an empty shell to configure before work can begin.
 */
export default async function NewBoardPage() {
  const workspace = await requireWorkspace();

  return (
    <>
      <PageHeader
        back={{ href: '/app/board', label: 'Projects' }}
        title="New board"
        description="A board holds lanes, and lanes hold cards. Rename or remove the three that come with it once it is open."
      />
      <BoardForm orgId={workspace.org.id} />
    </>
  );
}

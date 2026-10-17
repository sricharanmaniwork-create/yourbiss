import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { BoardTabs } from '@/components/board/board-tabs';
import { ButtonLink } from '@/components/ui';

/**
 * Projects is switched on or off like every other app, and that is the only decision this
 * layout makes.
 *
 * Who may write belongs to the policies in 0014: a member moves cards and lanes, only an
 * owner or an admin deletes a board. A screen cannot be the place where that is decided,
 * because a second tab pointed at the same route would disagree with it.
 */
export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();

  if (workspace.apps.board !== true) {
    return (
      <div className="ui-card max-w-[720px] px-5 py-5">
        <h2 className="text-[15px] font-semibold text-ink">Projects is switched off for this workspace</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          Nothing has been deleted. The boards, lanes and cards are still in the database exactly as they were left —
          an app that is switched off simply stops showing its screens, and switching it back on shows them again.
        </p>
        <ButtonLink href="/app/settings/apps" variant="primary" className="mt-4">
          Open the app list
        </ButtonLink>
        <p className="mt-3 text-[12px] text-muted">
          Or go back to the{' '}
          <Link href="/app" className="text-brand hover:text-brand-dark">
            dashboard
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      <BoardTabs />
      {children}
    </>
  );
}

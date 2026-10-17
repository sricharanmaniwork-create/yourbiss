'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string }[] = [
  { href: '/app/board', label: 'Boards' },
  { href: '/app/board/tasks', label: 'My tasks' },
];

function isActive(href: string, pathname: string) {
  const onTasks = pathname === '/app/board/tasks' || pathname.startsWith('/app/board/tasks/');
  if (href === '/app/board/tasks') return onTasks;
  // A board's own pages are the Boards tab; My tasks is the one branch that is not.
  return pathname === '/app/board' || (pathname.startsWith('/app/board/') && !onTasks);
}

/**
 * Two tabs, because a board has two honest questions: what is on the walls, and what is
 * on me. The second one is not a filter of the first — it crosses every board in the
 * workspace, which is the reason it is a page rather than a checkbox.
 */
export function BoardTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Projects sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => {
        const active = isActive(tab.href, pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-medium',
              active ? 'border-brand text-brand' : 'border-transparent text-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

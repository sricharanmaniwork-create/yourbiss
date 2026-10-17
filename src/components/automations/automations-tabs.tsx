'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string }[] = [
  { href: '/app/automations', label: 'Overview' },
  { href: '/app/automations/rules', label: 'Rules' },
  { href: '/app/automations/runs', label: 'Run log' },
];

function isActive(href: string, pathname: string) {
  return href === '/app/automations' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Three tabs, because an automation has exactly three states worth looking at: what
 * is switched on, what the rules are, and what they actually did.
 */
export function AutomationsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Automations sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
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

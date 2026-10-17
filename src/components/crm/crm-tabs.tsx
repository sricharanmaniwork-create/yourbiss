'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: '/app/crm', label: 'Overview' },
  { href: '/app/crm/leads', label: 'Leads' },
  { href: '/app/crm/deals', label: 'Deals' },
  { href: '/app/crm/contacts', label: 'Contacts' },
  { href: '/app/crm/pipeline', label: 'Pipeline', adminOnly: true },
];

function isActive(href: string, pathname: string) {
  return href === '/app/crm' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The four lists a sales day moves between, plus the funnel itself.
 *
 * Pipeline is shown to an owner or admin only — a member cannot edit a stage, and a
 * tab that leads to a refusal is worse than no tab.
 */
export function CrmTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="CRM sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.filter((tab) => !tab.adminOnly || isAdmin).map((tab) => {
        const active = isActive(tab.href, pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-medium',
              active
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

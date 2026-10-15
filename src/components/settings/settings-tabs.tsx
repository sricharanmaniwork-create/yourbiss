'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { OrgRole } from '@/lib/types';

const TABS: { href: string; label: string; adminOnly: boolean }[] = [
  { href: '/app/settings', label: 'Workspace', adminOnly: true },
  { href: '/app/settings/members', label: 'Members', adminOnly: true },
  { href: '/app/settings/apps', label: 'Apps', adminOnly: true },
  { href: '/app/settings/email', label: 'Email', adminOnly: true },
  { href: '/app/settings/profile', label: 'Your profile', adminOnly: false },
];

/** `/app/settings` must not match every child, so exactness is decided here. */
function isActive(href: string, pathname: string) {
  return href === '/app/settings' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsTabs({ role }: { role: OrgRole }) {
  const pathname = usePathname();
  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <nav aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
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

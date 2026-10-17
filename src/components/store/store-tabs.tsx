'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string }[] = [
  { href: '/app/store', label: 'Overview' },
  { href: '/app/store/orders', label: 'Orders' },
  { href: '/app/store/settings', label: 'Storefront' },
];

function isActive(href: string, pathname: string) {
  return href === '/app/store' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Three tabs, and the catalogue is not one of them.
 *
 * The items a shop sells are the items Inventory counts — one list, one price, one tax
 * rate — so a Store tab called "Products" would either be a second table to keep in step
 * or a read-only copy of somebody else's screen. The hub links to the filtered item list
 * instead, which is the same rows with the same controls.
 */
export function StoreTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Store sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
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

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string }[] = [
  { href: '/app/inventory', label: 'Overview' },
  { href: '/app/inventory/items', label: 'Items' },
  { href: '/app/inventory/purchases', label: 'Purchase orders' },
  { href: '/app/inventory/suppliers', label: 'Suppliers' },
];

function isActive(href: string, pathname: string) {
  return href === '/app/inventory' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The four lists a stockroom moves between.
 *
 * There is no "movements" tab on purpose: the ledger is not a place you go to work, it
 * is the explanation attached to the item it belongs to.
 */
export function InventoryTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Inventory sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
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

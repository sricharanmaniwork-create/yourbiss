import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { InventoryTabs } from '@/components/inventory/inventory-tabs';
import { ButtonLink } from '@/components/ui';

/**
 * Every Inventory screen reads through the same two questions RLS asks: is this person
 * a member, and is Inventory switched on.
 *
 * A stock count is the one number in the suite that has to be right, so when the app is
 * off the layout says so instead of showing an empty item list — a shelf that looks
 * empty is a far worse answer than a door that says it is closed.
 */
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();

  if (workspace.apps.inventory !== true) {
    return (
      <>
        <div className="ui-card max-w-[720px] px-5 py-5">
          <h2 className="text-[15px] font-semibold text-ink">Inventory is switched off for this workspace</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            Items, stock movements, suppliers and purchase orders are all still stored — turning the app off does not
            delete a single entry from the ledger — but the screens stay closed until an owner or admin switches it
            back on. The website keeps showing whatever your published pages say.
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
      </>
    );
  }

  return (
    <>
      <InventoryTabs />
      {children}
    </>
  );
}

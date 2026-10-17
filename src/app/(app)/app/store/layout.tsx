import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { StoreTabs } from '@/components/store/store-tabs';
import { ButtonLink } from '@/components/ui';

/**
 * Every Store screen reads through the same two questions RLS asks: is this person a
 * member, and is Store switched on.
 *
 * Orders are documents a visitor wrote, so a closed app still shows the door rather than
 * an empty list: nobody wants a page that looks like no orders came in when the truth is
 * that the screens are turned off. The orders themselves stay exactly where they are.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();

  if (workspace.apps.store !== true) {
    return (
      <>
        <div className="ui-card max-w-[720px] px-5 py-5">
          <h2 className="text-[15px] font-semibold text-ink">Store is switched off for this workspace</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            Orders already taken stay in the database with their lines and their totals, and the stock they moved stays
            on the ledger. What stops is the checkout: a visitor&rsquo;s cart finds nothing to order from, and a shop
            that was selling quietly goes quiet. Switch Store back on and the storefront reads the same item list it
            did before.
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
      <StoreTabs />
      {children}
    </>
  );
}

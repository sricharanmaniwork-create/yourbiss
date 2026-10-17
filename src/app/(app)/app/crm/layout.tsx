import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { CrmTabs } from '@/components/crm/crm-tabs';
import { ButtonLink } from '@/components/ui';

/**
 * Every CRM screen reads through the same two questions RLS asks: is this person a
 * member, and is CRM switched on. If the app is off, the lists below would answer
 * with nothing at all — an empty Leads page that is really a switched-off app is the
 * kind of screen that gets a workspace blamed for a bug it does not have, so the
 * layout says the truth once and stops there.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();

  if (workspace.apps.crm !== true) {
    return (
      <>
        <div className="ui-card max-w-[720px] px-5 py-5">
          <h2 className="text-[15px] font-semibold text-ink">CRM is switched off for this workspace</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            Contacts, leads and deals are still stored — turning the app off does not delete anything — but the screens
            stay closed until an owner or admin switches it back on. Until then, a shared booking page and a published
            form keep working exactly as they did.
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
      <CrmTabs isAdmin={workspace.role === 'owner' || workspace.role === 'admin'} />
      {children}
    </>
  );
}

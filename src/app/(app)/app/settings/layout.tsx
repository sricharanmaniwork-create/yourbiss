import { PageHeader } from '@/components/ui/card';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { requireWorkspace } from '@/lib/workspace';

/**
 * No role gate here: a plain member still owns `/app/settings/profile`, and
 * redirecting from within this layout would loop. Admin-only pages render an
 * explicit notice instead.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Things that change how ${workspace.org.name} looks to customers and what your team may do.`}
      />
      <SettingsTabs role={workspace.role} />
      {children}
    </>
  );
}

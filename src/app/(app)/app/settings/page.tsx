import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { currencyChoices, localeChoices, timeZoneList } from '@/lib/timezones';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AdminOnly } from '@/components/settings/admin-only';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { CopyAddress } from '@/components/settings/copy-address';

export const metadata: Metadata = { title: 'Settings · Workspace' };

export default async function WorkspaceSettingsPage() {
  const workspace = await requireWorkspace();
  if (workspace.role === 'member') {
    return <AdminOnly action="Renaming this workspace or moving its web address" />;
  }

  return (
    <div className="max-w-[720px] space-y-4">
      <Card>
        <CardHeader
          title="Identity and region"
          description="What customers see, and the defaults a new booking service starts from."
        />
        <CardBody>
          <WorkspaceForm
            org={{
              id: workspace.org.id,
              name: workspace.org.name,
              slug: workspace.org.slug,
              timezone: workspace.org.timezone,
              currency: workspace.org.currency,
              locale: workspace.org.locale,
              logo_url: workspace.org.logo_url,
            }}
            timezones={timeZoneList()}
            currencies={currencyChoices()}
            locales={localeChoices()}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Web address"
          description="Published pages are served from this path. Changing it moves every page at once."
        />
        <CardBody>
          <CopyAddress slug={workspace.org.slug} />
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Your pages live at{' '}
            <code className="rounded bg-raised px-1 py-[1px] text-[12px]">/s/{workspace.org.slug}/…</code> on this
            deployment. A custom domain is connected from the website&apos;s own settings.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

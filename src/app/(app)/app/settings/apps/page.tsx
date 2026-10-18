import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { AdminOnly } from '@/components/settings/admin-only';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AppToggles } from '@/components/settings/app-toggles';
import { MODULES } from '@/lib/modules';

export const metadata: Metadata = { title: 'Settings · Apps' };

export default async function AppsSettingsPage() {
  const workspace = await requireWorkspace();
  if (workspace.role === 'member') {
    return <AdminOnly action="Switching apps on or off for the whole workspace" />;
  }

  const toggleable = MODULES.filter((m) => m.appKey !== null);

  return (
    <div className="max-w-[760px] space-y-4">
      <Card>
        <CardHeader
          title="Apps in this workspace"
          description="Switching an app off hides it from the sidebar, stops its automations and its mail, and takes its own pages offline. Nothing is deleted."
        />
        <CardBody className="p-0">
          <AppToggles
            orgId={workspace.org.id}
            apps={workspace.apps}
            modules={toggleable.map((m) => ({
              key: m.appKey as NonNullable<typeof m.appKey>,
              label: m.label,
              tagline: m.tagline,
              live: m.state === 'live',
            }))}
          />
        </CardBody>
      </Card>

      <p className="text-[12.5px] leading-relaxed text-muted">
        A page that lives at your own address — a published site, the storefront — answers a plain &ldquo;not
        available&rdquo; once its app is off rather than an error, so a half-finished rollout never shows a visitor a
        stack trace. A form or booking link you have already shared is the deliberate exception: it keeps working until
        you unpublish the form or hide the service, because tidying the sidebar should not quietly break a link printed
        on a flyer.
      </p>
    </div>
  );
}

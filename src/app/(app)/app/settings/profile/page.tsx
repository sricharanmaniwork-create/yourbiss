import type { Metadata } from 'next';
import { requireWorkspace, getSession } from '@/lib/workspace';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ProfileForm } from '@/components/settings/profile-form';
import { LeaveWorkspaceButton } from '@/components/settings/leave-workspace-button';

export const metadata: Metadata = { title: 'Settings · Your profile' };

export default async function ProfileSettingsPage() {
  const workspace = await requireWorkspace();
  const session = await getSession();

  return (
    <div className="max-w-[640px] space-y-4">
      <Card>
        <CardHeader
          title="Your details"
          description="Teammates in this workspace see your name and title. Customers never do."
        />
        <CardBody>
          <ProfileForm
            profile={{
              display_name: session?.profile?.display_name ?? '',
              email: session?.user.email ?? '',
              job_title: session?.profile?.job_title ?? '',
              phone: session?.profile?.phone ?? '',
            }}
          />
        </CardBody>
      </Card>

      {workspace.role !== 'owner' && (
        <Card>
          <CardHeader
            title="Leave this workspace"
            description="You keep your account and any other workspace you belong to."
          />
          <CardBody>
            <LeaveWorkspaceButton orgId={workspace.org.id} orgName={workspace.org.name} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

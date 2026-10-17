import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { listMembers } from '@/lib/repo';
import { LeadForm } from '@/components/crm/lead-form';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New lead' };

export default async function NewLeadPage() {
  const workspace = await requireWorkspace();
  const members = await listMembers(workspace.org.id);

  return (
    <>
      <PageHeader
        back={{ href: '/app/crm/leads', label: 'Leads' }}
        title="New lead"
        description="Somebody interested who is not yet a customer. Write down how to reach them and who is chasing it."
      />
      <LeadForm
        orgId={workspace.org.id}
        selfId={workspace.userId}
        members={members.map((member) => ({
          id: member.user_id,
          name: member.profile?.display_name ?? member.profile?.email ?? 'A member',
        }))}
      />
    </>
  );
}

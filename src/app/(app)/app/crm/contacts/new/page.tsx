import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { listMembers } from '@/lib/repo';
import { ContactForm } from '@/components/crm/contact-form';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New contact' };

export default async function NewContactPage() {
  const workspace = await requireWorkspace();
  const members = await listMembers(workspace.org.id);

  return (
    <>
      <PageHeader
        back={{ href: '/app/crm/contacts', label: 'Contacts' }}
        title="New contact"
        description="Someone the workspace already has a relationship with. A prospect goes under Leads instead."
      />
      <ContactForm
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

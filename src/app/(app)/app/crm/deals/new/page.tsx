import type { Metadata } from 'next';
import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { listCrmContacts, listCrmLeads, listCrmStages, listMembers } from '@/lib/repo';
import { DealForm } from '@/components/crm/deal-form';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New deal' };

interface SearchParams {
  contact?: string;
}

/**
 * A deal needs a stage to sit on, so an empty pipeline sends you to the pipeline
 * screen first rather than leaving a form with nothing in its only required select.
 */
export default async function NewDealPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const query = await searchParams;

  const [stages, contacts, leads, members] = await Promise.all([
    listCrmStages(orgId),
    listCrmContacts(orgId, { limit: 300 }),
    listCrmLeads(orgId, { limit: 300 }),
    listMembers(orgId),
  ]);

  const team = members.map((member) => ({
    id: member.user_id,
    name: member.profile?.display_name ?? member.profile?.email ?? 'A member',
  }));

  // The address bar is user-supplied: a contact id from another workspace is a
  // string that names nothing here, so it is dropped rather than pre-selected.
  const prefill = contacts.find((contact) => contact.id === query.contact)?.id;

  if (stages.length === 0) {
    return (
      <>
        <PageHeader
          back={{ href: '/app/crm/deals', label: 'Deals' }}
          title="New deal"
          description="A deal is placed on a stage, so the funnel has to exist before one can be opened."
        />
        <div className="ui-card max-w-[680px] px-5 py-5">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Nothing has been put in the pipeline yet. An owner or admin can lay out the stages on{' '}
            <Link href="/app/crm/pipeline" className="text-brand hover:text-brand-dark">
              the pipeline screen
            </Link>
            , or start from the six defaults on the{' '}
            <Link href="/app/crm" className="text-brand hover:text-brand-dark">
              CRM home
            </Link>
            .
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/app/crm/deals', label: 'Deals' }}
        title="New deal"
        description="Something worth money to somebody: a title, a stage, and what it is worth."
      />
      <DealForm
        orgId={orgId}
        stages={stages}
        contacts={contacts.map((contact) => ({ id: contact.id, name: contact.name, company: contact.company }))}
        leads={leads.map((lead) => ({ id: lead.id, name: lead.name, company: lead.company }))}
        members={team}
        selfId={workspace.userId}
        defaultContactId={prefill}
      />
    </>
  );
}

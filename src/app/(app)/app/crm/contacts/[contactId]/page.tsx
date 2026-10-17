import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireWorkspace } from '@/lib/workspace';
import { getCrmContact, listCrmActivities, listCrmDeals, listMembers } from '@/lib/repo';
import { deleteCrmContact } from '@/lib/actions/crm';
import { ActivityComposer } from '@/components/crm/activity-composer';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { ContactForm } from '@/components/crm/contact-form';
import { DeleteButton } from '@/components/crm/delete-button';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface Params {
  contactId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { contactId } = await params;
  const contact = await getCrmContact(contactId);
  return { title: contact ? contact.name : 'Contact' };
}

/**
 * The customer, their money and their history on one screen.
 *
 * Deals are read for the workspace and narrowed here rather than filtered by a
 * per-contact query: the board already needs the same rows, and one read of a
 * workspace&rsquo;s deals is cheaper than one read per contact on a list.
 */
export default async function ContactDetailPage({ params }: { params: Promise<Params> }) {
  const { contactId } = await params;
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const now = new Date().toISOString();

  const contact = await getCrmContact(contactId);
  if (!contact || contact.org_id !== orgId) notFound();

  const [activities, deals, members] = await Promise.all([
    listCrmActivities(orgId, { contactId: contact.id }),
    listCrmDeals(orgId, { limit: 300 }),
    listMembers(orgId),
  ]);

  const theirDeals = deals.filter((deal) => deal.contact_id === contact.id);
  const openValue = theirDeals
    .filter((deal) => deal.won_at === null && deal.lost_at === null)
    .reduce((total, deal) => total + Number(deal.amount), 0);
  const wonValue = theirDeals
    .filter((deal) => deal.won_at !== null)
    .reduce((total, deal) => total + Number(deal.amount), 0);

  const team = members.map((member) => ({
    id: member.user_id,
    name: member.profile?.display_name ?? member.profile?.email ?? 'A member',
  }));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/crm/contacts" className="mb-1 inline-block text-[12.5px] text-muted hover:text-brand">
            ← Contacts
          </Link>
          <h1 className="text-[20px] font-semibold text-ink">{contact.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {contact.company ? `${contact.company} · ` : ''}
            {formatAmount(wonValue, workspace.org.currency, workspace.org.locale)} landed ·{' '}
            {formatAmount(openValue, workspace.org.currency, workspace.org.locale)} in flight · added{' '}
            {formatDateInZone(contact.created_at, workspace.org.timezone)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={`/app/crm/deals/new?contact=${contact.id}`} variant="primary">
            New deal
          </ButtonLink>
          {canAdmin && (
            <DeleteButton
              action={() => deleteCrmContact(contact.id)}
              redirectTo="/app/crm/contacts"
              title={`Delete ${contact.name}?`}
              body="Their notes, calls and tasks go with them, and any deal they were the only name on loses them. Deleting a customer is not something a Tuesday afternoon click should do, which is why only an owner or admin can."
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <ContactForm orgId={orgId} contact={contact} members={team} selfId={workspace.userId} />

          <Card>
            <CardHeader
              title="Deals"
              description="Everything this contact has been named on, newest first."
              action={
                <ButtonLink href="/app/crm/deals" size="sm">
                  The board
                </ButtonLink>
              }
            />
            <CardBody className="p-0">
              {theirDeals.length === 0 ? (
                <div className="px-4 py-4">
                  <EmptyState
                    icon={<Badge tone="neutral">Deals</Badge>}
                    title="Nothing on offer yet"
                    description="A deal is the money side of a relationship: a title, what it is worth, and where it sits in the funnel."
                    action={
                      <ButtonLink href={`/app/crm/deals/new?contact=${contact.id}`} size="sm">
                        Open a deal
                      </ButtonLink>
                    }
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {theirDeals.map((deal) => (
                    <li key={deal.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="min-w-[180px] flex-1">
                        <Link href={`/app/crm/deals/${deal.id}`} className="block truncate text-[13px] font-medium text-ink hover:text-brand">
                          {deal.title}
                        </Link>
                        <span className="block text-[11.5px] text-muted">
                          {deal.stage?.name ?? 'removed stage'} · updated {formatDateInZone(deal.updated_at, workspace.org.timezone)}
                        </span>
                      </span>
                      <span className="text-[12.5px] font-semibold text-ink">
                        {formatAmount(Number(deal.amount), workspace.org.currency, workspace.org.locale)}
                      </span>
                      {deal.won_at && <Badge tone="success">won</Badge>}
                      {deal.lost_at && <Badge tone="danger">lost</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="History" description="Every note, call, meeting and task on this contact." />
            <CardBody>
              <ActivityTimeline
                activities={activities}
                userId={workspace.userId}
                canAdmin={canAdmin}
                timezone={workspace.org.timezone}
                locale={workspace.org.locale}
                nowIso={now}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Write something down" />
            <CardBody>
              <ActivityComposer target={{ contactId: contact.id }} members={team} selfId={workspace.userId} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

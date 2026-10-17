import type { Metadata } from 'next';
import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { listCrmContacts, listCrmTags } from '@/lib/repo';
import { Badge, ButtonLink, Card, CardBody, EmptyState, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Contacts' };

/**
 * The customer list.
 *
 * Search covers name, company and email because those are the three things somebody
 * remembers when the phone rings; tags are the filter worth clicking, and the set
 * offered here is built from the tags actually in use rather than a list of guesses.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; owner?: string }>;
}) {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const query = await searchParams;

  const [contacts, tags] = await Promise.all([
    listCrmContacts(orgId, { search: query.q, ownerId: query.owner, limit: 400 }),
    listCrmTags(orgId),
  ]);

  const wanted = query.tag ? decodeURIComponent(query.tag) : '';
  const shown = wanted === '' ? contacts : contacts.filter((contact) => contact.tags.includes(wanted));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold text-ink">Contacts</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            {contacts.length} {contacts.length === 1 ? 'person' : 'people'} this workspace has a relationship with. Each
            one carries their own history, the deals they are on, and whoever answers their calls.
          </p>
        </div>
        <ButtonLink href="/app/crm/contacts/new" variant="primary">
          Add a contact
        </ButtonLink>
      </div>

      <Card>
        <CardBody className="border-b border-line">
          <form method="get" className="grid gap-3 md:grid-cols-[minmax(200px,1fr)_repeat(2,minmax(150px,auto))_auto] md:items-end">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={query.q ?? ''}
                placeholder="Name, email or company"
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Tag</span>
              <select name="tag" defaultValue={wanted} className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink focus:border-brand">
                <option value="">Any tag</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Owner id</span>
              <input
                type="text"
                name="owner"
                defaultValue={query.owner ?? ''}
                placeholder="paste a member id"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-[12px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
              />
            </label>

            <div className="flex gap-2">
              <ButtonLink href="/app/crm/contacts" variant="ghost">
                Clear
              </ButtonLink>
              <button
                type="submit"
                className="h-9 rounded-md border border-brand bg-brand px-3.5 text-[13px] font-medium text-white hover:bg-brand-dark"
              >
                Filter
              </button>
            </div>
          </form>
        </CardBody>

        <CardBody className="p-0">
          {shown.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState
                icon={<Badge tone="neutral">Contacts</Badge>}
                title={contacts.length === 0 ? 'No contact yet' : 'Nothing matches this'}
                description="A contact is somebody the workspace has dealt with. The first ones usually arrive by converting a lead, which is also how a form response becomes a customer."
                action={
                  <ButtonLink href="/app/crm/contacts/new" size="sm">
                    Add a contact
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH>Reach</TH>
                <TH>Tags</TH>
                <TH>Owner</TH>
                <TH>Added</TH>
              </THead>
              <TBody>
                {shown.map((contact) => (
                  <TR key={contact.id}>
                    <TD className="font-medium">
                      <Link href={`/app/crm/contacts/${contact.id}`} className="text-ink hover:text-brand">
                        {contact.name}
                      </Link>
                    </TD>
                    <TD className="text-ink-soft">{contact.company ?? '—'}</TD>
                    <TD className="text-[12px] text-ink-soft">{contact.email ?? contact.phone ?? 'Nothing on file'}</TD>
                    <TD>
                      {contact.tags.length === 0 ? (
                        <span className="text-[12px] text-muted">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {contact.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} tone="neutral">
                              {tag}
                            </Badge>
                          ))}
                          {contact.tags.length > 3 && <span className="text-[11px] text-muted">+{contact.tags.length - 3}</span>}
                        </span>
                      )}
                    </TD>
                    <TD className="text-[12px] text-muted">{contact.owner?.display_name ?? 'Nobody yet'}</TD>
                    <TD className="text-[12px] text-muted">{formatDateInZone(contact.created_at, zone)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}

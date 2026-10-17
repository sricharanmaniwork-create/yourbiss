'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCrmContact, updateCrmContact } from '@/lib/actions/crm';
import { Button, Field, FormStatus, Input, Select, Textarea, useAction } from '@/components/ui';
import type { ActionState, CrmContact } from '@/lib/types';

const SOURCES = [
  { value: 'manual', label: 'Typed in by hand' },
  { value: 'lead', label: 'Converted from a lead' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'From the website' },
  { value: 'phone', label: 'Phone' },
  { value: 'event', label: 'At an event' },
  { value: 'other', label: 'Something else' },
];

/**
 * The customer record.
 *
 * Tags are typed as one comma-separated line rather than a chip editor: they are a
 * list of twenty short words that the database validates (`crm_tags_are_clean`), and
 * a comma box is honest about what gets stored. `lead` is in the source list but
 * only ever written by the conversion, so it shows here as what it is — where this
 * person came from — and not as something to choose.
 */
export function ContactForm({
  orgId,
  contact,
  members,
  selfId,
}: {
  orgId: string;
  contact?: CrmContact | null;
  members: { id: string; name: string }[];
  selfId: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [name, setName] = useState(contact?.name ?? '');
  const [company, setCompany] = useState(contact?.company ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [ownerId, setOwnerId] = useState(contact?.owner_id ?? selfId);
  const [source, setSource] = useState(contact?.source ?? 'manual');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [tags, setTags] = useState((contact?.tags ?? []).join(', '));

  const payload = {
    name,
    company,
    email,
    phone,
    owner_id: ownerId,
    source,
    address,
    tags: tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
  };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } =
        contact ? await updateCrmContact(contact.id, payload) : await createCrmContact(orgId, payload);
      if (result.ok && result.id) router.push(`/app/crm/contacts/${result.id}`);
      else if (result.ok && contact) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="contact-name" required error={fieldError('name')}>
            <Input
              id="contact-name"
              value={name}
              maxLength={120}
              invalid={!!fieldError('name')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Company" htmlFor="contact-company" error={fieldError('company')}>
            <Input id="contact-company" value={company} maxLength={120} onChange={(event) => setCompany(event.target.value)} />
          </Field>
          <Field label="Email" htmlFor="contact-email" error={fieldError('email')}>
            <Input
              id="contact-email"
              type="email"
              value={email}
              maxLength={254}
              invalid={!!fieldError('email')}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="contact-phone" error={fieldError('phone')}>
            <Input id="contact-phone" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" htmlFor="contact-owner" hint="Who answers their calls">
            <Select id="contact-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Nobody yet</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Where they came from" htmlFor="contact-source">
            <Select id="contact-source" value={source} onChange={(event) => setSource(event.target.value)}>
              {SOURCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Address" htmlFor="contact-address" error={fieldError('address')}>
          <Textarea
            id="contact-address"
            rows={2}
            value={address}
            maxLength={400}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Field>

        <Field label="Tags" htmlFor="contact-tags" hint="Comma separated, twenty at most" error={fieldError('tags')}>
          <Input
            id="contact-tags"
            value={tags}
            placeholder="vip, repeat buyer, chennai"
            onChange={(event) => setTags(event.target.value)}
          />
        </Field>

        <p className="text-[11.5px] leading-relaxed text-muted">
          One contact per email address, per workspace. If a name turns out to be somebody already listed, the second
          row is refused here rather than quietly merged — merging two histories is a decision for the person holding
          the phone.
        </p>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(contact ? `/app/crm/contacts/${contact.id}` : '/app/crm/contacts')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            {contact ? 'Save contact' : 'Add contact'}
          </Button>
        </div>
      </div>
    </div>
  );
}

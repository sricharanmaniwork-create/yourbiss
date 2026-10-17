'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCrmLead, updateCrmLead } from '@/lib/actions/crm';
import { Button, Field, FormStatus, Input, Select, Textarea, useAction } from '@/components/ui';
import type { ActionState, CrmLead, CrmLeadStatus } from '@/lib/types';

const SOURCES = [
  { value: 'manual', label: 'Typed in by hand' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'From the website' },
  { value: 'phone', label: 'Phone' },
  { value: 'event', label: 'At an event' },
  { value: 'other', label: 'Something else' },
];

const STATUSES: { value: CrmLeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'unqualified', label: 'Not qualified' },
];

/**
 * A lead, created or edited, in one screen.
 *
 * `converted` is not offered in the status list and that is not a shortcut: a lead
 * becomes converted by the Convert action, which also creates the contact and the
 * deal, and the table refuses a status set any other way. Once it has been
 * converted, the name and address stop being editable — the same freeze the
 * database applies — so the form shows them as they were instead of letting the
 * change be typed and then refused.
 */
export function LeadForm({
  orgId,
  lead,
  members,
  selfId,
}: {
  orgId: string;
  lead?: CrmLead | null;
  members: { id: string; name: string }[];
  selfId: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const frozen = lead?.status === 'converted';

  const [name, setName] = useState(lead?.name ?? '');
  const [company, setCompany] = useState(lead?.company ?? '');
  const [email, setEmail] = useState(lead?.email ?? '');
  const [phone, setPhone] = useState(lead?.phone ?? '');
  const [ownerId, setOwnerId] = useState(lead?.owner_id ?? selfId);
  const [source, setSource] = useState(lead?.source ?? 'manual');
  const [status, setStatus] = useState<CrmLeadStatus>(lead?.status ?? 'new');
  const [reason, setReason] = useState(lead?.reason ?? '');

  const payload = { name, company, email, phone, owner_id: ownerId, source, status, reason };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } =
        lead ? await updateCrmLead(lead.id, payload) : await createCrmLead(orgId, payload);
      if (result.ok && result.id) router.push(`/app/crm/leads/${result.id}`);
      else if (result.ok && lead) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        {frozen && (
          <p className="rounded-md border border-[#dfe3e9] bg-[#eef0f3] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#41474f]">
            This lead was converted. Its name, address and company stay exactly as they were converted, because this row
            is now the record of that conversion — the contact it made is the thing to edit.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="lead-name" required error={fieldError('name')}>
            <Input
              id="lead-name"
              value={name}
              maxLength={120}
              disabled={frozen}
              invalid={!!fieldError('name')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Company" htmlFor="lead-company" error={fieldError('company')}>
            <Input
              id="lead-company"
              value={company}
              maxLength={120}
              disabled={frozen}
              onChange={(event) => setCompany(event.target.value)}
            />
          </Field>
          <Field label="Email" htmlFor="lead-email" error={fieldError('email')}>
            <Input
              id="lead-email"
              type="email"
              value={email}
              maxLength={254}
              disabled={frozen}
              invalid={!!fieldError('email')}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="lead-phone" error={fieldError('phone')}>
            <Input
              id="lead-phone"
              value={phone}
              maxLength={40}
              disabled={frozen}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Owner" htmlFor="lead-owner" hint="Who follows up">
            <Select id="lead-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Nobody yet</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Where it came from" htmlFor="lead-source">
            <Select id="lead-source" value={source} disabled={frozen} onChange={(event) => setSource(event.target.value)}>
              {SOURCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label.trim()}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="lead-status" hint={frozen ? 'kept as converted' : undefined}>
            <Select
              id="lead-status"
              value={status}
              disabled={frozen}
              onChange={(event) => setStatus(event.target.value as CrmLeadStatus)}
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {frozen && <option value="converted">Converted</option>}
            </Select>
          </Field>
        </div>

        <Field
          label={frozen ? 'Note on the conversion' : 'Why'}
          htmlFor="lead-reason"
          hint="Optional — a dropped lead is worth a sentence"
          error={fieldError('reason')}
        >
          <Textarea
            id="lead-reason"
            rows={3}
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(lead ? `/app/crm/leads/${lead.id}` : '/app/crm/leads')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            {lead ? 'Save lead' : 'Add lead'}
          </Button>
        </div>
      </div>
    </div>
  );
}

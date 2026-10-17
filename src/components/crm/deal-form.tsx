'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCrmDeal, updateCrmDeal } from '@/lib/actions/crm';
import { Button, Field, FormStatus, Input, Select, Textarea, useAction } from '@/components/ui';
import type { ActionState, CrmDeal, CrmStage } from '@/lib/types';

/**
 * A deal: a title, a stage, a person, a number.
 *
 * There is no "state" field, and the reason is on the screen: picking the stage the
 * deal closed on is what closes it, because `won_at` and `lost_at` are written by the
 * trigger that reads the stage's kind. Moving a won deal back to an open stage
 * re-opens it and clears both dates, which is why a re-won deal is counted in the
 * month it was won again and not twice.
 */
export function DealForm({
  orgId,
  deal,
  stages,
  contacts,
  leads,
  members,
  selfId,
  defaultContactId,
}: {
  orgId: string;
  deal?: CrmDeal | null;
  stages: CrmStage[];
  contacts: { id: string; name: string; company: string | null }[];
  leads: { id: string; name: string; company: string | null }[];
  members: { id: string; name: string }[];
  selfId: string;
  /** Set when the deal is opened from a contact, so the person is not picked twice. */
  defaultContactId?: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [title, setTitle] = useState(deal?.title ?? '');
  const [stageId, setStageId] = useState(deal?.stage_id ?? stages[0]?.id ?? '');
  const [contactId, setContactId] = useState(deal?.contact_id ?? defaultContactId ?? '');
  const [leadId, setLeadId] = useState(deal?.lead_id ?? '');
  const [ownerId, setOwnerId] = useState(deal?.owner_id ?? selfId);
  const [amount, setAmount] = useState(deal ? String(deal.amount) : '0');
  const [expectedClose, setExpectedClose] = useState(deal?.expected_close ?? '');
  const [lostReason, setLostReason] = useState(deal?.lost_reason ?? '');

  const closingStage = stages.find((stage) => stage.id === stageId);
  const isLost = closingStage?.kind === 'lost';

  const payload = {
    title,
    stage_id: stageId,
    contact_id: contactId,
    lead_id: leadId,
    owner_id: ownerId,
    amount: amount === '' ? 0 : Number(amount),
    expected_close: expectedClose,
    lost_reason: lostReason,
  };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } =
        deal ? await updateCrmDeal(deal.id, payload) : await createCrmDeal(orgId, payload);
      if (result.ok && result.id) router.push(`/app/crm/deals/${result.id}`);
      else if (result.ok && deal) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What is being sold?" htmlFor="deal-title" required error={fieldError('title')}>
            <Input
              id="deal-title"
              value={title}
              maxLength={140}
              placeholder="Two-day workshop for Acme"
              invalid={!!fieldError('title')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Stage" htmlFor="deal-stage" required error={fieldError('stage_id')}>
            <Select id="deal-stage" value={stageId} onChange={(event) => setStageId(event.target.value)}>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                  {stage.kind !== 'open' ? ` · ${stage.kind}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact" htmlFor="deal-contact" hint="Pick one of these two">
            <Select id="deal-contact" value={contactId} onChange={(event) => setContactId(event.target.value)}>
              <option value="">Nobody yet</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.company ? ` — ${contact.company}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lead it came from" htmlFor="deal-lead">
            <Select id="deal-lead" value={leadId} onChange={(event) => setLeadId(event.target.value)}>
              <option value="">None</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name}
                  {lead.company ? ` — ${lead.company}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Owner" htmlFor="deal-owner">
            <Select id="deal-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">Nobody yet</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Worth" htmlFor="deal-amount" error={fieldError('amount')}>
            <Input
              id="deal-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              invalid={!!fieldError('amount')}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field label="Expected close" htmlFor="deal-close" hint="Optional">
            <Input
              id="deal-close"
              type="date"
              value={expectedClose}
              onChange={(event) => setExpectedClose(event.target.value)}
            />
          </Field>
        </div>

        {isLost && (
          <Field label="Why was it lost?" htmlFor="deal-lost-reason" hint="Worth the sentence">
            <Textarea
              id="deal-lost-reason"
              rows={2}
              value={lostReason}
              maxLength={500}
              onChange={(event) => setLostReason(event.target.value)}
            />
          </Field>
        )}

        <p className="text-[11.5px] leading-relaxed text-muted">
          A deal is about somebody: name a contact, a lead, or both. The currency is the workspace&rsquo;s own and cannot
          be set per deal, so a board adds up in one number.
        </p>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(deal ? `/app/crm/deals/${deal.id}` : '/app/crm/deals')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={title.trim() === '' || stageId === '' || (contactId === '' && leadId === '')}
            onClick={submit}
          >
            {deal ? 'Save deal' : 'Add deal'}
          </Button>
        </div>
      </div>
    </div>
  );
}

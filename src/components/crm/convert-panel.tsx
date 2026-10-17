'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { convertCrmLead } from '@/lib/actions/crm';
import { Button, Field, FormStatus, Input, Modal, Select, Switch, useAction } from '@/components/ui';
import type { CrmLead, CrmStage } from '@/lib/types';

/**
 * The one way a lead becomes a customer.
 *
 * It calls `crm_convert_lead` and nothing else: that function locks the lead, makes
 * the contact, optionally opens the deal and stamps the conversion in one
 * transaction, so two people clicking Convert in the same second make one customer.
 * The screen therefore does not try to guess whether it already ran — a second
 * response returns the first conversion&rsquo;s ids, and this goes to that contact.
 */
export function ConvertPanel({
  lead,
  stages,
  currency,
}: {
  lead: CrmLead;
  stages: CrmStage[];
  currency: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [open, setOpen] = useState(false);
  const [stageId, setStageId] = useState(stages.find((stage) => stage.kind === 'open')?.id ?? '');
  const [createDeal, setCreateDeal] = useState(true);
  const [title, setTitle] = useState(lead.company || lead.name);
  const [amount, setAmount] = useState('0');

  const convert = () => {
    void run(async () => {
      const result = await convertCrmLead({
        leadId: lead.id,
        stageId,
        createDeal,
        dealTitle: title,
        amount: amount === '' ? 0 : Number(amount),
      });
      if (result.ok && result.contactId) {
        setOpen(false);
        router.push(`/app/crm/contacts/${result.contactId}`);
      }
      return result;
    });
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Convert to a contact
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Turn ${lead.name} into a customer`}
        description="This makes the contact record and, if you want it, opens the first deal on the pipeline. It is the only way a lead is marked converted."
        size="lg"
      >
        <div className="grid gap-4">
          <div className="flex items-start justify-between gap-4 rounded-md border border-line bg-raised px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">Open a deal at the same time</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-soft">
                Without one, the lead still becomes a contact and you can add the deal yourself later.
              </span>
            </span>
            <Switch checked={createDeal} onChange={setCreateDeal} label="Open a deal at the same time" />
          </div>

          {createDeal && (
            <>
              <Field label="Start the deal on" htmlFor="convert-stage" required error={fieldError('stage_id')}>
                <Select id="convert-stage" value={stageId} onChange={(event) => setStageId(event.target.value)}>
                  {stages
                    .filter((stage) => stage.kind === 'open')
                    .map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                </Select>
              </Field>

              <Field label="Deal title" htmlFor="convert-title" hint="Blank uses the company, then the name">
                <Input id="convert-title" value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} />
              </Field>

              <Field label={`Worth, in ${currency}`} htmlFor="convert-amount" error={fieldError('amount')}>
                <Input
                  id="convert-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amount}
                  invalid={!!fieldError('amount')}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
            </>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted">
            If this workspace already has a contact at {lead.email || 'that address'}, the conversion stops and says so:
            two records of one person is a merge, and a merge is a decision for a person.
          </p>

          <FormStatus state={state} />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={createDeal && stageId === ''}
              onClick={convert}
            >
              Convert
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

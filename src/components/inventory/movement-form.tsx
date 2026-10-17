'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordInvMovement } from '@/lib/actions/inventory';
import { Button, Field, FormStatus, Input, Select, useAction } from '@/components/ui';
import type { InvMovementReason } from '@/lib/types';

const REASONS: { value: InvMovementReason; label: string; hint: string }[] = [
  { value: 'opening', label: 'Opening count', hint: 'What was on the shelf before this app was keeping track' },
  { value: 'sale', label: 'Sold', hint: 'Gone out of the door, invoiced somewhere else' },
  { value: 'customer_return', label: 'Customer returned', hint: 'Came back to the shelf' },
  { value: 'adjustment', label: 'Adjustment', hint: 'A miscount, breakage or write-off — you choose the direction' },
];

/**
 * One entry in the stock ledger.
 *
 * A mistake here is corrected by the opposite entry, never by editing this one — that
 * is the whole design of the table, and it is why this form has no "recent entries I
 * can change" list. The number printed under the box is what the database will allow:
 * a tracked shelf cannot go below zero, and it says so with the item's own name.
 */
export function MovementForm({
  itemId,
  unit,
  onHand,
  trackStock,
}: {
  itemId: string;
  unit: string;
  onHand: number;
  trackStock: boolean;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [reason, setReason] = useState<InvMovementReason>('adjustment');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [unitCost, setUnitCost] = useState('');
  const [reference, setReference] = useState('');

  const going = reason === 'sale' ? false : reason === 'adjustment' ? direction === 'in' : true;
  const count = Number(quantity);
  const valid = Number.isFinite(count) && count > 0;
  const after = valid ? onHand + (going ? count : -count) : onHand;
  const wouldEmpty = trackStock && valid && after < 0;
  const chosen = REASONS.find((entry) => entry.value === reason);

  const submit = () => {
    void run(async () => {
      const result = await recordInvMovement(itemId, { reason, quantity, direction, unit_cost: unitCost, reference });
      if (result.ok) {
        setQuantity('');
        setReference('');
        setUnitCost('');
        router.refresh();
      }
      return result;
    });
  };

  return (
    <div className="ui-card px-5 py-5">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Why it moved" htmlFor="mv-reason">
            <Select id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value as InvMovementReason)}>
              {REASONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How many" htmlFor="mv-qty" required error={fieldError('quantity')}>
            <Input
              id="mv-qty"
              type="number"
              min={0}
              step="0.01"
              value={quantity}
              invalid={!!fieldError('quantity')}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        </div>

        {reason === 'adjustment' && (
          <Field label="Direction" htmlFor="mv-direction" hint="Which way the miscount went">
            <Select id="mv-direction" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
              <option value="out">Went out — broke, lost, written off</option>
              <option value="in">Came in — found, miscounted before</option>
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cost each" htmlFor="mv-cost" hint="Optional — what one of these cost on the day" error={fieldError('unit_cost')}>
            <Input id="mv-cost" type="number" min={0} step="0.01" value={unitCost} placeholder="leave blank if unknown" onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
          <Field label="Reference" htmlFor="mv-reference" hint="Invoice, job, or who told you" error={fieldError('reference')}>
            <Input id="mv-reference" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>

        <p className="text-[12px] leading-relaxed text-muted">
          {chosen?.hint}. {going ? 'Adding' : 'Taking'} {valid ? quantity : '—'} {unit} moves the shelf from{' '}
          {onHand} to <span className={wouldEmpty ? 'font-medium text-danger' : 'font-medium text-ink'}>{after}</span>
          {trackStock ? ', and a counted shelf cannot go below zero.' : '.'}
        </p>

        <FormStatus state={state} />

        <div className="flex justify-end">
          <Button variant="primary" loading={pending} disabled={!valid} onClick={submit}>
            Record the movement
          </Button>
        </div>
      </div>
    </div>
  );
}

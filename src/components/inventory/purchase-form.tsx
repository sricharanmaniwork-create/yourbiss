'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createInvPurchase, updateInvPurchase } from '@/lib/actions/inventory';
import { Button, Field, FormStatus, Input, Select, Textarea, useAction } from '@/components/ui';
import type { ActionState, InvPurchase } from '@/lib/types';

/**
 * The top half of a purchase order: who it goes to, when it was placed and when the
 * goods are meant to arrive.
 *
 * The number is never in this form. It is drawn by the database when the draft is
 * created, which is the only way two people writing an order in the same minute end up
 * with two references. Once the order has been sent the whole header stops being
 * editable — a supplier holds a copy of these terms, and the table refuses a change.
 */
export function PurchaseForm({
  orgId,
  purchase,
  suppliers,
  today,
}: {
  orgId: string;
  purchase?: InvPurchase | null;
  suppliers: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [supplierId, setSupplierId] = useState(purchase?.supplier_id ?? suppliers[0]?.id ?? '');
  const [orderDate, setOrderDate] = useState(purchase?.order_date ?? today);
  const [expectedDate, setExpectedDate] = useState(purchase?.expected_date ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');

  const frozen = !!purchase && purchase.status !== 'draft';

  const payload = { supplier_id: supplierId, order_date: orderDate, expected_date: expectedDate, notes };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } =
        purchase ? await updateInvPurchase(purchase.id, payload) : await createInvPurchase(orgId, payload);
      if (result.ok && result.id) router.push(`/app/inventory/purchases/${result.id}`);
      else if (result.ok && purchase) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        {frozen && (
          <p className="rounded-md border border-[#dfe3e9] bg-[#eef0f3] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#41474f]">
            {purchase?.number} has been sent, so its supplier, dates and note stay as the copy in front of the supplier
            says. Cancel it and raise a new one, or order the difference on a separate draft.
          </p>
        )}

        {suppliers.length === 0 ? (
          <p className="rounded-md border border-line bg-raised px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
            An order has to be addressed to somebody. Add the supplier first and the order will be waiting here.
          </p>
        ) : (
          <Field label="Supplier" htmlFor="po-supplier" required error={fieldError('supplier_id')}>
            <Select id="po-supplier" value={supplierId} disabled={frozen} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ordered on" htmlFor="po-date" error={fieldError('order_date')}>
            <Input id="po-date" type="date" value={orderDate} disabled={frozen} invalid={!!fieldError('order_date')} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>
          <Field label="Due" htmlFor="po-expected" hint="Optional — a date the shelf can plan around" error={fieldError('expected_date')}>
            <Input id="po-expected" type="date" value={expectedDate} disabled={frozen} invalid={!!fieldError('expected_date')} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Note on the order" htmlFor="po-notes" hint="What is being bought, and anything the supplier should read" error={fieldError('notes')}>
          <Textarea id="po-notes" rows={3} value={notes} maxLength={1000} disabled={frozen} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(purchase ? `/app/inventory/purchases/${purchase.id}` : '/app/inventory/purchases')}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={suppliers.length === 0 || supplierId === '' || orderDate === ''}
            onClick={submit}
          >
            {purchase ? 'Save the draft' : 'Start the order'}
          </Button>
        </div>
      </div>
    </div>
  );
}

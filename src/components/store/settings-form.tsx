'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveStoreSettings } from '@/lib/actions/store';
import { Button, Field, FormStatus, Input, Textarea, useAction } from '@/components/ui';

/**
 * The two numbers a shop adds to a basket.
 *
 * One flat delivery fee and one note above the checkout button — that is the whole of it,
 * because anything else a visitor could be charged has to come from an item, and an item's
 * price, tax rate and stock are Inventory's. A per-zone rate card or a weight table would
 * need a place to live that this schema does not have, and an invented column is worse
 * than a fee that is the same for everybody.
 */
export function StoreSettingsForm({
  orgId,
  shippingFlat,
  checkoutNote,
}: {
  orgId: string;
  shippingFlat: number;
  checkoutNote: string | null;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [fee, setFee] = useState(shippingFlat === 0 ? '0' : String(shippingFlat));
  const [note, setNote] = useState(checkoutNote ?? '');

  const dirty = fee !== (shippingFlat === 0 ? '0' : String(shippingFlat)) || note !== (checkoutNote ?? '');

  const submit = () => {
    void run(async () => {
      const result = await saveStoreSettings(orgId, { shipping_flat: fee, checkout_note: note });
      if (result.ok) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        <Field
          label="Delivery fee on every order"
          htmlFor="store-shipping"
          hint="Added once to a basket, whatever it holds"
          error={fieldError('shipping_flat')}
        >
          <Input
            id="store-shipping"
            type="number"
            min={0}
            step="0.01"
            value={fee}
            invalid={!!fieldError('shipping_flat')}
            onChange={(e) => setFee(e.target.value)}
          />
        </Field>

        <Field
          label="Note above the checkout button"
          htmlFor="store-note"
          hint={`${note.length}/500 · shown to the buyer before they order and again on their receipt`}
          error={fieldError('checkout_note')}
        >
          <Textarea
            id="store-note"
            rows={4}
            value={note}
            maxLength={500}
            placeholder="Payment is by bank transfer or UPI after we confirm the order. Delivery takes 3 to 5 working days."
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.refresh()}>
            Discard
          </Button>
          <Button variant="primary" loading={pending} disabled={!dirty} onClick={submit}>
            Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

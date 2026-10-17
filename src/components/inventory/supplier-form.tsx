'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createInvSupplier, updateInvSupplier } from '@/lib/actions/inventory';
import { Button, Field, FormStatus, Input, Textarea, useAction } from '@/components/ui';
import type { ActionState, InvSupplier } from '@/lib/types';

/**
 * A supplier, created or edited, in one screen.
 *
 * The name is the only thing that has to be right: two rows for one supplier is how an
 * order ends up addressed to the wrong place, and the table refuses the second row
 * whatever this form sends.
 */
export function SupplierForm({ orgId, supplier }: { orgId: string; supplier?: InvSupplier | null }) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [name, setName] = useState(supplier?.name ?? '');
  const [contact, setContact] = useState(supplier?.contact ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');

  const payload = { name, contact, email, phone, address, notes };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } =
        supplier ? await updateInvSupplier(supplier.id, payload) : await createInvSupplier(orgId, payload);
      if (result.ok && result.id) router.push(`/app/inventory/suppliers/${result.id}`);
      else if (result.ok && supplier) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier" htmlFor="sup-name" required error={fieldError('name')}>
            <Input id="sup-name" value={name} maxLength={120} invalid={!!fieldError('name')} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Who to ask for" htmlFor="sup-contact" error={fieldError('contact')}>
            <Input id="sup-contact" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="sup-email" error={fieldError('email')}>
            <Input id="sup-email" type="email" value={email} maxLength={254} invalid={!!fieldError('email')} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="sup-phone" error={fieldError('phone')}>
            <Input id="sup-phone" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>

        <Field label="Where goods come from" htmlFor="sup-address" error={fieldError('address')}>
          <Textarea id="sup-address" rows={2} value={address} maxLength={400} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <Field label="Notes" htmlFor="sup-notes" hint="Lead times, terms, the pallet rule — anything the next person ordering needs" error={fieldError('notes')}>
          <Textarea id="sup-notes" rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(supplier ? `/app/inventory/suppliers/${supplier.id}` : '/app/inventory/suppliers')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            {supplier ? 'Save supplier' : 'Add supplier'}
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button, FormStatus, Modal, useAction } from '@/components/ui';
import type { ActionState } from '@/lib/types';

/**
 * The delete control an owner or admin uses, behind a dialog that says what the
 * database will answer.
 *
 * Most of the time that answer is a refusal, and it should be: an item with stock
 * history, a supplier an order names, and an order with goods received are all records
 * of something that happened. The archive exists for the case a delete was really
 * meant to solve, which is why this button is offered to an admin alone.
 */
export function DeleteButton({
  action,
  redirectTo,
  title,
  body,
  label = 'Delete',
}: {
  action: () => Promise<ActionState>;
  redirectTo: string;
  title: string;
  body: string;
  label?: string;
}) {
  const router = useRouter();
  const { state, pending, run } = useAction();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <Trash2 size={14} aria-hidden="true" />
        {label}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={title} description={body}>
        <div className="grid gap-4">
          <FormStatus state={state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                void run(async () => {
                  const result = await action();
                  if (result.ok) {
                    setOpen(false);
                    router.push(redirectTo);
                  }
                  return result;
                })
              }
            >
              Delete for good
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

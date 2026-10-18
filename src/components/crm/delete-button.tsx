'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button, FormStatus, Modal, useAction } from '@/components/ui';
import type { ActionState } from '@/lib/types';

/**
 * The one delete control the CRM uses, wrapped in a dialog that says what goes with
 * the row. Deleting a contact takes their history with it (the activities cascade),
 * and deleting a stage is refused by the database when a deal still sits on it — so
 * the sentence here is the only warning a person gets before that answer arrives.
 *
 * It takes the Server Action and the row it names rather than a prepared call, because
 * a function written in a Server Component cannot be sent to the browser at all: React
 * refuses the prop and production shows only minified error #441 for the whole page.
 */
export function DeleteButton({
  action,
  id,
  redirectTo,
  title,
  body,
  label = 'Delete',
}: {
  action: (id: string) => Promise<ActionState>;
  id: string;
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
                  const result = await action(id);
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

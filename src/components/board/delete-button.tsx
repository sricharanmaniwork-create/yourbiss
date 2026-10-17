'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button, FormStatus, Modal, useAction } from '@/components/ui';
import type { ActionState } from '@/lib/types';

/**
 * The one delete control Projects uses.
 *
 * A board takes its lanes and cards with it (the rows cascade), and a lane is refused by the
 * database while it still holds cards. Both answers are sentences written in 0014 for the
 * person standing here, so this dialog asks once, then prints whatever the database said
 * rather than a second opinion of its own.
 */
export function DeleteButton({
  action,
  redirectTo,
  title,
  body,
  label = 'Delete',
  variant = 'danger',
}: {
  action: () => Promise<ActionState>;
  redirectTo: string;
  title: string;
  body: string;
  label?: string;
  variant?: 'danger' | 'outlineDanger';
}) {
  const router = useRouter();
  const { state, pending, run } = useAction();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
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

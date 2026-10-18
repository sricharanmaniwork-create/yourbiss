'use client';

import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';
import { Button, FormStatus, useAction } from '@/components/ui';
import type { ActionState, InvItemStatus } from '@/lib/types';

/**
 * Archive, or bring back.
 *
 * The app's answer to "I don't want this in the list any more" is this button rather
 * than a delete, because an item that has been counted and a supplier an order names
 * are both evidence of something that happened. The row stops appearing on the lists
 * and keeps every movement and document that points at it.
 *
 * It takes the Server Action and the row it names rather than two prepared calls,
 * because a function written in a Server Component cannot be sent to the browser at
 * all: React refuses the prop and production shows only minified error #441.
 */
export function ArchiveToggle({
  status,
  id,
  setStatus,
  subject,
}: {
  status: InvItemStatus;
  id: string;
  setStatus: (id: string, status: InvItemStatus) => Promise<ActionState>;
  subject: string;
}) {
  const router = useRouter();
  const { state, pending, run } = useAction();
  const archived = status === 'archived';

  return (
    <div className="flex flex-col items-start gap-2">
      <FormStatus state={state} />
      <Button
        variant="ghost"
        loading={pending}
        onClick={() =>
          void run(async () => {
            const result = await setStatus(id, archived ? 'active' : 'archived');
            if (result.ok) router.refresh();
            return result;
          })
        }
      >
        {archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
        {archived ? `Bring ${subject} back` : `Archive ${subject}`}
      </Button>
    </div>
  );
}

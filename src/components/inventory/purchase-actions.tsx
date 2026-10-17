'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, XCircle } from 'lucide-react';
import { moveInvPurchase } from '@/lib/actions/inventory';
import { Button, FormStatus, Modal, useAction } from '@/components/ui';
import type { InvPurchaseStatus } from '@/lib/types';

/**
 * The two moves an order can be given from a screen.
 *
 * Everything else the status column can hold is derived: `partially_received` and
 * `received` come from what the lines say after a receipt, and the trigger refuses an
 * order that is finished coming back. So the app offers Send and Call off, and a status
 * dropdown would only be a way to write a state the database has to work out.
 */
export function PurchaseActions({
  purchaseId,
  status,
  lineCount,
  number,
}: {
  purchaseId: string;
  status: InvPurchaseStatus;
  lineCount: number;
  number: string;
}) {
  const router = useRouter();
  const { state, pending, run } = useAction();
  const [confirming, setConfirming] = useState<'send' | 'cancel' | null>(null);

  const move = (transition: 'send' | 'cancel') => {
    void run(async () => {
      const result = await moveInvPurchase(purchaseId, transition);
      if (result.ok) {
        setConfirming(null);
        router.refresh();
      }
      return result;
    });
  };

  if (status !== 'draft' && status !== 'ordered' && status !== 'partially_received') {
    return (
      <p className="text-[12.5px] leading-relaxed text-muted">
        {number} is {status.replace(/_/g, ' ')}. A finished order stays as it is — the goods, the ledger and the
        supplier’s copy all agree about what happened.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        {status === 'draft' && (
          <Button variant="primary" disabled={lineCount === 0} onClick={() => setConfirming('send')}>
            <Send size={14} aria-hidden="true" />
            Send to supplier
          </Button>
        )}
        {status !== 'draft' && (
          <Button variant="outlineDanger" loading={pending} onClick={() => setConfirming('cancel')}>
            <XCircle size={14} aria-hidden="true" />
            Call the order off
          </Button>
        )}
      </div>

      <Modal
        open={confirming === 'send'}
        onClose={() => setConfirming(null)}
        title={`Send ${number}?`}
        description="The supplier gets a copy of these lines, so the order stops being editable here. Goods are received against it one delivery at a time."
      >
        <div className="grid gap-4">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'} will freeze, and so will the supplier, the dates and the
            note on the order.
          </p>
          <FormStatus state={state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Keep drafting
            </Button>
            <Button variant="primary" loading={pending} onClick={() => move('send')}>
              Send it
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirming === 'cancel'}
        onClose={() => setConfirming(null)}
        title={`Call off ${number}?`}
        description="Anything already received stays on the shelf — a cancellation stops the rest of the order, it does not undo a delivery."
      >
        <div className="grid gap-4">
          <FormStatus state={state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Leave it open
            </Button>
            <Button variant="danger" loading={pending} onClick={() => move('cancel')}>
              Call it off
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

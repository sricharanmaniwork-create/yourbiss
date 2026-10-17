'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Banknote, CheckCheck, XCircle } from 'lucide-react';
import { markStoreOrderPaid, moveStoreOrder } from '@/lib/actions/store';
import { Button, Field, FormStatus, Modal, Select, useAction } from '@/components/ui';
import type { StoreOrderStatus } from '@/lib/types';

const PAID_VIA: { value: string; label: string }[] = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'card_on_delivery', label: 'Card on delivery' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Something else' },
];

/**
 * What a person can do to an order from a screen.
 *
 * There is no status dropdown, because a state is not a field: `placed` means a visitor
 * left an address, `confirmed` means the goods have been taken off the shelf, `fulfilled`
 * means they went, and `cancelled` means one of those was undone. Each move is an RPC that
 * writes the stock entries and the status in the one transaction, so the buttons here can
 * offer a legal move and nothing else — and a double-clicked Confirm empties a shelf once.
 *
 * Payment sits apart from all four, because it is a timestamp and not a state: an order
 * can be shipped and unpaid, and both are true at the same time.
 */
export function OrderActions({
  orderId,
  number,
  status,
  paidLabel,
  trackedLines,
}: {
  orderId: string;
  number: string;
  status: StoreOrderStatus;
  /** Already written in the workspace's zone by the page, so this component never reads a clock. */
  paidLabel: string | null;
  /** How many lines are counted in Inventory, so confirming says what it is about to do. */
  trackedLines: number;
}) {
  const router = useRouter();
  const move = useAction();
  const pay = useAction();
  const [confirming, setConfirming] = useState<'confirmed' | 'fulfilled' | 'cancelled' | null>(null);
  const [paying, setPaying] = useState(false);
  const [via, setVia] = useState('bank');

  const run = (transition: 'confirmed' | 'fulfilled' | 'cancelled') => {
    void move.run(async () => {
      const result = await moveStoreOrder(orderId, transition);
      if (result.ok) {
        setConfirming(null);
        router.refresh();
      }
      return result;
    });
  };

  const markPaid = () => {
    void pay.run(async () => {
      const result = await markStoreOrderPaid(orderId, { paid_via: via });
      if (result.ok) {
        setPaying(false);
        router.refresh();
      }
      return result;
    });
  };

  return (
    <div className="grid gap-3">
      <FormStatus state={move.state} />

      <div className="flex flex-wrap gap-2">
        {status === 'placed' && (
          <Button variant="primary" onClick={() => setConfirming('confirmed')}>
            <BadgeCheck size={14} aria-hidden="true" />
            Confirm order
          </Button>
        )}
        {status === 'confirmed' && (
          <Button variant="primary" onClick={() => setConfirming('fulfilled')}>
            <CheckCheck size={14} aria-hidden="true" />
            Mark fulfilled
          </Button>
        )}
        {(status === 'placed' || status === 'confirmed') && (
          <Button variant="outlineDanger" onClick={() => setConfirming('cancelled')}>
            <XCircle size={14} aria-hidden="true" />
            Call it off
          </Button>
        )}
      </div>

      {paidLabel ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Marked paid {paidLabel}. A payment that happened keeps its date — the database refuses an un-marking, because
          a wrong entry is corrected by a note, not by deleting the fact.
        </p>
      ) : status === 'cancelled' ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {number} was called off, so nothing is owed on it.
        </p>
      ) : paying ? (
        <div className="grid gap-3 rounded-md border border-line bg-raised px-3.5 py-3">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            The money arrived outside this app. Record how, and the order stops being owed.
          </p>
          <Field label="How it was paid" htmlFor={`paid-via-${orderId}`}>
            <Select id={`paid-via-${orderId}`} value={via} onChange={(e) => setVia(e.target.value)}>
              {PAID_VIA.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <FormStatus state={pay.state} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPaying(false)}>
              Not yet
            </Button>
            <Button variant="primary" loading={pay.pending} onClick={markPaid}>
              <Banknote size={14} aria-hidden="true" />
              Mark it paid
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setPaying(true)}>
          <Banknote size={14} aria-hidden="true" />
          The money has arrived
        </Button>
      )}

      <Modal
        open={confirming === 'confirmed'}
        onClose={() => setConfirming(null)}
        title={`Confirm ${number}?`}
        description="Confirming is the moment the goods leave the shelf. The lines freeze, the totals become permanent, and Inventory is asked whether there is enough."
      >
        <div className="grid gap-4">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            {trackedLines === 0
              ? 'No line on this order is counted in Inventory, so confirming moves no stock — it only says the order is accepted.'
              : `${trackedLines} of the line${trackedLines === 1 ? '' : 's'} hold${trackedLines === 1 ? 's' : ''} something counted, and confirming takes them out of the ledger in one entry each. If the shelf is short, the database refuses the whole move and nothing is written.`}
          </p>
          <FormStatus state={move.state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Leave it placed
            </Button>
            <Button variant="primary" loading={move.pending} onClick={() => run('confirmed')}>
              Confirm it
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirming === 'fulfilled'}
        onClose={() => setConfirming(null)}
        title={`Mark ${number} fulfilled?`}
        description="The goods went. This is the last legal move an order has: a fulfilled document cannot be reopened, and correcting it means a new entry on the ledger, not a rewrite."
      >
        <div className="grid gap-4">
          <FormStatus state={move.state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Still with us
            </Button>
            <Button variant="primary" loading={move.pending} onClick={() => run('fulfilled')}>
              It has gone
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirming === 'cancelled'}
        onClose={() => setConfirming(null)}
        title={`Call off ${number}?`}
        description={
          status === 'confirmed'
            ? 'The goods already left the shelf, so cancelling puts them back — one return entry per counted line, with this order’s number as the reason.'
            : 'Nobody has accepted this order yet, so cancelling leaves no trace on the shelf at all. It stays in the list as a record that it happened.'        }
      >
        <div className="grid gap-4">
          <FormStatus state={move.state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Keep working on it
            </Button>
            <Button variant="danger" loading={move.pending} onClick={() => run('cancelled')}>
              Call it off
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

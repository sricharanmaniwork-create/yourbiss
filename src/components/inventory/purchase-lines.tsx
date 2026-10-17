'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { addInvLine, deleteInvLine, receiveInvLine, updateInvLine } from '@/lib/actions/inventory';
import { Button, Field, FormStatus, Input, Modal, Select, Table, TBody, TD, TH, THead, TR, useAction } from '@/components/ui';
import { formatAmount } from '@/lib/utils';
import type { InvPurchaseLine, InvPurchaseStatus } from '@/lib/types';

/**
 * The lines of an order, and the only two roads goods take from here.
 *
 * While the order is a draft a line is a pencil mark: added, changed, taken off. The
 * moment it is sent the lines stop moving, because the supplier is holding the same
 * list, and the only thing that may still change is how much of it has arrived — and
 * that goes through `inv_post_receipt`, which writes the movement onto the shelf and
 * the line's received quantity in one decision. A line is never marked received by
 * hand.
 */
export function PurchaseLines({
  purchaseId,
  status,
  items,
  lines,
  currency,
  locale = 'en-IN',
}: {
  purchaseId: string;
  status: InvPurchaseStatus;
  items: { id: string; name: string; unit: string; cost: number }[];
  lines: InvPurchaseLine[];
  currency: string;
  locale?: string;
}) {
  const router = useRouter();
  const add = useAction();
  const edit = useAction();
  const remove = useAction();
  const receive = useAction();

  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState(items[0] ? String(items[0].cost) : '');
  const [description, setDescription] = useState('');

  const [open, setOpen] = useState<InvPurchaseLine | null>(null);
  const [form, setForm] = useState({ item_id: '', description: '', qty: '', unit_cost: '' });
  const [counts, setCounts] = useState<Record<string, string>>({});

  const draft = status === 'draft';
  const receivable = status === 'ordered' || status === 'partially_received';
  const chosen = items.find((item) => item.id === itemId);

  const pickItem = (id: string) => {
    setItemId(id);
    const item = items.find((entry) => entry.id === id);
    if (item) setUnitCost(String(item.cost));
  };

  const submitLine = () => {
    void add.run(async () => {
      const result = await addInvLine(purchaseId, { item_id: itemId, description, qty, unit_cost: unitCost });
      if (result.ok) {
        setQty('');
        setDescription('');
        router.refresh();
      }
      return result;
    });
  };

  const openEditor = (line: InvPurchaseLine) => {
    setOpen(line);
    setForm({ item_id: line.item_id, description: line.description, qty: String(line.qty), unit_cost: String(line.unit_cost) });
  };

  const saveLine = () => {
    if (!open) return;
    void edit.run(async () => {
      const result = await updateInvLine(open.id, form);
      if (result.ok) {
        setOpen(null);
        router.refresh();
      }
      return result;
    });
  };

  const removeLine = (line: InvPurchaseLine) => {
    void remove.run(async () => {
      const result = await deleteInvLine(line.id);
      if (result.ok) router.refresh();
      return result;
    });
  };

  const postReceipt = (line: InvPurchaseLine) => {
    const outstanding = Number(line.qty) - Number(line.received_qty);
    const typed = counts[line.id] ?? '';
    const quantity = typed === '' ? outstanding : Number(typed);
    void receive.run(async () => {
      const result = await receiveInvLine(line.id, quantity);
      if (result.ok) {
        setCounts((current) => ({ ...current, [line.id]: '' }));
        router.refresh();
      }
      return result;
    });
  };

  return (
    <div className="grid gap-3">
      <div className="ui-card overflow-hidden">
        <Table>
          <THead>
            <TH>Line</TH>
            <TH align="right">Qty</TH>
            <TH align="right">Cost each</TH>
            <TH align="right">Total</TH>
            <TH align="right">Received</TH>
            {receivable && <TH align="right">Arriving now</TH>}
            {draft && <TH align="right">Change</TH>}
          </THead>
          <TBody>
            {lines.length === 0 ? (
              <TR>
                <TD colSpan={draft ? 6 : receivable ? 6 : 5} className="text-[12.5px] text-muted">
                  Nothing on this order yet{draft ? ' — an order needs at least one line before it can be sent.' : '.'}
                </TD>
              </TR>
            ) : (
              lines.map((line) => {
                const outstanding = Number(line.qty) - Number(line.received_qty);
                return (
                  <TR key={line.id}>
                    <TD>
                      <span className="block text-[13px] text-ink">{line.description}</span>
                      {line.item ? (
                        <span className="block text-[11.5px] text-muted">
                          {line.item.name}
                          {line.item.sku ? ` · ${line.item.sku}` : ''} · counted in {line.item.unit}
                        </span>
                      ) : (
                        <span className="block text-[11.5px] text-muted">the item this was written against is gone</span>
                      )}
                    </TD>
                    <TD align="right" className="tabular-nums">{Number(line.qty)}</TD>
                    <TD align="right" className="tabular-nums">{formatAmount(Number(line.unit_cost), currency, locale)}</TD>
                    <TD align="right" className="tabular-nums font-medium">{formatAmount(Number(line.total), currency, locale)}</TD>
                    <TD align="right" className="tabular-nums">
                      {Number(line.received_qty)}
                      {outstanding > 0 && <span className="text-muted"> of {Number(line.qty)}</span>}
                    </TD>
                    {receivable && (
                      <TD align="right">
                        {outstanding > 0 ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Input
                              aria-label={`How many of ${line.description} arrived`}
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 w-[92px] text-right"
                              value={counts[line.id] ?? ''}
                              placeholder={String(outstanding)}
                              onChange={(event) => setCounts((current) => ({ ...current, [line.id]: event.target.value }))}
                            />
                            <Button size="sm" variant="secondary" loading={receive.pending} onClick={() => postReceipt(line)}>
                              Receive
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted">complete</span>
                        )}
                      </TD>
                    )}
                    {draft && (
                      <TD align="right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openEditor(line)}>
                            Change
                          </Button>
                          <Button size="sm" variant="ghost" loading={remove.pending} onClick={() => removeLine(line)}>
                            Remove
                          </Button>
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </div>

      <FormStatus state={add.state} />
      <FormStatus state={receive.state} />

      {draft && (
        <div className="ui-card px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(180px,1fr)_110px_130px_auto] sm:items-end">
            <Field label="Item" htmlFor="line-item">
              <Select id="line-item" value={itemId} onChange={(event) => pickItem(event.target.value)}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity" htmlFor="line-qty" required>
              <Input id="line-qty" type="number" min={0} step="0.01" value={qty} onChange={(event) => setQty(event.target.value)} />
            </Field>
            <Field label="Cost each" htmlFor="line-cost" hint={chosen ? `last cost ${chosen.cost}` : undefined}>
              <Input id="line-cost" type="number" min={0} step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
            </Field>
            <Button
              variant="primary"
              loading={add.pending}
              disabled={itemId === '' || !(Number(qty) > 0)}
              onClick={submitLine}
            >
              <Plus size={14} aria-hidden="true" />
              Add line
            </Button>
          </div>
          <Field label="Wording on the order" htmlFor="line-description" hint="Blank uses the item’s name" className="mt-4">
            <Input id="line-description" value={description} maxLength={140} onChange={(event) => setDescription(event.target.value)} />
          </Field>
        </div>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title="Change this line"
        description="The order is still a draft, so the supplier has not seen this line yet."
      >
        <div className="grid gap-4">
          <Field label="Item" htmlFor="edit-item">
            <Select
              id="edit-item"
              value={form.item_id}
              onChange={(event) => {
                const item = items.find((entry) => entry.id === event.target.value);
                setForm((current) => ({
                  ...current,
                  item_id: event.target.value,
                  description: current.description === '' && item ? `${item.name} (${item.unit})` : current.description,
                }));
              }}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Wording on the order" htmlFor="edit-description">
            <Input
              id="edit-description"
              value={form.description}
              maxLength={140}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="edit-qty">
              <Input
                id="edit-qty"
                type="number"
                min={0}
                step="0.01"
                value={form.qty}
                onChange={(event) => setForm((current) => ({ ...current, qty: event.target.value }))}
              />
            </Field>
            <Field label="Cost each" htmlFor="edit-cost">
              <Input
                id="edit-cost"
                type="number"
                min={0}
                step="0.01"
                value={form.unit_cost}
                onChange={(event) => setForm((current) => ({ ...current, unit_cost: event.target.value }))}
              />
            </Field>
          </div>
          <FormStatus state={edit.state} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Leave it
            </Button>
            <Button variant="primary" loading={edit.pending} onClick={saveLine}>
              Save line
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

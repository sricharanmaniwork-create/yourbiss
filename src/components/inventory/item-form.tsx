'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createInvItem, updateInvItem } from '@/lib/actions/inventory';
import { Button, Field, FormStatus, Input, Select, Switch, Textarea, useAction } from '@/components/ui';
import type { ActionState, InvItem, InvItemKind } from '@/lib/types';

/**
 * An item, created or edited, in one screen.
 *
 * `kind` and the counted flag stop being editable the moment the ledger has a row for
 * this item, and the form says so rather than letting the change be typed and then
 * refused: what an item *is* is what every past movement means, so flipping a counted
 * product into a service would rewrite the story of a shelf that was already counted.
 */
export function ItemForm({
  orgId,
  item,
  hasHistory = false,
  storeEnabled = false,
}: {
  orgId: string;
  item?: InvItem | null;
  hasHistory?: boolean;
  storeEnabled?: boolean;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [kind, setKind] = useState<InvItemKind>(item?.kind ?? 'product');
  const [unit, setUnit] = useState(item?.unit ?? 'pcs');
  const [price, setPrice] = useState(String(item?.price ?? '0'));
  const [cost, setCost] = useState(String(item?.cost ?? '0'));
  const [trackStock, setTrackStock] = useState(item?.track_stock ?? true);
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point === null || item?.reorder_point === undefined ? '' : String(item.reorder_point));
  const [taxRate, setTaxRate] = useState(String(item?.tax_rate_pct ?? '0'));
  const [sellOnline, setSellOnline] = useState(item?.sell_online ?? false);
  const [description, setDescription] = useState(item?.description ?? '');
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');

  const counted = kind === 'product' && trackStock;
  const frozen = hasHistory;

  const payload = {
    name,
    sku,
    kind,
    unit,
    price,
    cost,
    track_stock: trackStock,
    reorder_point: reorderPoint,
    tax_rate_pct: taxRate,
    sell_online: sellOnline,
    description,
    image_url: imageUrl,
  };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } =
        item ? await updateInvItem(item.id, payload) : await createInvItem(orgId, payload);
      if (result.ok && result.id) router.push(`/app/inventory/items/${result.id}`);
      else if (result.ok && item) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        {frozen && (
          <p className="rounded-md border border-[#dfe3e9] bg-[#eef0f3] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#41474f]">
            This item has stock history, so what it is stays as it was: its kind and whether it is counted are frozen.
            Its price, cost, description and picture are free to change — those are facts about the market, not about
            the shelf.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="inv-name" required error={fieldError('name')}>
            <Input id="inv-name" value={name} maxLength={140} invalid={!!fieldError('name')} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Stock code" htmlFor="inv-sku" hint="Optional, and unique here whatever the case" error={fieldError('sku')}>
            <Input
              id="inv-sku"
              value={sku}
              maxLength={40}
              placeholder="POST-A4"
              spellCheck={false}
              invalid={!!fieldError('sku')}
              onChange={(e) => setSku(e.target.value)}
            />
          </Field>
          <Field label="What it is" htmlFor="inv-kind" hint={frozen ? undefined : 'A service has no shelf to run out of'}>
            <Select id="inv-kind" value={kind} disabled={frozen} onChange={(e) => setKind(e.target.value as InvItemKind)}>
              <option value="product">Product — something you hold</option>
              <option value="service">Service — something you do</option>
            </Select>
          </Field>
          <Field label="Unit" htmlFor="inv-unit" hint="What one of them means: pcs, hrs, kg" error={fieldError('unit')}>
            <Input id="inv-unit" value={unit} maxLength={24} spellCheck={false} invalid={!!fieldError('unit')} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Selling price" htmlFor="inv-price" error={fieldError('price')}>
            <Input id="inv-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Last cost" htmlFor="inv-cost" hint="What it cost when it arrived" error={fieldError('cost')}>
            <Input id="inv-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
          <Field label="Counted in stock" htmlFor="inv-track" hint={kind === 'service' ? 'A service is not counted' : undefined}>
            <div className="flex h-9 items-center gap-2.5">
              <Switch id="inv-track" checked={trackStock} disabled={frozen || kind === 'service'} onChange={setTrackStock} label="Counted in stock" />
              <span className="text-[12.5px] text-muted">{trackStock && kind === 'product' ? 'Yes, it sits on a shelf' : 'No, nothing to run out of'}</span>
            </div>
          </Field>
          <Field
            label="Reorder point"
            htmlFor="inv-reorder"
            hint={counted ? 'The hub says so when the shelf reaches this number' : 'Only an item that is counted has a level to fall to'}
            error={fieldError('reorder_point')}
          >
            <Input
              id="inv-reorder"
              type="number"
              min={0}
              step="0.01"
              value={reorderPoint}
              disabled={!counted}
              placeholder="no warning"
              onChange={(e) => setReorderPoint(e.target.value)}
            />
          </Field>
          <Field
            label="Tax on online sales"
            htmlFor="inv-tax"
            hint="A percentage added to the price when Store bills a basket"
            error={fieldError('tax_rate_pct')}
          >
            <Input
              id="inv-tax"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxRate}
              invalid={!!fieldError('tax_rate_pct')}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-md border border-line bg-raised px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Sell this item on the storefront</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                {storeEnabled
                  ? 'A visitor can put it in a cart and order it. Nothing is on sale until it is turned on here, one item at a time.'
                  : 'Store is switched off for this workspace, so nothing shows for a visitor yet — the flag is kept for when it is turned on.'}
              </p>
            </div>
            <Switch checked={sellOnline} onChange={setSellOnline} label="Sell this item on the storefront" />
          </div>
          {sellOnline && counted && (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              This item is counted, so a cart is checked against the shelf when it is placed and the quantity leaves the
              ledger when the order is confirmed.
            </p>
          )}
        </div>

        <Field label="Description" htmlFor="inv-description" hint="Shown to nobody but your team" error={fieldError('description')}>
          <Textarea id="inv-description" rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <Field label="Picture" htmlFor="inv-image" hint="An https address — used when this item appears on your website" error={fieldError('image_url')}>
          <Input id="inv-image" value={imageUrl} maxLength={600} spellCheck={false} placeholder="https://…" invalid={!!fieldError('image_url')} onChange={(e) => setImageUrl(e.target.value)} />
        </Field>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(item ? `/app/inventory/items/${item.id}` : '/app/inventory/items')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            {item ? 'Save item' : 'Add item'}
          </Button>
        </div>
      </div>
    </div>
  );
}

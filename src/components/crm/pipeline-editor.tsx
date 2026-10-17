'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { createCrmStage, deleteCrmStage, reorderCrmStages, updateCrmStage } from '@/lib/actions/crm';
import { Button, Field, FormStatus, Input, useAction } from '@/components/ui';
import type { CrmStage } from '@/lib/types';

/**
 * The funnel is the workspace's own list, so this screen edits rows and not an enum.
 *
 * Two things are deliberately not editable, and both are the database's rules rather
 * than a UI choice: a stage keeps its kind, because changing &ldquo;Proposal sent&rdquo;
 * into &ldquo;Won&rdquo; would silently re-time every deal that ever sat on it; and the
 * closing stages cannot be deleted, because a deal has to have somewhere to close.
 * Reordering moves the open stages only, and the positions are written in gaps of
 * ten so a stage can still be dropped between two others later.
 */
export function PipelineEditor({ orgId, stages }: { orgId: string; stages: CrmStage[] }) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(stages.map((s) => [s.id, s.name])));
  const [colors, setColors] = useState<Record<string, string>>(() => Object.fromEntries(stages.map((s) => [s.id, s.color])));
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#2E6BE6');

  const open = stages.filter((stage) => stage.kind === 'open');
  const closing = stages.filter((stage) => stage.kind !== 'open');

  const refresh = () => router.refresh();

  const save = (stage: CrmStage) => {
    void run(async () => {
      const result = await updateCrmStage(stage.id, { name: names[stage.id] ?? stage.name, color: colors[stage.id] ?? stage.color });
      if (result.ok) refresh();
      return result;
    });
  };

  const add = () => {
    void run(async () => {
      const result = await createCrmStage(orgId, { name: newName, color: newColor });
      if (result.ok) {
        setNewName('');
        refresh();
      }
      return result;
    });
  };

  const remove = (stage: CrmStage) => {
    void run(async () => {
      const result = await deleteCrmStage(stage.id);
      if (result.ok) refresh();
      return result;
    });
  };

  const move = (index: number, delta: number) => {
    const next = [...open];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;

    void run(async () => {
      const result = await reorderCrmStages(orgId, next.map((stage) => stage.id));
      if (result.ok) refresh();
      return result;
    });
  };

  return (
    <div className="grid gap-3">
      <FormStatus state={state} />

      {open.map((stage, index) => (
        <div key={stage.id} className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface px-3.5 py-3">
          <span className="w-[26px] flex-none pb-2 text-center text-[12px] text-muted">{index + 1}</span>

          <Field label="Stage" htmlFor={`stage-name-${stage.id}`} className="min-w-[200px] flex-1" error={fieldError('name')}>
            <Input
              id={`stage-name-${stage.id}`}
              value={names[stage.id] ?? ''}
              maxLength={60}
              invalid={!!fieldError('name')}
              onChange={(event) => setNames((current) => ({ ...current, [stage.id]: event.target.value }))}
            />
          </Field>

          <Field label="Colour" htmlFor={`stage-color-${stage.id}`}>
            <Input
              id={`stage-color-${stage.id}`}
              type="color"
              className="h-9 w-[52px] cursor-pointer p-1"
              value={colors[stage.id] ?? '#000000'}
              onChange={(event) => setColors((current) => ({ ...current, [stage.id]: event.target.value }))}
            />
          </Field>

          <span className="pb-1 text-[11.5px] text-muted">
            {stage.deal_count ?? 0} deal{(stage.deal_count ?? 0) === 1 ? '' : 's'}
          </span>

          <span className="flex flex-none items-center gap-1 pb-1">
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0 || pending}
              aria-label={`Move ${stage.name} up`}
              className="rounded-md border border-line p-1.5 text-muted hover:border-brand hover:text-brand disabled:opacity-40"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === open.length - 1 || pending}
              aria-label={`Move ${stage.name} down`}
              className="rounded-md border border-line p-1.5 text-muted hover:border-brand hover:text-brand disabled:opacity-40"
            >
              <ArrowDown size={13} />
            </button>
            <Button variant="secondary" size="sm" loading={pending} disabled={(names[stage.id] ?? '') === stage.name && (colors[stage.id] ?? '') === stage.color} onClick={() => save(stage)}>
              Save
            </Button>
            <button
              type="button"
              onClick={() => remove(stage)}
              aria-label={`Remove ${stage.name}`}
              disabled={pending || (stage.deal_count ?? 0) > 0}
              title={(stage.deal_count ?? 0) > 0 ? 'Move its deals somewhere else first' : 'Remove this stage'}
              className="rounded-md p-1.5 text-muted hover:bg-[#fcebea] hover:text-[#a50f0f] disabled:opacity-40"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed border-line bg-raised px-3.5 py-3">
        <Field label="Add a stage" htmlFor="stage-new-name" className="min-w-[200px] flex-1" error={fieldError('name')}>
          <Input
            id="stage-new-name"
            value={newName}
            maxLength={60}
            placeholder="Site visit"
            onChange={(event) => setNewName(event.target.value)}
          />
        </Field>
        <Field label="Colour" htmlFor="stage-new-color">
          <Input
            id="stage-new-color"
            type="color"
            className="h-9 w-[52px] cursor-pointer p-1"
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
          />
        </Field>
        <Button variant="secondary" loading={pending} disabled={newName.trim() === ''} onClick={add}>
          <Plus size={14} aria-hidden="true" />
          Add at the end
        </Button>
      </div>

      <div className="rounded-md border border-line bg-surface px-3.5 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">How a deal closes</p>
        <ul className="mt-2 space-y-1.5">
          {closing.map((stage) => (
            <li key={stage.id} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
              {stage.name}
              <span className="text-[11.5px] text-muted">
                · {stage.kind === 'won' ? 'lands the money' : 'ends the deal'} · {stage.deal_count ?? 0} deal
                {(stage.deal_count ?? 0) === 1 ? '' : 's'} on it
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          These two exist in every workspace, one each, and cannot be renamed into something else or removed: a deal
          that is won is counted as revenue and one that is lost is not, and that distinction is what the board adds up.
        </p>
      </div>
    </div>
  );
}

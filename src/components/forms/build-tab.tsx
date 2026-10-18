'use client';

import { useMemo, useState, useTransition } from 'react';
import { Copy, GripVertical, Trash } from 'lucide-react';
import type { ActionState } from '@/lib/types';
import type { FieldKind, FormFieldDef, LogicOperator, MatrixAxes, RatingSymbol } from '@/lib/forms/types';
import {
  ADDRESS_PARTS,
  ADDRESS_PARTS_DEFAULT,
  FIELD_KIND_LABELS,
  MATRIX_MAX_COLUMNS,
  MATRIX_MAX_ROWS,
  NAME_PARTS,
  NAME_PARTS_DEFAULT,
  OPTION_BEARING,
  SINGLE_CHOICE,
  blankField,
  choiceLabel,
  choiceValues,
  collectsMany,
  compositeParts,
  isComposite,
  isPresentational,
  partLabel,
} from '@/lib/forms/types';
import { saveFormDefinition } from '@/lib/actions/forms';
import { Button, Field, FormStatus, Input, Select, Switch, Textarea, toast, useFieldId } from '@/components/ui';
import type { FormDocument } from './form-overview';

/** A field's own `validation` bag — every rule a question can carry. */
type Rules = NonNullable<FormFieldDef['validation']>;

/**
 * Building the questions.
 *
 * A row shows what the visitor will see — label, help text, a mock of the control —
 * so the list itself is the preview, the way a paper form looks while you write it.
 * Nothing here can be typed into: the answers belong to the inspector on the right,
 * which is the only place a field is changed.
 *
 * A draft may be saved half-finished. `saveFormDefinition` accepts an empty list
 * because a form two questions into being built has to survive a save, and Publish
 * is what refuses an empty one.
 */

const GROUPS: { label: string; kinds: FieldKind[] }[] = [
  {
    label: 'Questions',
    kinds: [
      'text', 'textarea', 'name', 'email', 'phone', 'url', 'number', 'rupees', 'currency', 'date', 'datetime',
      'monthyear', 'time', 'rating', 'slider', 'signature', 'geolocation',
    ],
  },
  {
    label: 'Choices',
    kinds: ['select', 'radio', 'checkbox', 'multiselect', 'checkbox_single', 'image_choice', 'yes_or_no', 'decision', 'matrix'],
  },
  { label: 'Layout', kinds: ['section', 'heading', 'note', 'divider', 'spacer'] },
];

/** Kinds that can start with an answer already in the box. */
const DEFAULTABLE: FieldKind[] = [
  'text', 'textarea', 'name', 'email', 'phone', 'url', 'number', 'rupees', 'currency', 'date', 'time',
  'select', 'radio', 'checkbox', 'multiselect', 'image_choice', 'yes_or_no',
];

const RATING_SYMBOLS: RatingSymbol[] = ['number', 'star', 'heart', 'thumb', 'smiley'];

const RATING_SYMBOL_LABELS: Record<RatingSymbol, string> = {
  number: 'Numbers',
  star: 'Stars',
  heart: 'Hearts',
  thumb: 'Thumbs up',
  smiley: 'Smileys',
};

const OPERATORS: LogicOperator[] = ['is', 'is_not', 'contains', 'is_empty', 'is_filled', 'gt', 'lt'];

const OPERATOR_LABELS: Record<LogicOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  is_empty: 'is empty',
  is_filled: 'is filled',
  gt: 'is greater than',
  lt: 'is less than',
};

/** `is empty` and `is filled` read the answer alone, so they take no value. */
function needsValue(operator: LogicOperator): boolean {
  return operator !== 'is_empty' && operator !== 'is_filled';
}

export function BuildTab({
  form,
  orgSlug,
  canManage,
  onSaved,
}: {
  form: FormDocument;
  orgSlug: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<FormFieldDef[]>(form.fields);
  const [selected, setSelected] = useState<string | null>(form.fields[0]?.id ?? null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const saved = JSON.stringify(form.fields);
  const dirty = useMemo(() => JSON.stringify(fields) !== saved, [fields, saved]);
  const current = fields.find((field) => field.id === selected) ?? null;

  const add = (kind: FieldKind) => {
    const field = blankField(kind, fields.length + 1);
    setFields((previous) => [...previous, field]);
    setSelected(field.id);
  };

  const patch = (id: string, changes: Partial<FormFieldDef>) => {
    setFields((previous) => previous.map((field) => (field.id === id ? { ...field, ...changes } : field)));
  };

  const move = (id: string, delta: number) => {
    setFields((previous) => {
      const from = previous.findIndex((field) => field.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= previous.length) return previous;
      const next = [...previous];
      const [taken] = next.splice(from, 1);
      next.splice(to, 0, taken as FormFieldDef);
      return next;
    });
  };

  const drop = (id: string) => {
    if (!dragging || dragging === id) return;
    setFields((previous) => {
      const from = previous.findIndex((field) => field.id === dragging);
      const to = previous.findIndex((field) => field.id === id);
      if (from < 0 || to < 0) return previous;
      const next = [...previous];
      const [taken] = next.splice(from, 1);
      next.splice(to, 0, taken as FormFieldDef);
      return next;
    });
    setDragging(null);
  };

  const duplicate = (id: string) => {
    setFields((previous) => {
      const index = previous.findIndex((field) => field.id === id);
      if (index < 0) return previous;
      const source = previous[index] as FormFieldDef;
      // A copy needs its own id, because two fields answering to one key would make
      // a stored response ambiguous, and it starts with no rules of its own.
      const copy: FormFieldDef = {
        ...source,
        id: `${source.id}_copy_${Math.random().toString(36).slice(2, 6)}`.slice(0, 64),
        logic: undefined,
      };
      const next = [...previous];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const remove = (id: string) => {
    // Deleting also drops every rule that read the field: a condition pointing at a
    // field that no longer exists is something Publish refuses, not a state to save.
    setFields((previous) =>
      previous
        .filter((field) => field.id !== id)
        .map((field) =>
          field.logic
            ? { ...field, logic: { ...field.logic, conditions: field.logic.conditions.filter((c) => c.field_id !== id) } }
            : field,
        ),
    );
    if (selected === id) setSelected(null);
  };

  const save = () => {
    setState(null);
    startTransition(async () => {
      const result = await saveFormDefinition(form.id, {
        title: form.title,
        description: form.description,
        slug: form.slug,
        fields,
        // Moving a row here changes `fields` itself, so the stored order is written
        // back to agree with it. `orderedFields` would otherwise prefer an older
        // `field_order` and show the visitor a sequence nobody has seen for a while.
        settings: { ...form.settings, field_order: fields.map((field) => field.id) },
        theme: form.theme,
      }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'The form could not be saved' }));
      setState(result);
      if (!result.ok) return;
      toast.success('Form saved');
      onSaved();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="ui-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-[13.5px] font-semibold text-ink">Questions</p>
            <p className="text-[12px] text-muted">
              {fields.length === 0
                ? canManage
                  ? 'Nothing yet. Pick a field type below to start.'
                  : 'This form asks nothing yet.'
                : `${fields.length} field${fields.length === 1 ? '' : 's'} · visitors answer at /f/${orgSlug}/${form.slug}`}
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              {dirty && (
                <Button variant="ghost" onClick={() => setFields(form.fields)}>
                  Discard
                </Button>
              )}
              <Button variant="primary" loading={pending} disabled={!dirty} onClick={save}>
                Save form
              </Button>
            </div>
          )}
        </header>

        <div className="px-4 py-3">
          <FormStatus state={state} />

          {canManage && (
            <div className="mb-4 grid gap-2.5">
              {GROUPS.map((group) => (
                <div key={group.label} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[86px] flex-none text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                    {group.label}
                  </span>
                  {group.kinds.map((kind) => (
                    <button
                      type="button"
                      key={kind}
                      onClick={() => add(kind)}
                      className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:border-brand hover:text-ink"
                    >
                      + {FIELD_KIND_LABELS[kind]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {fields.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
              This form asks nothing yet.
            </p>
          ) : (
            <ul className="grid gap-2">
              {fields.map((field, index) => (
                <li
                  key={field.id}
                  draggable={canManage}
                  onDragStart={() => setDragging(field.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => drop(field.id)}
                  onDragEnd={() => setDragging(null)}
                  className={`rounded-md border px-3 py-2.5 transition-colors ${
                    selected === field.id ? 'border-brand bg-brand-soft/40' : 'border-line bg-canvas'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {canManage && (
                      <span className="mt-1 cursor-grab text-muted" aria-hidden="true">
                        <GripVertical size={14} />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(field.id)}
                      className="min-w-0 flex-1 text-left"
                      aria-pressed={selected === field.id}
                    >
                      <Row field={field} />
                    </button>
                    {canManage && (
                      <div className="flex flex-none items-center gap-1">
                        <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => move(field.id, -1)} aria-label="Move up">
                          ↑
                        </Button>
                        <Button variant="ghost" size="sm" disabled={index === fields.length - 1} onClick={() => move(field.id, 1)} aria-label="Move down">
                          ↓
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => duplicate(field.id)} aria-label={`Duplicate ${field.label}`}>
                          <Copy size={13} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(field.id)} aria-label={`Delete ${field.label}`}>
                          <Trash size={13} />
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!canManage && (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              The Forms app is switched off for this workspace, so these questions can be read but not changed. An owner
              or admin turns it back on in Settings.
            </p>
          )}
        </div>
      </section>

      <aside className="ui-card lg:sticky lg:top-4 lg:self-start">
        {current ? (
          <FieldInspector
            key={current.id}
            field={current}
            others={fields.filter((field) => field.id !== current.id)}
            canManage={canManage}
            onChange={(changes) => patch(current.id, changes)}
          />
        ) : (
          <p className="px-4 py-6 text-[12.5px] leading-relaxed text-muted">
            Choose a question on the left to change its label, its rules, or when it appears.
          </p>
        )}
      </aside>
    </div>
  );
}

/** What the row shows: the question as the visitor will read it. */
function Row({ field }: { field: FormFieldDef }) {
  const label = field.label || FIELD_KIND_LABELS[field.type];

  if (field.type === 'divider') return <hr className="my-2 border-t border-line" />;
  if (field.type === 'spacer') return <div className="h-6 rounded bg-canvas" />;
  if (field.type === 'note') return <p className="text-[12.5px] leading-relaxed text-ink-soft">{field.label}</p>;

  if (field.type === 'section' || field.type === 'heading') {
    return <p className="text-[13.5px] font-semibold text-ink">{label}</p>;
  }

  const rules = field.logic?.conditions.length ?? 0;

  return (
    <div>
      <p className="text-[13px] font-medium text-ink">
        {label}
        {field.required && <span className="ml-1 text-[#d92d20]">*</span>}
        <span className="ml-2 text-[11px] font-normal text-muted">{FIELD_KIND_LABELS[field.type]}</span>
      </p>
      {field.help && <p className="mt-0.5 text-[11.5px] text-muted">{field.help}</p>}
      <Mock field={field} />
      {rules > 0 && (
        <p className="mt-1.5 text-[11px] text-brand">
          {field.logic?.action === 'show' ? 'Shown only when ' : 'Hidden when '}
          {rules === 1 ? '1 rule matches' : `${field.logic?.match === 'all' ? 'all' : 'any'} of ${rules} rules match`}
        </p>
      )}
    </div>
  );
}

function Mock({ field }: { field: FormFieldDef }) {
  const box = 'mt-1.5 h-8 rounded-md border border-line bg-white';
  const chip = 'inline-block h-3 w-3 border border-line bg-white';
  switch (field.type) {
    case 'textarea':
      return <div className="mt-1.5 h-16 rounded-md border border-line bg-white" />;

    case 'name':
    case 'address':
      return (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {compositeParts(field).map((part) => (
            <span key={part} className="grid gap-0.5 text-[11px] text-muted">
              <span>{partLabel(field, part)}</span>
              <span className="h-7 rounded-md border border-line bg-white" />
            </span>
          ))}
        </div>
      );

    case 'radio':
    case 'checkbox':
    case 'multiselect':
    case 'yes_or_no':
      return (
        <div className={`mt-1.5 grid gap-1 ${field.inline_choices ? 'grid-flow-col justify-start' : ''}`}>
          {(field.type === 'yes_or_no' ? [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] : (field.options ?? []).slice(0, 3)).map(
            (option) => (
              <span key={option.value} className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className={`${chip} ${['radio', 'yes_or_no'].includes(field.type) ? 'rounded-full' : 'rounded-sm'}`} />
                {option.label}
              </span>
            ),
          )}
        </div>
      );

    case 'image_choice':
      return (
        <div className="mt-1.5 flex gap-1.5">
          {(field.options ?? []).slice(0, 3).map((option) => (
            <span key={option.value} className="grid gap-1 text-center text-[11px] text-muted">
              <span className="h-10 w-16 rounded border border-line bg-canvas" />
              {option.label}
            </span>
          ))}
        </div>
      );

    case 'checkbox_single':
      return <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted"><span className={`${chip} rounded-sm`} />Must be checked</span>;

    case 'rating': {
      const min = field.rating?.min ?? 1;
      const max = field.rating?.max ?? 5;
      const scores: number[] = [];
      for (let score = min; score <= max; score += 1) scores.push(score);
      return (
        <div className="mt-1.5 flex gap-1">
          {scores.map((score) => (
            <span key={score} className="inline-block h-7 w-7 rounded-md border border-line bg-white text-center text-[12px] leading-7 text-muted">
              {score}
            </span>
          ))}
        </div>
      );
    }

    case 'slider':
      return (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-1.5 flex-1 rounded-full bg-line" />
          <span className="text-[11px] text-muted">
            {field.validation?.min ?? 0}–{field.validation?.max ?? 100}
          </span>
        </div>
      );

    case 'signature':
      return <div className="mt-1.5 h-16 rounded-md border border-dashed border-line bg-white" />;

    case 'geolocation':
      return (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <span className={box} />
          <span className={box} />
        </div>
      );

    case 'decision':
      return (
        <div className="mt-1.5 flex gap-1.5">
          <span className="h-7 flex-1 rounded-md border border-line bg-white text-center text-[11.5px] leading-7 text-muted">
            {field.decision?.approve || 'Approve'}
          </span>
          <span className="h-7 flex-1 rounded-md border border-line bg-white text-center text-[11.5px] leading-7 text-muted">
            {field.decision?.reject || 'Reject'}
          </span>
        </div>
      );

    case 'matrix':
      return (
        <div className="mt-1.5 overflow-hidden rounded-md border border-line bg-white">
          <div className="flex text-[11px] text-muted">
            <span className="flex-1 border-b border-r border-line px-2 py-1">
              {(field.matrix?.rows ?? [])[0]?.label ?? 'Row'}
            </span>
            {(field.matrix?.columns ?? []).slice(0, 3).map((column) => (
              <span key={column.value} className="w-14 border-b border-r border-line px-2 py-1 last:border-r-0">
                {column.label}
              </span>
            ))}
          </div>
        </div>
      );

    case 'select':
      return <div className={`${box} flex items-center justify-between px-2 text-[12px] text-muted`}><span>{(field.options ?? [])[0]?.label ?? 'Choose one…'}</span><span aria-hidden="true">▾</span></div>;

    case 'rupees':
    case 'currency':
      return (
        <div className={`${box} flex items-center gap-1.5 px-2 text-[12px] text-muted`}>
          <span>{field.type === 'rupees' ? '₹' : field.currency_symbol || '₹'}</span>
          <span className="h-full flex-1" />
        </div>
      );

    default:
      return <div className={box} />;
  }
}

function FieldInspector({
  field,
  others,
  canManage,
  onChange,
}: {
  field: FormFieldDef;
  others: FormFieldDef[];
  canManage: boolean;
  onChange: (changes: Partial<FormFieldDef>) => void;
}) {
  const ids = useFieldId('insp');
  const collecting = !isPresentational(field.type);
  const choiceBearing = OPTION_BEARING.includes(field.type);
  const composite = isComposite(field.type);
  const textish = ['text', 'textarea'].includes(field.type);
  const numeric = ['number', 'rupees', 'currency'].includes(field.type);
  const affixable = textish || numeric;
  const defaultable = collecting && !composite && DEFAULTABLE.includes(field.type);
  const v = field.validation ?? {};
  const labelWord = ['section', 'heading', 'note'].includes(field.type) ? 'Text' : 'Label';

  const setValidation = (changes: Partial<Rules>) => {
    const merged: Record<string, unknown> = { ...v, ...changes };
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined || value === null || value === '') continue;
      next[key] = value;
    }
    onChange({ validation: next as Rules });
  };

  const askable = others.filter((other) => !isPresentational(other.type));

  return (
    <div className="grid gap-3 px-4 py-4">
      <header>
        <p className="text-[13.5px] font-semibold text-ink">{FIELD_KIND_LABELS[field.type]}</p>
        <p className="text-[12px] text-muted">Answers are stored under <span className="font-mono text-[11px]">{field.id}</span>.</p>
      </header>

      <Field label={labelWord} htmlFor={`${ids}-label`}>
        <Input
          id={`${ids}-label`}
          value={field.label}
          maxLength={200}
          disabled={!canManage}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </Field>

      {collecting && (
        <Field label="Help text" htmlFor={`${ids}-help`} hint="Shown under the question.">
          <Textarea
            id={`${ids}-help`}
            rows={2}
            value={field.help ?? ''}
            maxLength={500}
            disabled={!canManage}
            onChange={(event) => onChange({ help: event.target.value })}
          />
        </Field>
      )}

      {collecting && !composite && (
        <Field label="Placeholder" htmlFor={`${ids}-placeholder`} hint="Vanishes as soon as the visitor types.">
          <Input
            id={`${ids}-placeholder`}
            value={field.placeholder ?? ''}
            maxLength={200}
            disabled={!canManage}
            onChange={(event) => onChange({ placeholder: event.target.value })}
          />
        </Field>
      )}

      {collecting && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
          <span className="text-[12.5px] font-medium text-ink">Required</span>
          <Switch checked={field.required === true} disabled={!canManage} onChange={(checked) => onChange({ required: checked })} label="Required" />
        </div>
      )}

      {collecting && (
        <Field label="Width" htmlFor={`${ids}-width`} hint="Half-width questions sit two to a row.">
          <Select
            id={`${ids}-width`}
            value={field.width ?? 'full'}
            disabled={!canManage}
            onChange={(event) => onChange({ width: event.target.value === 'half' ? 'half' : 'full' })}
          >
            <option value="full">Full row</option>
            <option value="half">Half row</option>
          </Select>
        </Field>
      )}

      {choiceBearing && (
        <OptionsEditor field={field} canManage={canManage} onChange={onChange} />
      )}

      {field.type === 'matrix' && (
        <MatrixEditor field={field} canManage={canManage} onChange={onChange} />
      )}

      {field.type === 'decision' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Approve reads" htmlFor={`${ids}-approve`}>
            <Input
              id={`${ids}-approve`}
              value={field.decision?.approve ?? 'Approve'}
              maxLength={60}
              disabled={!canManage}
              onChange={(event) => onChange({ decision: { approve: event.target.value, reject: field.decision?.reject ?? 'Reject', ask_reason: field.decision?.ask_reason ?? false } })}
            />
          </Field>
          <Field label="Reject reads" htmlFor={`${ids}-reject`}>
            <Input
              id={`${ids}-reject`}
              value={field.decision?.reject ?? 'Reject'}
              maxLength={60}
              disabled={!canManage}
              onChange={(event) => onChange({ decision: { approve: field.decision?.approve ?? 'Approve', reject: event.target.value, ask_reason: field.decision?.ask_reason ?? false } })}
            />
          </Field>
          <div className="col-span-2 flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
            <span className="text-[12.5px] font-medium text-ink">Ask for a reason</span>
            <Switch
              checked={field.decision?.ask_reason === true}
              disabled={!canManage}
              label="Ask for a reason"
              onChange={(checked) => onChange({ decision: { approve: field.decision?.approve ?? 'Approve', reject: field.decision?.reject ?? 'Reject', ask_reason: checked } })}
            />
          </div>
        </div>
      )}

      {field.type === 'rating' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lowest" htmlFor={`${ids}-rmin`}>
            <Input
              id={`${ids}-rmin`}
              type="number"
              min={0}
              max={9}
              value={field.rating?.min ?? 1}
              disabled={!canManage}
              onChange={(event) =>
                onChange({ rating: { min: numberOrUndefined(event.target.value) ?? 1, max: field.rating?.max ?? 5, symbol: field.rating?.symbol ?? 'star' } })
              }
            />
          </Field>
          <Field label="Highest" htmlFor={`${ids}-rmax`}>
            <Input
              id={`${ids}-rmax`}
              type="number"
              min={1}
              max={10}
              value={field.rating?.max ?? 5}
              disabled={!canManage}
              onChange={(event) =>
                onChange({ rating: { min: field.rating?.min ?? 1, max: numberOrUndefined(event.target.value) ?? 5, symbol: field.rating?.symbol ?? 'star' } })
              }
            />
          </Field>
          <Field label="Drawn as" htmlFor={`${ids}-rsymbol`} hint="The same count of marks, in another shape." >
            <Select
              id={`${ids}-rsymbol`}
              value={field.rating?.symbol ?? 'star'}
              disabled={!canManage}
              onChange={(event) =>
                onChange({ rating: { min: field.rating?.min ?? 1, max: field.rating?.max ?? 5, symbol: event.target.value as RatingSymbol } })
              }
            >
              {RATING_SYMBOLS.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {RATING_SYMBOL_LABELS[symbol]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {field.type === 'slider' && (
        <Field label="Step" htmlFor={`${ids}-step`} hint="How far the handle moves at a time.">
          <Input
            id={`${ids}-step`}
            type="number"
            min={0.1}
            step={0.1}
            value={field.slider?.step ?? 1}
            disabled={!canManage}
            onChange={(event) =>
              onChange({ slider: { step: numberOrUndefined(event.target.value) ?? 1, show_value: field.slider?.show_value ?? true } })
            }
          />
        </Field>
      )}

      {field.type === 'currency' && (
        <Field label="Symbol" htmlFor={`${ids}-symbol`} hint="Drawn in front of the number. The answer stays a number.">
          <Input
            id={`${ids}-symbol`}
            value={field.currency_symbol ?? '₹'}
            maxLength={6}
            disabled={!canManage}
            onChange={(event) => onChange({ currency_symbol: event.target.value })}
          />
        </Field>
      )}

      {(field.type === 'select' || field.type === 'radio' || field.type === 'checkbox' || field.type === 'multiselect' || field.type === 'image_choice' || field.type === 'yes_or_no') && (
        <div className="grid gap-2">
          {['radio', 'checkbox', 'image_choice', 'yes_or_no'].includes(field.type) && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
              <span className="text-[12.5px] font-medium text-ink">Choices side by side</span>
              <Switch
                checked={field.inline_choices === true}
                disabled={!canManage}
                label="Choices side by side"
                onChange={(checked) => onChange({ inline_choices: checked })}
              />
            </div>
          )}
          {field.type === 'select' && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
              <span className="text-[12.5px] font-medium text-ink">Search box in the dropdown</span>
              <Switch
                checked={field.searchable === true}
                disabled={!canManage}
                label="Search box in the dropdown"
                onChange={(checked) => onChange({ searchable: checked })}
              />
            </div>
          )}
          {field.type === 'image_choice' && (
            <Field label="Pick" htmlFor={`${ids}-pick`} hint="One picture, or as many as they like.">
              <Select
                id={`${ids}-pick`}
                value={field.choice_style ?? 'radio'}
                disabled={!canManage}
                onChange={(event) => onChange({ choice_style: event.target.value === 'checkbox' ? 'checkbox' : 'radio' })}
              >
                <option value="radio">one choice</option>
                <option value="checkbox">several choices</option>
              </Select>
            </Field>
          )}
        </div>
      )}

      {composite && <PartsEditor field={field} canManage={canManage} onChange={onChange} />}

      {affixable && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Prefix" htmlFor={`${ids}-prefix`} hint="Drawn before the box.">
            <Input
              id={`${ids}-prefix`}
              value={field.prefix ?? ''}
              maxLength={40}
              disabled={!canManage}
              onChange={(event) => onChange({ prefix: event.target.value })}
            />
          </Field>
          <Field label="Suffix" htmlFor={`${ids}-suffix`} hint="Drawn after the box.">
            <Input
              id={`${ids}-suffix`}
              value={field.suffix ?? ''}
              maxLength={40}
              disabled={!canManage}
              onChange={(event) => onChange({ suffix: event.target.value })}
            />
          </Field>
        </div>
      )}

      {defaultable && <DefaultEditor field={field} canManage={canManage} onChange={onChange} idPrefix={ids} />}

      {textish && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min characters" htmlFor={`${ids}-minlen`}>
            <Input
              id={`${ids}-minlen`}
              type="number"
              min={0}
              max={100000}
              value={v.min_len ?? ''}
              disabled={!canManage}
              onChange={(event) => setValidation({ min_len: numberOrUndefined(event.target.value) })}
            />
          </Field>
          <Field label="Max characters" htmlFor={`${ids}-maxlen`}>
            <Input
              id={`${ids}-maxlen`}
              type="number"
              min={0}
              max={100000}
              value={v.max_len ?? ''}
              disabled={!canManage}
              onChange={(event) => setValidation({ max_len: numberOrUndefined(event.target.value) })}
            />
          </Field>
        </div>
      )}

      {field.type === 'text' ? (
        <>
          <Field label="Must match" htmlFor={`${ids}-pattern`} hint="A regular expression, checked the same way in the browser and on the server.">
            <Input
              id={`${ids}-pattern`}
              value={v.pattern ?? ''}
              maxLength={200}
              spellCheck={false}
              placeholder="^[0-9]{6}$"
              disabled={!canManage}
              onChange={(event) => setValidation({ pattern: event.target.value })}
            />
          </Field>
          {v.pattern && !isPatternSafe(v.pattern) && (
            <p className="text-[12px] text-[#b42318]">That expression cannot be read. Publish will refuse it.</p>
          )}
        </>
      ) : null}

      {(numeric || field.type === 'slider') && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={field.type === 'slider' ? 'Left end' : 'Smallest'} htmlFor={`${ids}-min`}>
            <Input
              id={`${ids}-min`}
              type="number"
              value={v.min ?? ''}
              disabled={!canManage}
              onChange={(event) => setValidation({ min: numberOrUndefined(event.target.value) })}
            />
          </Field>
          <Field label={field.type === 'slider' ? 'Right end' : 'Largest'} htmlFor={`${ids}-max`}>
            <Input
              id={`${ids}-max`}
              type="number"
              value={v.max ?? ''}
              disabled={!canManage}
              onChange={(event) => setValidation({ max: numberOrUndefined(event.target.value) })}
            />
          </Field>
        </div>
      )}

      {collecting && (
        <Field label="Error message" htmlFor={`${ids}-message`} hint="Replaces the wording Yourbiss would otherwise use.">
          <Input
            id={`${ids}-message`}
            value={v.message ?? ''}
            maxLength={200}
            disabled={!canManage}
            onChange={(event) => setValidation({ message: event.target.value })}
          />
        </Field>
      )}

      {collecting && (
        <LogicEditor
          field={field}
          askable={askable}
          canManage={canManage}
          onChange={onChange}
          idPrefix={ids}
        />
      )}
    </div>
  );
}

function OptionsEditor({
  field,
  canManage,
  onChange,
}: {
  field: FormFieldDef;
  canManage: boolean;
  onChange: (changes: Partial<FormFieldDef>) => void;
}) {
  const options = field.options ?? [];
  const wantsGroup = field.type === 'select';
  const wantsImage = field.type === 'image_choice';
  const rowClass = wantsGroup
    ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5'
    : 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5';

  const setAt = (index: number, changes: Partial<{ label: string; value: string; group: string; image_url: string }>) => {
    onChange({ options: options.map((option, at) => (at === index ? { ...option, ...changes } : option)) });
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-ink">Choices</span>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            disabled={options.length >= 120}
            onClick={() => {
              const value = `option_${Math.random().toString(36).slice(2, 6)}`;
              onChange({ options: [...options, { label: `Option ${options.length + 1}`, value, ...(wantsImage ? { image_url: '' } : {}) }] });
            }}
          >
            Add choice
          </Button>
        )}
      </div>

      {options.length === 0 && (
        <p className="rounded-md border border-dashed border-line px-3 py-3 text-[12px] text-muted">
          This question needs at least one choice before it can be published.
        </p>
      )}

      {options.map((option, index) => (
        <div key={`${option.value}-${index}`} className="grid gap-1.5">
          <div className={rowClass}>
            <Input
              value={option.label}
              maxLength={200}
              disabled={!canManage}
              aria-label={`Choice ${index + 1} label`}
              onChange={(event) => setAt(index, { label: event.target.value })}
            />
            <Input
              value={option.value}
              maxLength={200}
              spellCheck={false}
              disabled={!canManage}
              aria-label={`Choice ${index + 1} stored value`}
              onChange={(event) => setAt(index, { value: event.target.value })}
            />
            {wantsGroup && (
              <Input
                value={option.group ?? ''}
                maxLength={120}
                disabled={!canManage}
                placeholder="Group"
                aria-label={`Choice ${index + 1} group`}
                onChange={(event) => setAt(index, { group: event.target.value })}
              />
            )}
            {canManage ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove choice ${index + 1}`}
                onClick={() => onChange({ options: options.filter((_, at) => at !== index) })}
              >
                <Trash size={13} />
              </Button>
            ) : (
              <span className="w-6" />
            )}
          </div>
          {wantsImage && (
            <Input
              value={option.image_url ?? ''}
              maxLength={600}
              spellCheck={false}
              disabled={!canManage}
              placeholder="https:// … the picture for this choice"
              aria-label={`Choice ${index + 1} image`}
              onChange={(event) => setAt(index, { image_url: event.target.value })}
            />
          )}
        </div>
      ))}
      <p className="text-[11.5px] leading-relaxed text-muted">
        The label is what the visitor reads; the value is what is stored and exported. Conditional logic compares
        against the value.
      </p>
      {wantsGroup && (
        <p className="text-[11.5px] leading-relaxed text-muted">
          Choices that share a group name sit together under that heading in the dropdown. Renaming a group leaves
          every stored answer alone.
        </p>
      )}
    </div>
  );
}

/** A matrix is two lists, not one: the questions down the side and the answers across. */
/** The boxes a name or an address is made of. What is switched on here is what the
 * visitor is asked, what is stored, and — for a required field — what has to be
 * filled, so this is the question itself rather than a layout choice. */
function PartsEditor({
  field,
  canManage,
  onChange,
}: {
  field: FormFieldDef;
  canManage: boolean;
  onChange: (changes: Partial<FormFieldDef>) => void;
}) {
  const name = field.type === 'name';
  const parts = name ? NAME_PARTS : ADDRESS_PARTS;
  const on = (name ? field.name_parts ?? NAME_PARTS_DEFAULT : field.address_parts ?? ADDRESS_PARTS_DEFAULT) as Record<string, boolean>;

  const toggle = (part: string, value: boolean) =>
    onChange(name ? { name_parts: { ...on, [part]: value } } : { address_parts: { ...on, [part]: value } });

  return (
    <div className="grid gap-1.5">
      <p className="text-[12.5px] font-medium text-ink">Parts</p>
      <div className="grid grid-cols-2 gap-1.5">
        {parts.map((part) => (
          <label key={part} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={on[part] ?? false}
              disabled={!canManage}
              onChange={(event) => toggle(part, event.target.checked)}
            />
            {partLabel(field, part)}
          </label>
        ))}
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        A required {name ? 'name' : 'address'} asks for every part left switched on.
      </p>
    </div>
  );
}

function MatrixEditor({
  field,
  canManage,
  onChange,
}: {
  field: FormFieldDef;
  canManage: boolean;
  onChange: (changes: Partial<FormFieldDef>) => void;
}) {
  const axes = field.matrix ?? { rows: [], columns: [] };

  const setAxis = (which: 'rows' | 'columns', next: MatrixAxes['rows']) =>
    onChange({ matrix: { ...axes, [which]: next } });

  return (
    <div className="grid gap-3">
      {(['rows', 'columns'] as const).map((which) => {
        const list = which === 'rows' ? axes.rows : axes.columns;
        const limit = which === 'rows' ? MATRIX_MAX_ROWS : MATRIX_MAX_COLUMNS;
        return (
          <div key={which} className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink">{which === 'rows' ? 'Questions (one per row)' : 'Answers (one per column)'}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canManage || list.length >= limit}
                onClick={() =>
                  setAxis(which, [...list, { label: `${which === 'rows' ? 'Row' : 'Option'} ${list.length + 1}`, value: `${which}_${Math.random().toString(36).slice(2, 6)}` }])
                }
              >
                Add {which === 'rows' ? 'row' : 'column'}
              </Button>
            </div>
            {list.length === 0 && (
              <p className="rounded-md border border-dashed border-line px-3 py-2 text-[12px] text-muted">
                Publish needs at least one {which === 'rows' ? 'row' : 'column'}.
              </p>
            )}
            {list.map((entry, index) => (
              <div key={`${entry.value}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
                <Input
                  value={entry.label}
                  maxLength={200}
                  disabled={!canManage}
                  aria-label={`${which === 'rows' ? 'Row' : 'Column'} ${index + 1} label`}
                  onChange={(event) =>
                    setAxis(which, list.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))
                  }
                />
                <Input
                  value={entry.value}
                  maxLength={200}
                  spellCheck={false}
                  disabled={!canManage}
                  aria-label={`${which === 'rows' ? 'Row' : 'Column'} ${index + 1} stored value`}
                  onChange={(event) =>
                    setAxis(which, list.map((item, at) => (at === index ? { ...item, value: event.target.value } : item)))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canManage}
                  aria-label={`Remove ${which === 'rows' ? 'row' : 'column'} ${index + 1}`}
                  onClick={() => setAxis(which, list.filter((_, at) => at !== index))}
                >
                  <Trash size={13} />
                </Button>
              </div>
            ))}
          </div>
        );
      })}
      <p className="text-[11.5px] leading-relaxed text-muted">
        A visitor picks one column for every row. When the question is required, an unanswered row stops the
        submission.
      </p>
    </div>
  );
}

/**
 * The answer filled in before the visitor touches the field. It is drawn as the
 * control&apos;s starting value, so what they finally send is what they saw — a default
 * is never stored behind their back.
 */
function DefaultEditor({
  field,
  canManage,
  onChange,
  idPrefix,
}: {
  field: FormFieldDef;
  canManage: boolean;
  onChange: (changes: Partial<FormFieldDef>) => void;
  idPrefix: string;
}) {
  const fromList = OPTION_BEARING.includes(field.type) || field.type === 'yes_or_no';
  const current = field.default_value ?? '';
  const many = collectsMany(field);
  const picked = current.split(',').map((value) => value.trim()).filter(Boolean);

  if (fromList && (SINGLE_CHOICE.includes(field.type) || many)) {
    const options = field.type === 'yes_or_no' ? [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] : field.options ?? [];
    return (
      <div className="grid gap-1.5">
        <span className="text-[12.5px] font-medium text-ink" id={`${idPrefix}-default`}>
          Default answer
        </span>
        {many ? (
          <div className="grid gap-1">
            {options.map((option) => {
              const on = picked.includes(String(option.value));
              return (
                <label key={String(option.value)} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canManage}
                    onChange={() =>
                      onChange({
                        default_value: (on ? picked.filter((x) => x !== String(option.value)) : [...picked, String(option.value)]).join(','),
                      })
                    }
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        ) : (
          <Select
            aria-labelledby={`${idPrefix}-default`}
            value={current}
            disabled={!canManage}
            onChange={(event) => onChange({ default_value: event.target.value })}
          >
            <option value="">No default</option>
            {options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {choiceLabel(field, String(option.value))}
              </option>
            ))}
          </Select>
        )}
        {many && picked.length > 0 && (
          <p className="text-[11.5px] text-muted">{picked.map((value) => choiceLabel(field, value)).join(', ')}</p>
        )}
      </div>
    );
  }

  return (
    <Field label="Default answer" htmlFor={`${idPrefix}-default`} hint="Starts the box filled in; the visitor can change or clear it.">
      <Input
        id={`${idPrefix}-default`}
        type={field.type === 'number' || field.type === 'rupees' || field.type === 'currency' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        value={current}
        maxLength={400}
        disabled={!canManage}
        onChange={(event) => onChange({ default_value: event.target.value })}
      />
    </Field>
  );
}

function LogicEditor({
  field,
  askable,
  canManage,
  onChange,
  idPrefix,
}: {
  field: FormFieldDef;
  askable: FormFieldDef[];
  canManage: boolean;
  onChange: (changes: Partial<FormFieldDef>) => void;
  idPrefix: string;
}) {
  const logic = field.logic ?? null;

  const setLogic = (next: FormFieldDef['logic']) => onChange({ logic: next });

  const setCondition = (index: number, changes: Partial<{ field_id: string; operator: LogicOperator; value: string }>) => {
    if (!logic) return;
    setLogic({
      ...logic,
      conditions: logic.conditions.map((condition, at) => (at === index ? { ...condition, ...changes } : condition)),
    });
  };

  return (
    <div className="grid gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink">Show only when</span>
        <Switch
          checked={logic !== null}
          disabled={!canManage || askable.length === 0}
          label="Conditional logic"
          onChange={(checked) =>
            setLogic(
              checked
                ? { action: 'show', match: 'all', conditions: [{ field_id: askable[0]?.id ?? '', operator: 'is', value: '' }] }
                : undefined,
            )
          }
        />
      </div>

      {askable.length === 0 && !logic && (
        <p className="text-[11.5px] leading-relaxed text-muted">
          Conditional logic reads the answer to another question, and this form has no other question yet.
        </p>
      )}

      {logic && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Then" htmlFor={`${idPrefix}-action`}>
              <Select
                id={`${idPrefix}-action`}
                value={logic.action}
                disabled={!canManage}
                onChange={(event) => setLogic({ ...logic, action: event.target.value === 'hide' ? 'hide' : 'show' })}
              >
                <option value="show">show this question</option>
                <option value="hide">hide this question</option>
              </Select>
            </Field>
            <Field label="Rules" htmlFor={`${idPrefix}-match`}>
              <Select
                id={`${idPrefix}-match`}
                value={logic.match}
                disabled={!canManage}
                onChange={(event) => setLogic({ ...logic, match: event.target.value === 'any' ? 'any' : 'all' })}
              >
                <option value="all">all must match</option>
                <option value="any">any can match</option>
              </Select>
            </Field>
          </div>

          {logic.conditions.map((condition, index) => {
            const source = askable.find((other) => other.id === condition.field_id) ?? null;
            const choiceSource = source !== null && (SINGLE_CHOICE.includes(source.type) || collectsMany(source));
            const comparesToAChoice = choiceSource && ['is', 'is_not', 'contains'].includes(condition.operator);
            return (
              <div key={index} className="grid gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-2">
                <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-1.5">
                  <Select
                    aria-label={`Condition ${index + 1} question`}
                    value={condition.field_id}
                    disabled={!canManage}
                    onChange={(event) => setCondition(index, { field_id: event.target.value, value: '' })}
                  >
                    {askable.length === 0 && <option value="">No question to read</option>}
                    {askable.map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.label || FIELD_KIND_LABELS[other.type]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={`Condition ${index + 1} rule`}
                    value={condition.operator}
                    disabled={!canManage}
                    onChange={(event) => {
                      const next = event.target.value as LogicOperator;
                      setCondition(index, { operator: next, value: needsValue(next) ? condition.value : '' });
                    }}
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator} value={operator}>
                        {OPERATOR_LABELS[operator]}
                      </option>
                    ))}
                  </Select>
                </div>

                {needsValue(condition.operator) &&
                  (comparesToAChoice ? (
                    <Select
                      aria-label={`Condition ${index + 1} value`}
                      value={condition.value ?? ''}
                      disabled={!canManage}
                      onChange={(event) => setCondition(index, { value: event.target.value })}
                    >
                      {(source ? choiceValues(source) : []).map((value) => (
                        <option key={value} value={value}>
                          {source ? choiceLabel(source, value) : value}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      aria-label={`Condition ${index + 1} value`}
                      value={condition.value ?? ''}
                      maxLength={400}
                      disabled={!canManage}
                      placeholder={source && ['number', 'rupees', 'currency', 'rating', 'slider'].includes(source.type) ? '10' : 'the answer'}
                      onChange={(event) => setCondition(index, { value: event.target.value })}
                    />
                  ))}

                {canManage && logic.conditions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => setLogic({ ...logic, conditions: logic.conditions.filter((_, at) => at !== index) })}
                  >
                    Remove this rule
                  </Button>
                )}
              </div>
            );
          })}

          {canManage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={logic.conditions.length >= 12 || askable.length === 0}
              className="justify-self-start"
              onClick={() =>
                setLogic({
                  ...logic,
                  conditions: [...logic.conditions, { field_id: askable[0]?.id ?? '', operator: 'is', value: '' }],
                })
              }
            >
              Add rule
            </Button>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted">
            A question this hides is never asked, so it is not required and its answer is not stored. The same rule runs
            in the visitor&apos;s browser and in the database.
          </p>
        </>
      )}
    </div>
  );
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPatternSafe(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

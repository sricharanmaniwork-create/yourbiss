'use client';

import { useMemo, useState, useTransition } from 'react';
import { Copy, GripVertical, Trash } from 'lucide-react';
import type { ActionState } from '@/lib/types';
import type { FormFieldDef, FieldKind, LogicOperator } from '@/lib/forms/types';
import { FIELD_KIND_LABELS, blankField, isPresentational } from '@/lib/forms/types';
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
    kinds: ['text', 'textarea', 'name', 'email', 'phone', 'url', 'number', 'rupees', 'date', 'time', 'rating'],
  },
  { label: 'Choices', kinds: ['select', 'radio', 'checkbox', 'multiselect', 'checkbox_single'] },
  { label: 'Layout', kinds: ['section', 'heading', 'note', 'divider', 'spacer'] },
];

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
  switch (field.type) {
    case 'textarea':
      return <div className="mt-1.5 h-16 rounded-md border border-line bg-white" />;
    case 'radio':
    case 'checkbox':
    case 'multiselect':
      return (
        <div className="mt-1.5 grid gap-1">
          {(field.options ?? []).slice(0, 3).map((option) => (
            <span key={option.value} className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className={`inline-block ${field.type === 'radio' ? 'h-3 w-3 rounded-full' : 'h-3 w-3 rounded-sm'} border border-line bg-white`} />
              {option.label}
            </span>
          ))}
        </div>
      );
    case 'checkbox_single':
      return <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted"><span className="inline-block h-3 w-3 rounded-sm border border-line bg-white" />Must be checked</span>;
    case 'rating':
      return (
        <div className="mt-1.5 flex gap-1">
          {[1, 2, 3, 4, 5].map((score) => (
            <span key={score} className="inline-block h-7 w-7 rounded-md border border-line bg-white text-center text-[12px] leading-7 text-muted">
              {score}
            </span>
          ))}
        </div>
      );
    case 'select':
      return <div className={`${box} flex items-center justify-between px-2 text-[12px] text-muted`}><span>{(field.options ?? [])[0]?.label ?? 'Choose one…'}</span><span aria-hidden="true">▾</span></div>;
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
  const choiceBearing = ['select', 'radio', 'checkbox', 'multiselect'].includes(field.type);
  const textish = ['text', 'name', 'textarea', 'address'].includes(field.type);
  const numeric = ['number', 'rupees'].includes(field.type);
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

      {collecting && (
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

      {field.type === 'text' || field.type === 'name' ? (
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

      {numeric && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Smallest" htmlFor={`${ids}-min`}>
            <Input
              id={`${ids}-min`}
              type="number"
              value={v.min ?? ''}
              disabled={!canManage}
              onChange={(event) => setValidation({ min: numberOrUndefined(event.target.value) })}
            />
          </Field>
          <Field label="Largest" htmlFor={`${ids}-max`}>
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

      {(field.type === 'checkbox_single' || textish || numeric) && (
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

  const setAt = (index: number, changes: Partial<{ label: string; value: string }>) => {
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
            onClick={() => {
              const value = `option_${Math.random().toString(36).slice(2, 6)}`;
              onChange({ options: [...options, { label: `Option ${options.length + 1}`, value }] });
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
        <div key={`${option.value}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
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
      ))}
      <p className="text-[11.5px] leading-relaxed text-muted">
        The label is what the visitor reads; the value is what is stored and exported. Conditional logic compares
        against the value.
      </p>
    </div>
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
            const comparesToAChoice =
              source !== null && (source.options ?? []).length > 0 && ['is', 'is_not', 'contains'].includes(condition.operator);
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
                      {(source?.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      aria-label={`Condition ${index + 1} value`}
                      value={condition.value ?? ''}
                      maxLength={400}
                      disabled={!canManage}
                      placeholder={source && ['number', 'rupees', 'rating'].includes(source.type) ? '10' : 'the answer'}
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

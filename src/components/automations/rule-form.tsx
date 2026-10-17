'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { createAutomationRule, updateAutomationRule } from '@/lib/actions/automations';
import { Button, Field, FormStatus, Input, Select, Switch, Textarea, useAction } from '@/components/ui';
import type { AutomationConditionOp, AutomationEvent, AutomationField, AutomationRule } from '@/lib/types';

/**
 * The rule builder.
 *
 * Three questions in the order the runner asks them — what happened, what the record
 * looks like, what to do about it — and every choice in the form comes from
 * `public.automation_events` rather than from a list written here. That is deliberate:
 * the events on offer, the fields a condition may name and the labels beside them are
 * the same rows the rule's foreign key is checked against when it saves, so a rule that
 * builds is a rule the suite can actually fire. Nothing in this file invents an event
 * the other apps never write, and nothing offers a field the record does not have.
 */

const APP_LABEL: Record<string, string> = {
  bookings: 'Bookings',
  crm: 'CRM',
  forms: 'Forms',
  inventory: 'Inventory',
  store: 'Store',
  website: 'Websites',
};

const OPS: AutomationConditionOp[] = ['equals', 'not_equals', 'contains', 'greater', 'less', 'is_empty', 'is_not_empty'];

/** The word a person reads, not the token stored. `greater` means later for a moment and more for an amount. */
function opLabel(op: AutomationConditionOp, kind: string): string {
  switch (op) {
    case 'equals':
      return 'is exactly';
    case 'not_equals':
      return 'is not';
    case 'contains':
      return 'contains';
    case 'greater':
      return kind === 'time' || kind === 'date' ? 'is after' : 'is more than';
    case 'less':
      return kind === 'time' || kind === 'date' ? 'is before' : 'is less than';
    case 'is_empty':
      return 'has nothing in it';
    case 'is_not_empty':
      return 'has something in it';
  }
}

function inputKind(kind: string): React.InputHTMLAttributes<HTMLInputElement>['type'] {
  if (kind === 'money') return 'number';
  if (kind === 'date') return 'date';
  if (kind === 'time') return 'datetime-local';
  if (kind === 'email') return 'email';
  return 'text';
}

function placeholder(kind: string): string {
  if (kind === 'money') return '5000';
  if (kind === 'date') return '2026-12-01';
  if (kind === 'time') return 'a moment on the day';
  if (kind === 'email') return 'someone@example.com';
  return 'what to compare it against';
}

interface ConditionRow {
  field: string;
  op: AutomationConditionOp;
  value: string;
}

/**
 * One flat row for both action types, because a form that switches shape on every
 * keystroke is harder to fill in than one that shows the two boxes it needs. The keys
 * that do not belong to the chosen type are not sent, and the guard in 0013 refuses
 * them if anything else ever does.
 */
interface ActionRow {
  type: 'crm_activity' | 'letter';
  kind: 'note' | 'call' | 'task';
  subject: string;
  body: string;
  due_days: string;
  to: 'record' | 'owner' | 'address';
  address: string;
}

function blankAction(): ActionRow {
  return { type: 'letter', to: 'owner', subject: '', body: '', due_days: '', kind: 'note', address: '' };
}

function actionOf(row: ActionRow) {
  if (row.type === 'crm_activity') {
    return {
      type: 'crm_activity' as const,
      kind: row.kind,
      subject: row.subject,
      body: row.body,
      due_days: row.due_days,
    };
  }
  return { type: 'letter' as const, to: row.to, subject: row.subject, body: row.body, address: row.address };
}

export function RuleForm({ orgId, events, rule }: { orgId: string; events: AutomationEvent[]; rule?: AutomationRule }) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [name, setName] = useState(rule?.name ?? '');
  const [eventKey, setEventKey] = useState(
    rule ? `${rule.app}|${rule.entity_type}|${rule.action}` : (events[0] ? `${events[0].app}|${events[0].entity_type}|${events[0].action}` : ''),
  );
  const [conditions, setConditions] = useState<ConditionRow[]>(
    (rule?.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: c.value ?? '' })),
  );
  const [actions, setActions] = useState<ActionRow[]>(
    rule
      ? rule.actions.map((a) => ({
          ...blankAction(),
          ...('body' in a ? { body: a.body ?? '' } : {}),
          subject: a.subject,
          ...(a.type === 'crm_activity'
            ? { type: a.type, kind: a.kind, due_days: a.due_days === undefined ? '' : String(a.due_days) }
            : { type: a.type, to: a.to, address: a.address ?? '' }),
        }))
      : [blankAction()],
  );
  const [enabled, setEnabled] = useState(rule?.enabled ?? false);

  const event = events.find((e) => `${e.app}|${e.entity_type}|${e.action}` === eventKey);
  const fields = event?.fields ?? [];
  const fieldOf = (name: string): AutomationField | undefined => fields.find((f) => f.name === name);

  const submit = () => {
    void run(async () => {
      const payload = { name, event: eventKey, conditions, actions: actions.map(actionOf), enabled };
      const result = rule ? await updateAutomationRule(rule.id, payload) : await createAutomationRule(orgId, payload);
      if (result.ok && !rule && 'id' in result && result.id) router.push(`/app/automations/rules/${result.id}`);
      if (result.ok && rule) router.refresh();
      return result;
    });
  };

  const setCondition = (index: number, patch: Partial<ConditionRow>) =>
    setConditions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const setAction = (index: number, patch: Partial<ActionRow>) =>
    setActions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="grid gap-4">
      <section className="ui-card px-5 py-5">
        <h2 className="text-[15px] font-semibold text-ink">Give the rule a name</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          The name is what appears in the run log and at the top of a letter someone asks about later, so make it the
          sentence you would use out loud.
        </p>
        <div className="mt-4 max-w-[560px]">
          <Field label="Rule name" htmlFor="rule-name" required error={fieldError('name')} hint={`${name.length}/120`}>
            <Input
              id="rule-name"
              value={name}
              maxLength={120}
              placeholder="Tell the buyer their order is on its way"
              invalid={!!fieldError('name')}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="ui-card px-5 py-5">
        <h2 className="text-[15px] font-semibold text-ink">When this happens</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          Only events the other apps really record are listed — a rule cannot be written for something that never fires.
        </p>
        <div className="mt-4 max-w-[560px]">
          <Field label="Event" htmlFor="rule-event" required error={fieldError('event')}>
            <Select id="rule-event" value={eventKey} onChange={(e) => setEventKey(e.target.value)}>
              {Object.entries(
                events.reduce<Record<string, AutomationEvent[]>>((groups, item) => {
                  const list = groups[item.app];
                  if (list) list.push(item);
                  else groups[item.app] = [item];
                  return groups;
                }, {}),
              ).map(([app, list]) => (
                <optgroup key={app} label={APP_LABEL[app] ?? app}>
                  {list.map((item) => (
                    <option key={`${item.app}|${item.entity_type}|${item.action}`} value={`${item.app}|${item.entity_type}|${item.action}`}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section className="ui-card px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Only if the record looks like this</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              Optional. Without a condition the rule fires on every one of these events; with several, all of them have
              to be true.
            </p>
          </div>
          <Button size="sm" disabled={conditions.length >= 6 || fields.length === 0} onClick={() => setConditions((rows) => [...rows, { field: fields[0]?.name ?? '', op: 'equals', value: '' }])}>
            <Plus size={14} aria-hidden="true" />
            Add a condition
          </Button>
        </div>

        {conditions.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-line-strong bg-raised px-4 py-3 text-[12.5px] text-muted">
            Every {event?.entity_type.replace(/_/g, ' ') ?? 'record'} that this event names will pass.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {conditions.map((row, index) => {
              const kind = fieldOf(row.field)?.kind ?? 'text';
              const noValue = row.op === 'is_empty' || row.op === 'is_not_empty';
              return (
                <li key={index} className="grid gap-2 rounded-md border border-line bg-raised p-3 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_auto] sm:items-end">
                  <Field label="Part of the record" htmlFor={`cond-field-${index}`} error={fieldError(`conditions.${index}.field`)}>
                    <Select
                      id={`cond-field-${index}`}
                      value={row.field}
                      onChange={(e) => setCondition(index, { field: e.target.value, value: '' })}
                    >
                      {fields.map((field) => (
                        <option key={field.name} value={field.name}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Comparison" htmlFor={`cond-op-${index}`}>
                    <Select id={`cond-op-${index}`} value={row.op} onChange={(e) => setCondition(index, { op: e.target.value as AutomationConditionOp })}>
                      {OPS.map((op) => (
                        <option key={op} value={op}>
                          {opLabel(op, kind)}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    label="Against"
                    htmlFor={`cond-value-${index}`}
                    error={fieldError(`conditions.${index}.value`)}
                    hint={noValue ? 'nothing to compare' : undefined}
                  >
                    <Input
                      id={`cond-value-${index}`}
                      type={inputKind(kind)}
                      step={kind === 'money' ? '0.01' : undefined}
                      min={kind === 'money' ? 0 : undefined}
                      value={row.value}
                      disabled={noValue}
                      placeholder={placeholder(kind)}
                      invalid={!!fieldError(`conditions.${index}.value`)}
                      onChange={(e) => setCondition(index, { value: e.target.value })}
                    />
                  </Field>

                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove condition ${index + 1}`}
                    onClick={() => setConditions((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ui-card px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Then do this</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              One to four actions, run in the order shown. Write{" "}
              <code className="rounded bg-raised px-1 py-0.5 text-[12px] text-ink-soft">{'{{field}}'}</code> anywhere in
              the text to put the record&rsquo;s own value in its place.
            </p>
          </div>
          <Button size="sm" disabled={actions.length >= 4} onClick={() => setActions((rows) => [...rows, blankAction()])}>
            <Plus size={14} aria-hidden="true" />
            Add an action
          </Button>
        </div>

        {actions.length > 0 && fields.length > 0 && (
          <p className="mt-3 text-[12px] text-muted">
            Tokens for this event:{' '}
            {fields.map((field) => (
              <code key={field.name} className="mr-1 rounded bg-raised px-1 py-0.5 text-[11.5px] text-ink-soft">
                {`{{${field.name}}}`}
              </code>
            ))}
            <code className="rounded bg-raised px-1 py-0.5 text-[11.5px] text-ink-soft">{'{{event}}'}</code>{' '}
            <code className="rounded bg-raised px-1 py-0.5 text-[11.5px] text-ink-soft">{'{{number}}'}</code>
          </p>
        )}

        <ul className="mt-4 grid gap-3" aria-label="Actions">
          {actions.map((row, index) => (
            <li key={index} className="rounded-md border border-line bg-raised p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Do" htmlFor={`action-type-${index}`} className="min-w-[220px] flex-1">
                  <Select
                    id={`action-type-${index}`}
                    value={row.type}
                    onChange={(e) => {
                      const type = e.target.value as ActionRow['type'];
                      setAction(index, type === 'letter' ? { type, to: 'owner', kind: 'note', due_days: '' } : { type, kind: 'note', to: 'record' });
                    }}
                  >
                    <option value="letter">Send a letter</option>
                    <option value="crm_activity">Write something in CRM</option>
                  </Select>
                </Field>

                {row.type === 'crm_activity' && (
                  <Field label="As" htmlFor={`action-kind-${index}`} className="w-[150px]">
                    <Select
                      id={`action-kind-${index}`}
                      value={row.kind}
                      onChange={(e) => setAction(index, { kind: e.target.value as ActionRow['kind'], due_days: e.target.value === 'task' ? row.due_days : '' })}
                    >
                      <option value="note">A note</option>
                      <option value="call">A call to make</option>
                      <option value="task">A task</option>
                    </Select>
                  </Field>
                )}

                {row.type === 'letter' && (
                  <Field label="To" htmlFor={`action-to-${index}`} className="w-[190px]">
                    <Select id={`action-to-${index}`} value={row.to} onChange={(e) => setAction(index, { to: e.target.value as ActionRow['to'], address: '' })}>
                      <option value="record">The email on the record</option>
                      <option value="owner">The workspace owner</option>
                      <option value="address">One fixed address</option>
                    </Select>
                  </Field>
                )}

                {row.type === 'crm_activity' && row.kind === 'task' && (
                  <Field label="Due in" htmlFor={`action-due-${index}`} className="w-[120px]" error={fieldError(`actions.${index}.due_days`)}>
                    <Input
                      id={`action-due-${index}`}
                      type="number"
                      min={0}
                      max={365}
                      value={row.due_days}
                      placeholder="days"
                      invalid={!!fieldError(`actions.${index}.due_days`)}
                      onChange={(e) => setAction(index, { due_days: e.target.value })}
                    />
                  </Field>
                )}

                {actions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove action ${index + 1}`}
                    onClick={() => setActions((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                )}
              </div>

              {row.type === 'letter' && row.to === 'address' && (
                <div className="mt-2 max-w-[420px]">
                  <Field label="Address" htmlFor={`action-address-${index}`} error={fieldError(`actions.${index}.address`)}>
                    <Input
                      id={`action-address-${index}`}
                      type="email"
                      value={row.address}
                      placeholder="shop@example.com"
                      invalid={!!fieldError(`actions.${index}.address`)}
                      onChange={(e) => setAction(index, { address: e.target.value })}
                    />
                  </Field>
                </div>
              )}

              <div className="mt-2 grid gap-2">
                <Field
                  label={row.type === 'letter' ? 'Subject' : 'Subject of the activity'}
                  htmlFor={`action-subject-${index}`}
                  error={fieldError(`actions.${index}.subject`)}
                  hint={`${row.subject.length}/200`}
                >
                  <Input
                    id={`action-subject-${index}`}
                    value={row.subject}
                    maxLength={200}
                    placeholder={row.type === 'letter' ? 'Your order {{number}} is confirmed' : 'Call {{buyer_name}} about the delivery'}
                    invalid={!!fieldError(`actions.${index}.subject`)}
                    onChange={(e) => setAction(index, { subject: e.target.value })}
                  />
                </Field>

                <Field
                  label={row.type === 'letter' ? 'Message' : 'Detail'}
                  htmlFor={`action-body-${index}`}
                  error={fieldError(`actions.${index}.body`)}
                  hint={`${row.body.length}/4000 · a blank detail is allowed on an activity`}
                >
                  <Textarea
                    id={`action-body-${index}`}
                    rows={5}
                    maxLength={4000}
                    value={row.body}
                    placeholder={
                      row.type === 'letter'
                        ? 'Hi {{buyer_name}},\n\n{{number}} is confirmed and goes out tomorrow.\n\nThank you.'
                        : 'Goods arrived against {{number}}. Check the shelf before the next order.'
                    }
                    onChange={(e) => setAction(index, { body: e.target.value })}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="ui-card px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-[560px]">
            <h2 className="text-[15px] font-semibold text-ink">Switch this rule on</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              A new rule starts switched off, and switching it on makes it responsible from that moment forwards. The
              events that already happened are left alone — no late letter for an order somebody answered by hand, and
              no replay if the rule sits off for a week. Switching it back on later starts from that later moment, so
              the time in between is missed on purpose.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px] text-muted">{enabled ? 'On' : 'Off'}</span>
            <Switch checked={enabled} onChange={setEnabled} label="Rule switched on" />
          </div>
        </div>
      </section>

      <FormStatus state={state} />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.push('/app/automations/rules')}>
          Cancel
        </Button>
        <Button variant="primary" loading={pending} onClick={submit}>
          {rule ? 'Save the rule' : 'Create the rule'}
        </Button>
      </div>
    </div>
  );
}

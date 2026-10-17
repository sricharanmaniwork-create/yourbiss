'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addCrmActivity } from '@/lib/actions/crm';
import { Button, Field, FormStatus, Input, Select, Textarea, useAction } from '@/components/ui';
import type { CrmActivityKind } from '@/lib/types';
import { cn } from '@/lib/utils';

const KINDS: { value: CrmActivityKind; label: string; verb: string }[] = [
  { value: 'note', label: 'Note', verb: 'Jot down what happened' },
  { value: 'call', label: 'Call', verb: 'Log the call you just had' },
  { value: 'meeting', label: 'Meeting', verb: 'Record the meeting' },
  { value: 'task', label: 'Task', verb: 'Give somebody something to do' },
];

/**
 * One box for every kind of history entry, because that is how the follow-up
 * actually happens: somebody picks what it was and writes a line.
 *
 * The due field only appears for a task, which is the same rule the table enforces
 * (`done_at is null or kind = 'task'` and its three target columns), so the screen
 * can never offer something the database would refuse.
 */
export function ActivityComposer({
  target,
  members,
  selfId,
}: {
  target: { contactId?: string; leadId?: string; dealId?: string };
  members: { id: string; name: string }[];
  selfId: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [kind, setKind] = useState<CrmActivityKind>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState(selfId);
  const [dueAt, setDueAt] = useState('');

  const isTask = kind === 'task';

  const submit = () => {
    void run(
      async () => {
        // The field holds a wall clock in the writer's own zone. Converting here, in
        // the browser that showed it, is the only place that knows which zone that
        // was; on the server the same string would be read as UTC.
        const due = dueAt === '' ? '' : new Date(dueAt).toISOString();
        const result = await addCrmActivity(target, { kind, subject, body, owner_id: ownerId, due_at: due });
        if (result.ok) {
          setSubject('');
          setBody('');
          setDueAt('');
          router.refresh();
        }
        return result;
      },
    );
  };

  return (
    <div className="rounded-md border border-line bg-raised px-3.5 py-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="What kind of entry">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={kind === option.value}
            onClick={() => setKind(option.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
              kind === option.value
                ? 'border-brand bg-brand text-white'
                : 'border-line-strong bg-surface text-ink-soft hover:border-brand hover:text-brand',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3">
        <Field label="Subject" htmlFor="activity-subject" error={fieldError('subject')}>
          <Input
            id="activity-subject"
            value={subject}
            maxLength={200}
            placeholder={KINDS.find((option) => option.value === kind)?.verb}
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>

        <Field label="What happened" htmlFor="activity-body" error={fieldError('body')}>
          <Textarea
            id="activity-body"
            rows={3}
            value={body}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={isTask ? 'Who does it?' : 'Who is it about?'} htmlFor="activity-owner">
            <Select id="activity-owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value={selfId}>Me</option>
              {members
                .filter((member) => member.id !== selfId)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </Select>
          </Field>

          {isTask ? (
            <Field label="Due" htmlFor="activity-due" hint="Optional">
              <Input
                id="activity-due"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </Field>
          ) : (
            <p className="self-end text-[11.5px] leading-relaxed text-muted">
              A {kind} keeps no due date and cannot be ticked off — only a task does.
            </p>
          )}
        </div>

        <FormStatus state={state} />

        <div className="flex justify-end">
          <Button variant="primary" loading={pending} disabled={subject.trim() === '' && body.trim() === ''} onClick={submit}>
            Add to the history
          </Button>
        </div>
      </div>
    </div>
  );
}

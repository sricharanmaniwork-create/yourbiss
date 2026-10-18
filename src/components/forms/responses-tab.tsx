'use client';

import { useMemo, useState, useTransition } from 'react';
import { Download, Inbox, Search, Trash } from 'lucide-react';
import type { FormSubmissionRow } from '@/lib/types';
import type { FormFieldDef } from '@/lib/forms/types';
import { isPresentational } from '@/lib/forms/types';
import { answerSummary, answerValue, orderedFields } from '@/lib/forms/definition';
import { deleteSubmission, setSubmissionState } from '@/lib/actions/forms';
import {
  Button,
  ButtonLink,
  EmptyState,
  Input,
  Modal,
  Select,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toast,
} from '@/components/ui';
import { formatInZone } from '@/lib/utils';

const STATES = ['all', 'new', 'read', 'replied', 'spam'] as const;
type StateFilter = (typeof STATES)[number];

/**
 * The answers, newest first.
 *
 * A row previews two questions and the dialog below shows the whole response, so a
 * twenty-question form stays readable in a narrow list. Nothing is edited in place:
 * a response is a record of what a visitor said at a moment in time and the database
 * refuses any change to it — the only thing that moves here is the triage state.
 *
 * The rows themselves come from the page and every change asks for a fresh read, so
 * what is on screen is what RLS let this member see, not what this component last
 * rendered.
 */
export function ResponsesTab({
  form,
  submissions,
  publicPath,
  timezone,
  canManage,
  canAdmin,
  onChanged,
}: {
  form: { id: string; slug: string; status: string; fields: FormFieldDef[]; settings: { field_order: string[] } };
  submissions: FormSubmissionRow[];
  publicPath: string;
  timezone: string;
  canManage: boolean;
  canAdmin: boolean;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<StateFilter>('all');
  const [term, setTerm] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const collecting = useMemo(
    () => orderedFields(form.fields, form.settings.field_order).filter((field) => !isPresentational(field.type)),
    [form.fields, form.settings.field_order],
  );

  const search = term.trim().toLowerCase();

  const shown = useMemo(
    () =>
      submissions.filter((submission) => {
        if (filter !== 'all' && submission.state !== filter) return false;
        if (search === '') return true;
        if (submission.submitter_email?.toLowerCase().includes(search)) return true;
        return answerSummary(collecting, submission.data).some((answer) =>
          answer.value.toLowerCase().includes(search),
        );
      }),
    [submissions, filter, search, collecting],
  );

  const opened = submissions.find((submission) => submission.id === openId) ?? null;

  const mark = (submission: FormSubmissionRow, state: FormSubmissionRow['state']) => {
    startTransition(async () => {
      const result = await setSubmissionState(submission.id, state).catch((e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : 'That response could not be updated',
      }));
      if (!result.ok) {
        toast.error(result.error ?? 'That response could not be updated');
        return;
      }
      onChanged();
    });
  };

  const view = (submission: FormSubmissionRow) => {
    setOpenId(submission.id);
    // Looking at it is the change: a first read clears a response from "new".
    if (canManage && submission.state === 'new') mark(submission, 'read');
  };

  const remove = (submission: FormSubmissionRow) => {
    startTransition(async () => {
      const result = await deleteSubmission(submission.id).catch((e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : 'That response could not be deleted',
      }));
      if (!result.ok) {
        toast.error(result.error ?? 'That response could not be deleted');
        return;
      }
      setOpenId(null);
      toast.success('Response deleted');
      onChanged();
    });
  };

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={<Inbox size={22} />}
        title="No responses yet"
        description={
          form.status === 'published'
            ? `Answers land here the moment someone submits ${publicPath}.`
            : 'Publish this form and the link starts collecting. Nothing to import or approve.'
        }
      />
    );
  }

  return (
    <section className="ui-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-[13.5px] font-semibold text-ink">
            {shown.length === submissions.length
              ? `${submissions.length} response${submissions.length === 1 ? '' : 's'}`
              : `${shown.length} of ${submissions.length} responses`}
          </p>
          <p className="text-[12px] text-muted">The newest 200 are listed here; the export carries every one.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search answers…"
            aria-label="Search answers"
            className="h-9 w-[210px]"
          />
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value as StateFilter)}
            aria-label="Filter by state"
            className="h-9 w-[130px]"
          >
            {STATES.map((state) => (
              <option key={state} value={state}>
                {state === 'all' ? 'All states' : state === 'new' ? 'New' : state === 'read' ? 'Read' : state === 'replied' ? 'Replied' : 'Spam'}
              </option>
            ))}
          </Select>
          <ButtonLink variant="secondary" href={`/app/forms/${form.id}/export`} download={`${form.slug}-responses.csv`}>
            <Download size={14} />
            Export CSV
          </ButtonLink>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-4 py-10 text-center text-[13px] text-muted">
          <Search size={15} />
          No response matches that {search === '' ? 'state' : 'search'}.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-[160px]">Submitted</TH>
              <TH className="w-[180px]">Email</TH>
              <TH>Answers</TH>
              <TH className="w-[110px]">State</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((submission) => {
              const preview = answerSummary(collecting, submission.data)
                .filter((answer) => answer.value !== '')
                .slice(0, 2);
              return (
                <TR key={submission.id} onClick={() => view(submission)}>
                  <TD className="whitespace-nowrap text-[12px] text-muted">
                    {formatInZone(submission.created_at, timezone, { dateStyle: 'medium', timeStyle: 'short' })}
                  </TD>
                  <TD className="max-w-[180px] truncate text-[12.5px]">{submission.submitter_email ?? '—'}</TD>
                  <TD className="max-w-0">
                    {preview.length === 0 ? (
                      <span className="text-[12.5px] text-muted">No answers recorded</span>
                    ) : (
                      <span className="block truncate text-[12.5px] text-ink-soft">
                        {preview.map((answer) => `${answer.label}: ${answer.value}`).join('  ·  ')}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <StatusBadge state={submission.state} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <Detail
        submission={opened}
        fields={collecting}
        timezone={timezone}
        pending={pending}
        canManage={canManage}
        canAdmin={canAdmin}
        onClose={() => setOpenId(null)}
        onMark={mark}
        onRemove={remove}
      />
    </section>
  );
}

function Detail({
  submission,
  fields,
  timezone,
  pending,
  canManage,
  canAdmin,
  onClose,
  onMark,
  onRemove,
}: {
  submission: FormSubmissionRow | null;
  fields: FormFieldDef[];
  timezone: string;
  pending: boolean;
  canManage: boolean;
  canAdmin: boolean;
  onClose: () => void;
  onMark: (submission: FormSubmissionRow, state: FormSubmissionRow['state']) => void;
  onRemove: (submission: FormSubmissionRow) => void;
}) {
  if (!submission) return null;

  const answers = fields.map((field) => ({
    label: field.label || field.id,
    value: answerValue(field, submission.data[field.id]),
    signature: field.type === 'signature' && typeof submission.data[field.id] === 'string' && (submission.data[field.id] as string).startsWith('data:image/') ? (submission.data[field.id] as string) : null,
  }));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Response"
      description={`Submitted ${formatInZone(submission.created_at, timezone, { dateStyle: 'medium', timeStyle: 'medium' })}`}
      footer={
        <>
          {canAdmin && (
            <Button variant="outlineDanger" loading={pending} onClick={() => onRemove(submission)}>
              <Trash size={14} />
              Delete
            </Button>
          )}
          {canManage ? (
            <Select
              aria-label="Response state"
              value={submission.state}
              className="h-9 w-[130px]"
              onChange={(event) => onMark(submission, event.target.value as FormSubmissionRow['state'])}
            >
              <option value="new">New</option>
              <option value="read">Read</option>
              <option value="replied">Replied</option>
              <option value="spam">Spam</option>
            </Select>
          ) : (
            <StatusBadge state={submission.state} />
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <dl className="grid gap-2.5">
        {answers.length === 0 ? (
          <p className="text-[13px] text-muted">This response holds no answers for the questions on the form today.</p>
        ) : (
          answers.map((answer, index) => (
            <div key={`${answer.label}-${index}`} className="border-b border-line pb-2 last:border-b-0 last:pb-0">
              <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{answer.label}</dt>
              <dd className="mt-0.5 text-[13px] break-words whitespace-pre-wrap text-ink">
                {answer.signature ? (
                  <img src={answer.signature} alt={`${answer.label} signature`} className="h-20 rounded-md border border-line bg-white" />
                ) : answer.value === '' ? (
                  <span className="text-muted">No answer</span>
                ) : (
                  answer.value
                )}
              </dd>
            </div>
          ))
        )}
      </dl>

      <div className="mt-4 grid gap-1 rounded-md bg-canvas px-3 py-2.5 text-[11.5px] text-muted">
        <p>
          Email on this response: <span className="text-ink-soft">{submission.submitter_email ?? 'none collected'}</span>
        </p>
        {submission.source_url && (
          <p className="break-all">
            Submitted from: <span className="text-ink-soft">{submission.source_url}</span>
          </p>
        )}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
        A response cannot be edited. It is what the visitor said at the moment they said it, and the database turns down
        any change to the stored answers — the state above is the only thing that moves.
      </p>
    </Modal>
  );
}

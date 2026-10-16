'use client';

import { useRef, useState } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import { deleteEmailTemplate, saveEmailTemplate } from '@/lib/actions/settings';
import { Badge, Button, Field, FormStatus, Input, Modal, Switch, Textarea, toast, useAction } from '@/components/ui';

/** Mirrors `TemplateKeyInfo` in `src/lib/mail/overrides.ts`, which the browser cannot import. */
export interface TemplateInfo {
  key: string;
  label: string;
  note: string;
  tokens: { name: string; meaning: string }[];
  internal?: boolean;
}

export interface SavedTemplate {
  key: string;
  subject: string;
  html_body: string;
  enabled: boolean;
}

/**
 * The workspace's own wording for the letters it sends.
 *
 * A row in `email_templates` replaces ours; no row means the built-in letter goes out. That
 * is the rule migration 0006 wrote for this table, and this screen is the only way to exercise
 * it — which is also why the table lists every letter it can override and nothing else.
 *
 * What is typed here is treated as text, never as HTML. It goes through the same escaped shell
 * as the default letter, so a line break is a line break and a link is made from a bare URL —
 * and a `<script>` is printed to the page as the characters it is. There is no preview, because
 * a preview would have to be rendered by something other than the thing that renders the letter,
 * and the two would eventually disagree.
 */
export function EmailTemplates({ orgId, letters, saved }: { orgId: string; letters: TemplateInfo[]; saved: SavedTemplate[] }) {
  const { state, pending, run, fieldError } = useAction();
  const [letter, setLetter] = useState<TemplateInfo | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [enabled, setEnabled] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const byKey = new Map(saved.map((row) => [row.key, row]));

  const openLetter = (info: TemplateInfo) => {
    const row = byKey.get(info.key);
    setSubject(row?.subject ?? '');
    setBody(row?.html_body ?? '');
    setEnabled(row?.enabled ?? true);
    setLetter(info);
  };

  const insertToken = (name: string) => {
    const token = `{{${name}}}`;
    const element = bodyRef.current;
    const from = element?.selectionStart ?? body.length;
    const to = element?.selectionEnd ?? from;
    setBody(`${body.slice(0, from)}${token}${body.slice(to)}`);
    // The caret goes after the token, so two clicks in a row read as two tokens, not one nested.
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      element.selectionStart = element.selectionEnd = from + token.length;
    });
  };

  const save = () => {
    if (!letter) return;
    void run(async () => {
      const result = await saveEmailTemplate({ orgId, key: letter.key, subject, body, enabled });
      if (result.ok) {
        toast.success(enabled ? `${letter.label} now sends your wording` : `${letter.label} saved, and paused`);
        setLetter(null);
      }
      return result;
    });
  };

  const useOurs = () => {
    if (!letter) return;
    void run(async () => {
      const result = await deleteEmailTemplate(orgId, letter.key);
      if (result.ok) {
        toast.success(`${letter.label} is back to the wording Yourbiss writes`);
        setLetter(null);
      }
      return result;
    });
  };

  return (
    <div className="grid gap-3">
      <ul className="divide-y divide-line rounded-md border border-line">
        {letters.map((info) => {
          const row = byKey.get(info.key);
          return (
            <li key={info.key} className="flex items-start gap-3 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{info.label}</span>
                  {row ? (
                    <Badge tone={row.enabled ? 'success' : 'neutral'} dot>
                      {row.enabled ? 'your wording' : 'paused'}
                    </Badge>
                  ) : (
                    <Badge tone='neutral'>our wording</Badge>
                  )}
                  {info.internal && <span className="text-[11.5px] text-muted">goes to your team</span>}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{info.note}</p>
                {row?.enabled && (
                  <p className="mt-1 truncate text-[12px] text-ink-soft" title={row.subject}>
                    {row.subject}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => openLetter(info)}>
                <Pencil size={13} />
                {row ? 'Edit' : 'Write'}
              </Button>
            </li>
          );
        })}
      </ul>

      <p className="text-[11.5px] leading-relaxed text-muted">
        Sign-up, password and welcome mails are written by the authentication server, not here — those three are styled
        in Supabase, and delivered through the same Resend relay as everything else.
      </p>

      <Modal
        open={letter !== null}
        onClose={() => setLetter(null)}
        title={letter ? `${letter.label}` : 'A letter'}
        description={letter?.note}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onChange={setEnabled} label="Send this wording" />
            </div>
            <div className="flex items-center gap-2">
              {letter && byKey.has(letter.key) && (
                <Button variant="ghost" onClick={useOurs} disabled={pending}>
                  <RotateCcw size={13} />
                  Use ours
                </Button>
              )}
              <Button variant="ghost" onClick={() => setLetter(null)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={pending}>
                Save letter
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <FormStatus state={state} />

          <Field label="Subject" htmlFor="template-subject" required error={fieldError('subject')}>
            <Input
              id="template-subject"
              value={subject}
              maxLength={200}
              placeholder="Booking confirmed: {{service_name}}"
              invalid={!!fieldError('subject')}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>

          <Field
            label="Body"
            htmlFor="template-body"
            required
            error={fieldError('body')}
            hint="Plain text. A blank line starts a new paragraph, and a web address becomes a link."
          >
            <Textarea
              ref={bodyRef}
              id="template-body"
              value={body}
              rows={12}
              maxLength={20000}
              placeholder={'Hi {{customer_name}},\n\n{{service_name}} with {{staff_name}} is booked for {{when}} ({{timezone}}).\n\nNeed to change it? {{manage_url}}'}
              invalid={!!fieldError('body')}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>

          <div>
            <p className="text-[12px] font-medium text-ink">Click a detail to put it in the letter</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(letter?.tokens ?? []).map((token) => (
                <button
                  key={token.name}
                  type="button"
                  onClick={() => insertToken(token.name)}
                  title={token.meaning}
                  className="rounded border border-line bg-raised px-2 py-1 font-mono text-[11.5px] text-ink-soft hover:border-brand hover:text-brand"
                >
                  {'{{'}
                  {token.name}
                  {'}}'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

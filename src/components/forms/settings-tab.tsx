'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash } from 'lucide-react';
import type { ActionState, FormPrivateRow } from '@/lib/types';
import type { FormSettings, FormTheme } from '@/lib/forms/types';
import { pagesOf } from '@/lib/forms/definition';
import { deleteForm, saveFormDefinition, saveFormPrivates, setFormStatus } from '@/lib/actions/forms';
import { Button, Checkbox, Field, FormStatus, Input, Modal, Select, Switch, Textarea, toast } from '@/components/ui';
import { formatInZone, isValidSlug, slugify } from '@/lib/utils';
import type { FormDocument } from './form-overview';

/**
 * What the form is called, how it behaves, and where the answers go.
 *
 * The top two cards write the form's own row and are open to any member of the
 * workspace, because that is what publishing a form needs. The delivery card writes
 * `form_privates` — notification addresses, the visitor's receipt, the webhook and
 * its signing secret — and is admin-only, because RLS there is stricter than
 * anywhere else in the module.
 *
 * A save here carries the field list from the page untouched, so saving the theme
 * cannot undo a question and the Build tab cannot lose a setting.
 */
export function SettingsTab({
  form,
  privates,
  orgSlug,
  timezone,
  canManage,
  canAdmin,
  onSaved,
}: {
  form: FormDocument;
  privates: (FormPrivateRow & { hasSecret: boolean }) | null;
  orgSlug: string;
  timezone: string;
  canManage: boolean;
  canAdmin: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(form.title);
  const [slug, setSlug] = useState(form.slug);
  const [description, setDescription] = useState(form.description ?? '');
  const [settings, setSettings] = useState<FormSettings>(form.settings);
  const [theme, setTheme] = useState<FormTheme>(form.theme);
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    title !== form.title ||
    slug !== form.slug ||
    description !== (form.description ?? '') ||
    JSON.stringify({ settings, theme }) !== JSON.stringify({ settings: form.settings, theme: form.theme });

  const badSlug = !isValidSlug(slug);
  const pageCount = pagesOf(form.fields, settings.field_order).length;
  const discard = () => {
    setTitle(form.title);
    setSlug(form.slug);
    setDescription(form.description ?? '');
    setSettings(form.settings);
    setTheme(form.theme);
  };

  const save = () => {
    setState(null);
    startTransition(async () => {
      const result: ActionState = await saveFormDefinition(form.id, {
        title,
        description,
        slug,
        fields: form.fields,
        settings,
        theme,
      }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'The form could not be saved' }));
      setState(result);
      if (!result.ok) return;
      toast.success('Form settings saved');
      onSaved();
    });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="ui-card">
          <header className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">Identity</p>
            <p className="text-[12px] text-muted">The title a visitor reads, and the address the form answers on.</p>
          </header>
          <div className="grid gap-3 px-4 py-4">
            <FormStatus state={state} />

            <Field label="Title" htmlFor="form-title" required error={state && !state.ok ? state.fields?.title : undefined}>
              <Input
                id="form-title"
                value={title}
                maxLength={140}
                disabled={!canManage}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (slug === slugify(form.title, 'form')) setSlug(slugify(event.target.value, 'form'));
                }}
              />
            </Field>

            <Field
              label="Address"
              htmlFor="form-slug"
              error={slug !== '' && badSlug ? 'Use lowercase letters, numbers and single dashes' : undefined}
              hint={`Visitors answer at /f/${orgSlug}/${slug || '…'}`}
            >
              <Input
                id="form-slug"
                value={slug}
                maxLength={60}
                spellCheck={false}
                disabled={!canManage}
                invalid={slug !== '' && badSlug}
                onChange={(event) =>
                  setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'))
                }
              />
            </Field>

            <Field label="Introduction" htmlFor="form-intro" hint="Shown under the title, to everyone who opens the form.">
              <Textarea
                id="form-intro"
                rows={3}
                value={description}
                maxLength={2000}
                disabled={!canManage}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="ui-card">
          <header className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">Behaviour</p>
            <p className="text-[12px] text-muted">What happens when a visitor presses submit.</p>
          </header>
          <div className="grid gap-3 px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Submit button" htmlFor="form-submit-label">
                <Input
                  id="form-submit-label"
                  value={settings.submit_label}
                  maxLength={60}
                  disabled={!canManage}
                  onChange={(event) => setSettings({ ...settings, submit_label: event.target.value })}
                />
              </Field>
              <Field label="Responses close" htmlFor="form-close" hint={settings.close_at ? formatInZone(settings.close_at, timezone, { dateStyle: 'medium', timeStyle: 'short' }) : 'No deadline'}>
                <Input
                  id="form-close"
                  type="datetime-local"
                  value={toLocalInput(settings.close_at)}
                  disabled={!canManage}
                  onChange={(event) => setSettings({ ...settings, close_at: fromLocalInput(event.target.value) })}
                />
              </Field>
            </div>

            <Field label="Thank-you message" htmlFor="form-success" hint="Read on the page after a response is stored.">
              <Textarea
                id="form-success"
                rows={2}
                value={settings.success_message}
                maxLength={1000}
                disabled={!canManage}
                onChange={(event) => setSettings({ ...settings, success_message: event.target.value })}
              />
            </Field>

            <Field
              label="Send the visitor elsewhere"
              htmlFor="form-redirect"
              error={state && !state.ok ? state.fields?.settings : undefined}
              hint="Optional. https:// included."
            >
              <Input
                id="form-redirect"
                value={settings.redirect_url}
                maxLength={600}
                spellCheck={false}
                placeholder="https://…"
                disabled={!canManage}
                onChange={(event) => setSettings({ ...settings, redirect_url: event.target.value })}
              />
            </Field>

            <div className="flex items-start justify-between gap-3 rounded-md border border-line px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink">One response per visitor</p>
                <p className="text-[11.5px] leading-relaxed text-muted">
                  The second submission from the same browser and network is turned away, and the first answer is kept.
                  Off by default, because a form used by a shared front desk must not lock the whole office out.
                </p>
              </div>
              <Switch
                checked={settings.one_per_visitor}
                disabled={!canManage}
                label="One response per visitor"
                onChange={(checked) => setSettings({ ...settings, one_per_visitor: checked })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border border-line px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink">Show progress across pages</p>
                <p className="text-[11.5px] leading-relaxed text-muted">
                  A bar above the questions saying which page the visitor is on. It shows once the form is cut into
                  pages with a page break.
                </p>
              </div>
              <Switch
                checked={settings.show_progress}
                disabled={!canManage}
                label="Show progress across pages"
                onChange={(checked) => setSettings({ ...settings, show_progress: checked })}
              />
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border border-line px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-ink">Review answers before submitting</p>
                <p className="text-[11.5px] leading-relaxed text-muted">
                  The visitor reads through everything they typed, a page at a time, and can go back to any of them
                  before sending.
                  {pageCount < 2 ? ' Needs a page break in Build first.' : ''}
                </p>
              </div>
              <Switch
                checked={settings.review_page}
                disabled={!canManage}
                label="Review answers before submitting"
                onChange={(checked) => setSettings({ ...settings, review_page: checked })}
              />
            </div>
          </div>
        </section>
      </div>

      <ThemeCard theme={theme} canManage={canManage} onChange={setTheme} error={state && !state.ok ? state.fields?.theme : undefined} />

      <div className="flex items-center justify-end gap-2">
        {!canManage && (
          <p className="mr-auto text-[12px] leading-relaxed text-muted">
            The Forms app is switched off for this workspace, so these settings can be read but not changed.
          </p>
        )}
        {canManage && dirty && (
          <Button variant="ghost" onClick={discard}>
            Discard
          </Button>
        )}
        {canManage && (
          <Button variant="primary" loading={pending} disabled={!dirty || badSlug || title.trim() === ''} onClick={save}>
            Save settings
          </Button>
        )}
      </div>

      <DeliveryCard form={form} privates={privates} canAdmin={canAdmin} onSaved={onSaved} />
      <DangerCard form={form} canAdmin={canAdmin} onArchived={() => router.push('/app/forms')} onDeleted={() => router.push('/app/forms')} />
    </div>
  );
}

function ThemeCard({
  theme,
  canManage,
  error,
  onChange,
}: {
  theme: FormTheme;
  canManage: boolean;
  error?: string;
  onChange: (next: FormTheme) => void;
}) {
  const widths: { value: FormTheme['width']; label: string }[] = [
    { value: 'narrow', label: 'Narrow (520px)' },
    { value: 'default', label: 'Default (640px)' },
    { value: 'wide', label: 'Wide (760px)' },
  ];

  return (
    <section className="ui-card">
      <header className="border-b border-line px-4 py-3">
        <p className="text-[13.5px] font-semibold text-ink">Appearance</p>
        <p className="text-[12px] text-muted">
          Applies to the shared link and to the embed block on a published page, which inherits the form&apos;s own
          colours.
        </p>
      </header>
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Accent" htmlFor="form-accent" error={error}>
          <div className="flex gap-2">
            <input
              id="form-accent"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(theme.accent) ? theme.accent : '#2E6BE6'}
              disabled={!canManage}
              onChange={(event) => onChange({ ...theme, accent: event.target.value.toUpperCase() })}
              className="h-9 w-10 flex-none cursor-pointer rounded-md border border-line-strong bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Accent colour"
            />
            <Input
              value={theme.accent}
              maxLength={7}
              spellCheck={false}
              disabled={!canManage}
              aria-label="Accent colour as a hex code"
              onChange={(event) => onChange({ ...theme, accent: event.target.value })}
            />
          </div>
        </Field>

        <Field label="Card colour" htmlFor="form-background">
          <div className="flex gap-2">
            <input
              id="form-background"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(theme.background) ? theme.background : '#FFFFFF'}
              disabled={!canManage}
              onChange={(event) => onChange({ ...theme, background: event.target.value.toUpperCase() })}
              className="h-9 w-10 flex-none cursor-pointer rounded-md border border-line-strong bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Card colour"
            />
            <Input
              value={theme.background}
              maxLength={7}
              spellCheck={false}
              disabled={!canManage}
              aria-label="Card colour as a hex code"
              onChange={(event) => onChange({ ...theme, background: event.target.value })}
            />
          </div>
        </Field>

        <Field label="Question width" htmlFor="form-width">
          <Select
            id="form-width"
            value={theme.width}
            disabled={!canManage}
            onChange={(event) => onChange({ ...theme, width: event.target.value as FormTheme['width'] })}
          >
            {widths.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Labels" htmlFor="form-label-case">
          <Select
            id="form-label-case"
            value={theme.label_case}
            disabled={!canManage}
            onChange={(event) => onChange({ ...theme, label_case: event.target.value === 'uppercase' ? 'uppercase' : 'normal' })}
          >
            <option value="normal">As typed</option>
            <option value="uppercase">UPPERCASE</option>
          </Select>
        </Field>

        <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5 sm:col-span-2 lg:col-span-4">
          <span className="text-[12.5px] font-medium text-ink">Rounded corners</span>
          <Switch
            checked={theme.rounded}
            disabled={!canManage}
            label="Rounded corners"
            onChange={(checked) => onChange({ ...theme, rounded: checked })}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Notification addresses, the visitor's receipt and the webhook.
 *
 * The signing secret is write-only: the page learns whether one is stored and can
 * replace or clear it, but the stored value never comes back to a browser.
 */
function DeliveryCard({
  form,
  privates,
  canAdmin,
  onSaved,
}: {
  form: FormDocument;
  privates: (FormPrivateRow & { hasSecret: boolean }) | null;
  canAdmin: boolean;
  onSaved: () => void;
}) {
  const [emails, setEmails] = useState<string[]>(privates?.notify_emails ?? []);
  const [draft, setDraft] = useState('');
  const [notifyRecipient, setNotifyRecipient] = useState(privates?.notify_recipient ?? false);
  const [subject, setSubject] = useState(privates?.confirmation_subject ?? '');
  const [html, setHtml] = useState(privates?.confirmation_html ?? '');
  const [webhookUrl, setWebhookUrl] = useState(privates?.webhook_url ?? '');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const saved = JSON.stringify({
    emails: privates?.notify_emails ?? [],
    notifyRecipient: privates?.notify_recipient ?? false,
    subject: privates?.confirmation_subject ?? '',
    html: privates?.confirmation_html ?? '',
    webhookUrl: privates?.webhook_url ?? '',
    secret: '',
    clearSecret: false,
  });
  const dirty =
    JSON.stringify({ emails, notifyRecipient, subject, html, webhookUrl, secret, clearSecret }) !== saved;

  const addEmail = () => {
    const value = draft.trim().toLowerCase();
    if (value === '') return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setState({ ok: false, error: 'Enter a real email address' });
      return;
    }
    if (emails.length >= 20) {
      setState({ ok: false, error: 'Twenty addresses is the limit for one form' });
      return;
    }
    if (emails.includes(value)) {
      setDraft('');
      return;
    }
    setEmails([...emails, value]);
    setDraft('');
    setState(null);
  };

  const save = () => {
    setState(null);
    startTransition(async () => {
      const result: ActionState = await saveFormPrivates(form.id, {
        notify_emails: emails,
        notify_recipient: notifyRecipient,
        confirmation_subject: subject,
        confirmation_html: html,
        // The redirect a visitor is sent to after submitting is a behaviour
        // setting on the form itself, above. This column is the same idea from an
        // older shape, so it is written empty rather than left to disagree.
        redirect_url: '',
        webhook_url: webhookUrl,
        webhook_secret: secret,
        clear_secret: clearSecret,
      }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'The delivery settings could not be saved' }));
      setState(result);
      if (!result.ok) return;
      setSecret('');
      setClearSecret(false);
      toast.success('Delivery settings saved');
      onSaved();
    });
  };

  if (!canAdmin) {
    return (
      <section className="ui-card">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Where responses go</p>
        </header>
        <p className="px-4 py-4 text-[12.5px] leading-relaxed text-muted">
          Notification addresses, the copy emailed back to the visitor, and the webhook are set by the owner or an admin
          of this workspace. Responses are still recorded in this app for every member to read.
        </p>
      </section>
    );
  }

  return (
    <section className="ui-card">
      <header className="border-b border-line px-4 py-3">
        <p className="text-[13.5px] font-semibold text-ink">Where responses go</p>
        <p className="text-[12px] text-muted">
          Every form keeps its answers in this workspace whatever is set here; this decides who else is told.
        </p>
      </header>

      <div className="grid gap-4 px-4 py-4">
        <FormStatus state={state} />

        <div className="grid gap-2">
          <p className="text-[12.5px] font-medium text-ink-soft">Notify these addresses</p>
          {emails.length === 0 && (
            <p className="text-[11.5px] text-muted">Nobody is emailed. Answers only ever appear in the responses list.</p>
          )}
          {emails.map((email) => (
            <div key={email} className="flex items-center gap-2 rounded-md border border-line bg-canvas px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{email}</span>
              <Button variant="ghost" size="sm" aria-label={`Remove ${email}`} onClick={() => setEmails(emails.filter((entry) => entry !== email))}>
                <Trash size={13} />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={draft}
              type="email"
              maxLength={320}
              spellCheck={false}
              placeholder="name@company.com"
              aria-label="Address to notify"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addEmail();
                }
              }}
            />
            <Button variant="secondary" onClick={addEmail} disabled={draft.trim() === ''}>
              <Plus size={14} />
              Add
            </Button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted">
            Up to twenty. Each address must belong to someone who reads it — a form that emails a mailbox nobody owns
            looks like spam within a week.
          </p>
        </div>

        <div className="grid gap-3 border-t border-line pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-ink">Email a copy to the visitor</p>
              <p className="text-[11.5px] leading-relaxed text-muted">
                Needs a question that collects an email address, and the message below. With no message written, nothing
                is sent — Yourbiss will not put an unasked-for receipt in someone&apos;s inbox.
              </p>
            </div>
            <Switch checked={notifyRecipient} label="Email a copy to the visitor" onChange={setNotifyRecipient} />
          </div>

          <Field label="Subject" htmlFor="priv-subject">
            <Input
              id="priv-subject"
              value={subject}
              maxLength={200}
              placeholder={`We received your ${form.title}`}
              onChange={(event) => setSubject(event.target.value)}
            />
          </Field>

          <Field label="Message" htmlFor="priv-html" hint="Sent as HTML, with your own workspace signature.">
            <Textarea
              id="priv-html"
              rows={6}
              value={html}
              maxLength={20000}
              spellCheck={false}
              placeholder="<p>Thanks for getting in touch. We reply within two working days.</p>"
              onChange={(event) => setHtml(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 border-t border-line pt-4">
          <p className="text-[12.5px] font-medium text-ink-soft">Forward each response to another system</p>

          <Field
            label="Webhook URL"
            htmlFor="priv-webhook"
            error={state && !state.ok ? state.fields?.webhook_url : undefined}
            hint="POSTed as JSON over https:// within five seconds. Leaving it empty switches the webhook off."
          >
            <Input
              id="priv-webhook"
              value={webhookUrl}
              maxLength={600}
              spellCheck={false}
              placeholder="https://hooks.company.com/yourbiss/forms"
              invalid={Boolean(state && !state.ok && state.fields?.webhook_url)}
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
          </Field>

          <Field
            label="Signing secret"
            htmlFor="priv-secret"
            error={state && !state.ok ? state.fields?.webhook_secret : undefined}
            hint={privates?.hasSecret ? 'A secret is stored. Type a new one to replace it.' : 'Optional.'}
          >
            <Input
              id="priv-secret"
              value={secret}
              maxLength={200}
              spellCheck={false}
              autoComplete="off"
              placeholder={privates?.hasSecret ? 'unchanged' : 'a shared random string'}
              onChange={(event) => {
                setSecret(event.target.value);
                if (event.target.value !== '') setClearSecret(false);
              }}
            />
          </Field>

          {privates?.hasSecret && (
            <label className="flex items-center gap-2 text-[12px] text-ink-soft">
              <Checkbox
                checked={clearSecret}
                aria-label="Remove the stored secret"
                onChange={(event) => {
                  setClearSecret(event.target.checked);
                  if (event.target.checked) setSecret('');
                }}
              />
              Remove the stored secret
            </label>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted">
            When a secret is set, every call carries <span className="font-mono text-[11px]">x-yourbiss-signature: v1=…</span>
            {' '}— the SHA-256 HMAC of the exact body. A receiver that does not check it is accepting a request anybody
            could have sent. The secret itself never leaves the server, so it cannot be read back after it is saved.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setEmails(privates?.notify_emails ?? []);
                setNotifyRecipient(privates?.notify_recipient ?? false);
                setSubject(privates?.confirmation_subject ?? '');
                setHtml(privates?.confirmation_html ?? '');
                setWebhookUrl(privates?.webhook_url ?? '');
                setSecret('');
                setClearSecret(false);
                setState(null);
              }}
            >
              Discard
            </Button>
          )}
          <Button variant="primary" loading={pending} disabled={!dirty} onClick={save}>
            Save delivery
          </Button>
        </div>
      </div>
    </section>
  );
}

function DangerCard({
  form,
  canAdmin,
  onArchived,
  onDeleted,
}: {
  form: FormDocument;
  canAdmin: boolean;
  onArchived: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState<null | 'archive' | 'delete'>(null);
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canAdmin) return null;

  const run = () => {
    if (!confirm) return;
    setState(null);
    startTransition(async () => {
      const result: ActionState =
        confirm === 'archive'
          ? await setFormStatus(form.id, 'archived').catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'The form could not be archived' }))
          : await deleteForm(form.id).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'The form could not be deleted' }));
      if (!result.ok) {
        setState(result);
        return;
      }
      if (confirm === 'archive') toast.success('Form archived');
      else toast.success('Form deleted');
      if (confirm === 'archive') onArchived();
      else onDeleted();
    });
  };

  return (
    <section className="ui-card border-[#f0c3bf]">
      <header className="border-b border-line px-4 py-3">
        <p className="text-[13.5px] font-semibold text-ink">Archive or delete</p>
        <p className="text-[12px] text-muted">Two different things, and only one of them can be undone from this screen.</p>
      </header>
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            Archiving takes the form out of every list and stops its link collecting answers. The responses stay, and an
            admin can set the status back to draft in the database.
          </p>
          <Button variant="outlineDanger" className="mt-3" disabled={pending} onClick={() => setConfirm('archive')}>
            Archive form
          </Button>
        </div>
        <div>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            Deleting removes the form and every response recorded against it. Nothing is left to restore.
          </p>
          <Button variant="outlineDanger" className="mt-3" disabled={pending} onClick={() => setConfirm('delete')}>
            <Trash size={14} />
            Delete form
          </Button>
        </div>
        <div className="sm:col-span-2">
          <FormStatus state={state} />
        </div>
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'delete' ? `Delete “${form.title}”?` : `Archive “${form.title}”?`}
        description={
          confirm === 'delete'
            ? 'This removes the form and all of its responses.'
            : 'The link stops collecting and the form leaves every list.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button variant="danger" loading={pending} onClick={run}>
              {confirm === 'delete' ? 'Delete form' : 'Archive form'}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          {confirm === 'delete' ? (
            <>
              {form.submissionCount === 0
                ? 'This form has no responses, so nothing else goes with it.'
                : `${form.submissionCount} response${form.submissionCount === 1 ? '' : 's'} will be deleted with it. Any embed block on a published page that points at this form will show that it is unavailable.`}
            </>
          ) : (
            'Visitors on the link are told the form is closed, and embed blocks on your pages show the same. An admin can bring it back later; nobody else can.'
          )}
        </p>
      </Modal>
    </section>
  );
}

/** A `datetime-local` value shown in the browser's own zone, so the round trip is stable. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

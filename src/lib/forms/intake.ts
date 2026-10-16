import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/mail';
import { formResponseMail, mailBase } from '@/lib/mail/templates';
import { answerSummary } from './definition';
import type { PublicForm } from './public';
import type { FormFieldDef } from './types';

/**
 * Writing a response a visitor submitted.
 *
 * Three things happen here and only the first one is allowed to fail the request:
 * the row itself goes in through `record_form_submission`, which locks the form,
 * applies the duplicate guard and counts the response in one transaction. Mail and
 * the webhook are deliveries after the fact — a broken inbox must not tell a
 * customer their application was lost, so both are tried, logged, and never
 * rethrown.
 */

export interface Privates {
  notify_emails: string[];
  notify_recipient: boolean;
  confirmation_subject: string | null;
  confirmation_html: string | null;
  redirect_url: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
}

const EMPTY_PRIVATES: Privates = {
  notify_emails: [],
  notify_recipient: false,
  confirmation_subject: null,
  confirmation_html: null,
  redirect_url: null,
  webhook_url: null,
  webhook_secret: null,
};

/**
 * Read with the service role because `form_privates` is admin-only under RLS and
 * this runs on an anonymous submit. The caller passes a form id that already came
 * back from a published-form read, so nothing here trusts an id from the request.
 */
export async function readPrivates(formId: string): Promise<Privates> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('form_privates')
    .select('notify_emails, notify_recipient, confirmation_subject, confirmation_html, redirect_url, webhook_url, webhook_secret')
    .eq('form_id', formId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const row = data as unknown as Privates | null;
  if (!row) return EMPTY_PRIVATES;
  return {
    notify_emails: Array.isArray(row.notify_emails) ? row.notify_emails : [],
    notify_recipient: row.notify_recipient === true,
    confirmation_subject: row.confirmation_subject || null,
    confirmation_html: row.confirmation_html || null,
    redirect_url: row.redirect_url || null,
    webhook_url: row.webhook_url || null,
    webhook_secret: row.webhook_secret || null,
  };
}

/**
 * 64 hex characters of salted hash — the shape `form_submissions.visitor_key`
 * requires. The visitor's address is never stored to identify them with, only to
 * notice that the same person already answered.
 */
export function visitorKey(ipLike: string, formId: string, domain: string): string {
  return createHash('sha256').update(`${domain}|${formId}|${ipLike}`).digest('hex').slice(0, 64);
}

export interface StoredResponse {
  id: string;
  redirect: string | null;
  mail: { notified: boolean; confirmed: boolean; error?: string };
  webhook: 'none' | 'delivered' | 'failed';
}

export async function storeResponse(input: {
  form: PublicForm;
  fields: FormFieldDef[];
  privates: Privates;
  values: Record<string, unknown>;
  submitterEmail: string | null;
  visitorKey: string | null;
  sourceUrl: string | null;
  userAgent: string | null;
}): Promise<StoredResponse> {
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('record_form_submission', {
    p_form_id: input.form.id,
    p_data: input.values,
    p_submitter_email: input.submitterEmail,
    p_visitor_key: input.visitorKey,
    p_source_url: input.sourceUrl ? input.sourceUrl.slice(0, 500) : null,
    p_user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
  });

  if (error) {
    const refusal = describe(error.message, error.code);
    throw new SubmitRejected(refusal.message, refusal.duplicate);
  }

  const id = String(data);
  const redirect = input.form.settings.redirect_url || input.privates.redirect_url || null;

  const mail = await notify(input.form, input.privates, input.fields, input.values, input.submitterEmail, id).catch(
    (e: unknown) => ({ notified: false, confirmed: false, error: e instanceof Error ? e.message : 'Mail failed' }),
  );

  const webhook = input.privates.webhook_url
    ? await deliverWebhook(input.privates.webhook_url, input.privates.webhook_secret, {
        form_id: input.form.id,
        form_title: input.form.title,
        submission_id: id,
        submitted_at: new Date().toISOString(),
        answers: input.values,
      })
    : 'none';

  return { id, redirect, mail, webhook };
}

/**
 * Thrown when the database refused the answer set, so the route can answer 409.
 * `duplicate` marks the one refusal that is not a fault — the visitor already
 * answered — so a newsletter block can thank them instead of warning them.
 */
export class SubmitRejected extends Error {
  constructor(message: string, readonly duplicate: boolean = false) {
    super(message);
    this.name = 'SubmitRejected';
  }
}

function describe(message: string, code?: string): { message: string; duplicate: boolean } {
  if (code === '23505' || message.includes('already answered')) {
    return { message: 'This form only takes one response per visitor. Yours is already recorded.', duplicate: true };
  }
  if (message.includes('not accepting responses')) return { message: 'This form is no longer accepting responses.', duplicate: false };
  if (message.includes('missing required')) return { message: 'Some required questions were left blank.', duplicate: false };
  if (message.includes('unexpected answer')) return { message: 'The answers sent do not match this form.', duplicate: false };
  console.error('[yourbiss] form submission refused', { code, message });
  return { message: 'Your response could not be recorded.', duplicate: false };
}

/**
 * The team copy and the receipt. `confirmation_html` is the workspace's own wording,
 * stored as it was typed; without it a submitter gets no mail at all, which is the
 * honest default rather than a Yourbiss-bracketed "thanks" they never asked for.
 */
async function notify(
  form: PublicForm,
  privates: Privates,
  fields: FormFieldDef[],
  values: Record<string, unknown>,
  submitterEmail: string | null,
  submissionId: string,
): Promise<{ notified: boolean; confirmed: boolean; error?: string }> {
  const base = mailBase(form.orgName);
  const answers = answerSummary(fields, values);
  let error: string | undefined;
  let notified = false;
  let confirmed = false;

  if (privates.notify_emails.length > 0) {
    const mail = formResponseMail(base, { formTitle: form.title, answers, submitterEmail, orgName: form.orgName });
    for (const to of privates.notify_emails) {
      const outcome = await sendMail({
        orgId: form.orgId,
        to,
        mail,
        template: 'form_response',
        relatedType: 'form_submission',
        relatedId: submissionId,
        replyTo: submitterEmail ?? undefined,
      });
      notified = notified || outcome.delivered;
      error = outcome.delivered ? error : (outcome.error ?? error);
    }
  }

  if (privates.notify_recipient && submitterEmail && privates.confirmation_html) {
    const outcome = await sendMail({
      orgId: form.orgId,
      to: submitterEmail,
      mail: {
        subject: privates.confirmation_subject || `We received your ${form.title}`,
        html: privates.confirmation_html,
        text: privates.confirmation_html.replace(/<[^>]+>/g, ' '),
      },
      template: 'form_confirmation',
      relatedType: 'form_submission',
      relatedId: submissionId,
    });
    confirmed = outcome.delivered;
    if (!outcome.delivered) error = outcome.error ?? error;
  }

  return { notified, confirmed, error };
}

const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * HMAC of the exact body, in a header the receiver can check with the same secret.
 * A failure is logged and swallowed — the response is already stored, and a
 * customer's endpoint being down is not the visitor's problem.
 */
async function deliverWebhook(
  url: string,
  secret: string | null,
  payload: Record<string, unknown>,
): Promise<'delivered' | 'failed'> {
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Yourbiss-Forms/1.0',
        ...(secret ? { 'x-yourbiss-signature': `v1=${createHmac('sha256', secret).update(body).digest('hex')}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return 'delivered';
  } catch (e) {
    console.error('[yourbiss] form webhook delivery failed', { url: url.slice(0, 120), error: e instanceof Error ? e.message : 'unknown' });
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

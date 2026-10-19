import { NextResponse, type NextRequest } from 'next/server';
import { findFormById } from '@/lib/forms/public';
import { checkAnswers, emailAnswerOf, unexpectedAnswerKeys } from '@/lib/forms/answers';
import { isFormClosed, orderedFields, visibleFields } from '@/lib/forms/definition';
import { readPrivates, storeResponse, SubmitRejected, visitorKey } from '@/lib/forms/intake';
import { clientKey, consume, rateHeaders } from '@/lib/rate-limit';
import { dateInZone } from '@/lib/utils';

/**
 * Where every public form posts to — the standalone page, the embed frame inside a
 * published site, and the newsletter block on a site.
 *
 * Nothing here trusts the request. The form is re-read from the database by id
 * rather than taking field definitions from the browser, answers for keys the form
 * does not define are refused outright, a field its conditional logic hides is
 * dropped before it is validated, and the row goes in through
 * `record_form_submission`, which is the only writer and applies the duplicate
 * guard under a lock.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

function bad(message: string, status = 400, fields?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message, fields: fields ?? {} }, { status });
}

/**
 * Same-origin only. A cross-site post always carries Origin, and the frame embed is
 * same-origin by construction, so an Origin that is present but foreign is a
 * forgery attempt and an absent one on a POST is a non-browser client.
 */
function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get('host')?.toLowerCase();
  if (!host) return false;
  const source = request.headers.get('origin') ?? request.headers.get('referer');
  if (!source) return false;
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return bad('This form can only be submitted from its own page.', 403);

  let payload: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return bad('That response is too large.', 413);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('Send the response as a JSON object.');
    payload = parsed as Record<string, unknown>;
  } catch {
    return bad('The request could not be read.');
  }

  const formId = typeof payload.form === 'string' ? payload.form : '';
  const limiter = await consume(`form:${formId}:${clientKey(request.headers)}`, 20, 60);
  if (!limiter.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many responses at once. Try again in a moment.' },
      { status: 429, headers: rateHeaders(limiter) },
    );
  }

  let form;
  try {
    form = await findFormById(formId);
  } catch (error) {
    // The visitor cannot do anything about a database failure, and the message
    // would only leak internals — log it here and answer with something usable.
    console.error('[yourbiss] form submit could not read the form', {
      form_id: formId.slice(0, 16),
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('Your response could not be recorded. Please try again.', 500);
  }

  if (!form) return bad('This form is not open for responses.', 404);
  if (isFormClosed(form.settings.close_at)) return bad('This form is closed to new responses.', 410);

  // A filled-in field no human can see. The bot says success so it does not learn
  // it was caught and start again with a different payload.
  const honeypot = typeof payload.company === 'string' ? payload.company.trim() : '';
  if (honeypot !== '') {
    return NextResponse.json({ ok: true, id: null, message: form.settings.success_message }, { status: 201 });
  }

  const answers = payload.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return bad('No answers were sent.');
  const answerRecord = answers as Record<string, unknown>;

  const stranger = unexpectedAnswerKeys(form.fields, answerRecord);
  if (stranger) return bad(stranger);

  const ordered = orderedFields(form.fields, form.settings.field_order);
  const check = checkAnswers(form.fields, form.settings.field_order, answerRecord, dateInZone(new Date(), form.timezone));
  if (Object.keys(check.errors).length > 0) {
    return bad('Some answers need another look.', 422, check.errors);
  }

  const shown = visibleFields(ordered, answerRecord).filter((field) => check.values[field.id] !== undefined);
  const submitterEmail = emailAnswerOf(check.values, check.emailFieldId);

  try {
    const stored = await storeResponse({
      form,
      fields: shown,
      privates: await readPrivates(form.id),
      values: check.values,
      submitterEmail,
      // The duplicate guard is the database's, under a row lock, and it only runs
      // when a key arrives — so "one per visitor" switches this off rather than
      // writing a second policy that could disagree with the first.
      visitorKey: form.settings.one_per_visitor ? visitorKey(clientKey(request.headers), form.id, request.nextUrl.host) : null,
      sourceUrl: typeof payload.source === 'string' ? payload.source.slice(0, 500) : null,
      userAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json(
      { ok: true, id: stored.id, message: form.settings.success_message, redirect: stored.redirect },
      { status: 201, headers: rateHeaders(limiter) },
    );
  } catch (error) {
    if (error instanceof SubmitRejected) return bad(error.message, 409);
    console.error('[yourbiss] form submit failed', {
      form_id: form.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return bad('Your response could not be recorded. Please try again.', 500);
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { findFormById } from '@/lib/forms/public';
import { isFormClosed } from '@/lib/forms/definition';
import { readPrivates, storeResponse, SubmitRejected, visitorKey } from '@/lib/forms/intake';
import { clientKey, consume } from '@/lib/rate-limit';
import { fieldIsVisible, isPresentational, type FormFieldDef } from '@/lib/forms/types';

/**
 * The endpoint the newsletter block in the website builder posts to.
 *
 * It is deliberately narrower than the form endpoint: one address, no answer
 * document, and the sign-up is filed into a real form the workspace owns, so a
 * subscriber list is the same table a owner can export from the Forms app rather
 * than a second place answers hide.
 *
 * Works without JavaScript — the block renders a plain `<form method=post>` — so a
 * browser is redirected back to the page it came from with the outcome in the URL.
 */

export const dynamic = 'force-dynamic';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function wantsJson(request: NextRequest): boolean {
  return request.headers.get('accept')?.includes('application/json') === true;
}

/**
 * Back to where the visitor came from, with the result in the address. The block's
 * own markup carries the workspace's success wording as a `:target` node keyed by
 * the block id it echoed back in `ret`, so the message appears without any script
 * deciding to show it and two sign-up blocks on one page cannot cross replies.
 */
function back(request: NextRequest, outcome: 'subscribed' | 'duplicate' | 'error', referer: string | null, ret: string): NextResponse {
  // Without a block id to aim at there is no target node on the page to light up,
  // so answer in the response body instead of redirecting somewhere silent.
  if (!referer || ret === '') {
    return wantsJson(request)
      ? NextResponse.json({ ok: outcome === 'subscribed', outcome }, { status: outcome === 'subscribed' ? 201 : 400 })
      : new NextResponse(plainPage(outcome), { status: outcome === 'subscribed' ? 201 : 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const url = new URL(referer);
  url.hash = `yourbiss-${ret}-${outcome}`;
  return NextResponse.redirect(url, { status: 303 });
}

/** Block ids are `[a-z0-9-]`; anything else is dropped rather than echoed into a URL. */
function safeRet(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
}

function plainPage(outcome: string): string {
  const message =
    outcome === 'subscribed' ? 'Thank you — your address has been recorded.' : outcome === 'duplicate' ? 'That address is already on the list.' : 'That address could not be recorded. Please try again.';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsletter</title><body style="font:16px/1.6 system-ui;padding:40px 20px;max-width:34rem;margin:0 auto">${message}</body></html>`;
}

async function readBody(request: NextRequest): Promise<{ form: string; email: string; honeypot: string; ret: string; referer: string | null }> {
  const referer = request.headers.get('referer');
  try {
    if (wantsJson(request)) {
      const payload = (await request.json()) as Record<string, unknown>;
      return {
        form: typeof payload.form === 'string' ? payload.form : '',
        email: typeof payload.email === 'string' ? payload.email.trim() : '',
        honeypot: typeof payload.company === 'string' ? payload.company : '',
        ret: typeof payload.ret === 'string' ? safeRet(payload.ret) : '',
        referer,
      };
    }
    const data = await request.formData();
    return {
      form: String(data.get('form') ?? ''),
      email: String(data.get('email') ?? '').trim(),
      honeypot: String(data.get('company') ?? ''),
      ret: safeRet(String(data.get('ret') ?? '')),
      referer,
    };
  } catch {
    return { form: '', email: '', honeypot: '', ret: '', referer };
  }
}

/**
 * The address is filed under whichever field asks for it, because the form the
 * workspace chose may call that question anything. Fields its own logic hides are
 * ignored, and the rest are sent empty, which is what `record_form_submission`
 * expects from a form that only ever asked for one thing.
 */
function answersFor(fields: FormFieldDef[], email: string): { values: Record<string, unknown>; emailFieldId: string | null } {
  const shown = fields.filter((field) => !isPresentational(field.type) && fieldIsVisible(field, {}));
  const emailField = shown.find((field) => field.type === 'email') ?? null;
  if (!emailField) return { values: {}, emailFieldId: null };
  return { values: { [emailField.id]: email }, emailFieldId: emailField.id };
}

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  // A referer that is present but from another site is a forged post; the block
  // always submits from the page it is on.
  if (body.referer) {
    try {
      if (new URL(body.referer).host.toLowerCase() !== host) return back(request, 'error', null, body.ret);
    } catch {
      return back(request, 'error', null, body.ret);
    }
  }

  const limiter = await consume(`newsletter:${body.form}:${clientKey(request.headers)}`, 10, 60);
  if (!limiter.allowed) return back(request, 'error', body.referer, body.ret);

  if (body.honeypot.trim() !== '') return back(request, 'subscribed', body.referer, body.ret);

  const email = body.email.slice(0, 320);
  if (!EMAIL.test(email)) return back(request, 'error', body.referer, body.ret);

  let form;
  try {
    form = await findFormById(body.form);
  } catch (error) {
    console.error('[yourbiss] newsletter sign-up could not read the form', {
      form_id: body.form.slice(0, 16),
      error: error instanceof Error ? error.message : String(error),
    });
    return back(request, 'error', body.referer, body.ret);
  }

  if (!form || isFormClosed(form.settings.close_at)) return back(request, 'error', body.referer, body.ret);

  const { values, emailFieldId } = answersFor(form.fields, email);
  if (!emailFieldId) {
    // The workspace pointed the block at a form with no email question, so there is
    // nowhere honest to put the address. Say so in the log rather than dropping it.
    console.error('[yourbiss] newsletter block points at a form with no email field', { form_id: form.id, form_title: form.title });
    return back(request, 'error', body.referer, body.ret);
  }

  try {
    await storeResponse({
      form,
      fields: form.fields.filter((field) => field.id === emailFieldId),
      privates: await readPrivates(form.id),
      values,
      submitterEmail: email.toLowerCase(),
      visitorKey: form.settings.one_per_visitor ? visitorKey(clientKey(request.headers), form.id, host) : null,
      sourceUrl: body.referer ? body.referer.slice(0, 500) : null,
      userAgent: request.headers.get('user-agent'),
    });
    return back(request, 'subscribed', body.referer, body.ret);
  } catch (error) {
    if (error instanceof SubmitRejected) {
      // Already on the list is not a failure a subscriber should be warned about.
      return back(request, error.duplicate ? 'duplicate' : 'error', body.referer, body.ret);
    }
    console.error('[yourbiss] newsletter sign-up failed', { form_id: form.id, error: error instanceof Error ? error.message : String(error) });
    return back(request, 'error', body.referer, body.ret);
  }
}

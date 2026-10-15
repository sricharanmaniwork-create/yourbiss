import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { consume, clientKey } from '@/lib/rate-limit';
import { EMAIL_RE, authRedirect, readRaw, readString, safeNext } from '@/lib/auth-common';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const form = (await request.formData().catch(() => new FormData())) as FormData;
  const email = readString(form, 'email', 200).toLowerCase();
  const password = readRaw(form, 'password', 200);
  const requestedNext = request.nextUrl.searchParams.get('next');
  const next = safeNext(requestedNext);

  if (!EMAIL_RE.test(email) || password.length < 8) {
    return authRedirect(request, '/login', { error: 'invalid' });
  }

  // Bucketed per IP *and* account, so neither a spray across accounts nor a
  // grind on one account gets the whole allowance.
  const limit = await consume(`login:${clientKey(request.headers)}:${email}`, 8, 300);
  if (!limit.allowed) {
    return authRedirect(request, '/login', { error: 'throttled', next: requestedNext ?? '' });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // One message for unknown account and wrong password, so the form cannot be
    // used to enumerate which emails are registered.
    return authRedirect(request, '/login', { error: 'bad_credentials', next: requestedNext ?? '' });
  }

  return NextResponse.redirect(new URL(next, request.url), { status: 302 });
}

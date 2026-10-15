import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { NEXT_COOKIE, authRedirect, nextCookieOptions, safeNext } from '@/lib/auth-common';

export const runtime = 'nodejs';

/**
 * Single landing point for every Supabase auth redirect: PKCE code exchange
 * (email confirmation, magic link, OAuth). The `next` target cannot ride in the
 * query string because Supabase owns this URL, so the OAuth starter parks it in
 * a short-lived cookie and it is consumed and cleared here.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.cookies.get(NEXT_COOKIE)?.value);

  if (!code) return authRedirect(request, '/login', { error: 'missing_code' });

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return authRedirect(request, '/login', { error: 'expired_link' });

  const response = NextResponse.redirect(new URL(next, request.url), { status: 302 });
  response.cookies.set(NEXT_COOKIE, '', { ...nextCookieOptions(), maxAge: 0 });
  return response;
}

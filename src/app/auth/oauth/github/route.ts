import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';
import { NEXT_COOKIE, authRedirect, nextCookieOptions, safeNext } from '@/lib/auth-common';

export const runtime = 'nodejs';

/**
 * GitHub is the only provider wired up. The secret lives in Supabase's OAuth
 * app settings, never here — this route just asks Supabase for the redirect.
 */
export async function GET(request: NextRequest) {
  if (!env.GITHUB_CLIENT_ID) return authRedirect(request, '/login', { error: 'oauth_unconfigured' });

  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: new URL('/auth/callback', request.url).toString(), scopes: 'read:user user:email' },
  });

  if (error || !data.url) return authRedirect(request, '/login', { error: 'oauth_failed' });

  const response = NextResponse.redirect(data.url, { status: 302 });
  response.cookies.set(NEXT_COOKIE, next, nextCookieOptions());
  return response;
}

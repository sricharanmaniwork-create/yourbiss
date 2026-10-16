import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { clientKey, consume } from '@/lib/rate-limit';
import { EMAIL_RE, NEXT_COOKIE, authRedirect, nextCookieOptions, readString } from '@/lib/auth-common';

export const runtime = 'nodejs';

/**
 * Starts a password reset.
 *
 * Supabase sends the link, and it goes out over whichever SMTP sender the project is
 * configured with — the Resend relay, per the deployment notes — because only the auth
 * server can mint a recovery token that `verifyOtp` will accept. What this route controls is
 * where the link lands: `/auth/callback` exchanges it for a session and then follows the
 * hand-off cookie, exactly as the OAuth starter does, so the visitor ends up on the
 * new-password form instead of the dashboard.
 *
 * The answer is the same whether or not the address is registered. An error for unknown
 * emails would turn this form into a directory of who has a Yourbiss account.
 */
export async function POST(request: NextRequest) {
  const form = (await request.formData().catch(() => new FormData())) as FormData;
  const email = readString(form, 'email', 200).toLowerCase();

  if (!EMAIL_RE.test(email)) return authRedirect(request, '/forgot-password', { error: 'email' });

  // Per address and per IP: a reset request is a mail send, and a mail send is the one thing
  // an attacker can make this deployment spend on someone else's behalf.
  const limit = await consume(`reset:${clientKey(request.headers)}:${email}`, 5, 3600);
  if (!limit.allowed) return authRedirect(request, '/forgot-password', { error: 'throttled' });

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('/auth/callback', request.url).toString(),
  });
  if (error) {
    // GoTrue throttles this endpoint per email on its own; its message is the same news the
    // form already gives, and anything else is a server fault we should not describe in detail.
    return authRedirect(request, '/forgot-password', {
      error: /rate limit|too many/i.test(error.message) ? 'throttled' : 'server',
    });
  }

  // Longer than the OAuth hand-off: a reset link is often opened from another device, minutes
  // after it was asked for. If it lapses, the callback simply lands on the dashboard, and an
  // unauthenticated visitor is bounced back to sign-in by the proxy.
  const response = authRedirect(request, '/forgot-password', { notice: 'sent' });
  response.cookies.set(NEXT_COOKIE, '/reset-password', { ...nextCookieOptions(), maxAge: 3600 });
  return response;
}

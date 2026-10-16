import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { authRedirect, readRaw, weakPassword } from '@/lib/auth-common';

export const runtime = 'nodejs';

/**
 * Writes the password a recovery link came to set.
 *
 * The session is the proof: `/auth/callback` exchanged the link's code for it, and this route
 * asks the auth server — not the cookie — whether one exists. So there is no token to guess,
 * no email to match and nothing in the request that says whose password is changing.
 *
 * A signed-in person who reaches this page by typing the address is in the same position as
 * one who followed a link: they may set their own password, which is not a privilege this
 * route has to defend against itself.
 */
export async function POST(request: NextRequest) {
  const form = (await request.formData().catch(() => new FormData())) as FormData;
  const password = readRaw(form, 'password', 200);
  const confirmation = readRaw(form, 'confirm_password', 200);

  if (weakPassword(password)) return authRedirect(request, '/reset-password', { error: 'password' });
  if (password !== confirmation) return authRedirect(request, '/reset-password', { error: 'mismatch' });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return authRedirect(request, '/login', { error: 'expired_link' });

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return authRedirect(request, '/reset-password', { error: 'server' });

  return NextResponse.redirect(new URL('/app', request.url), { status: 302 });
}

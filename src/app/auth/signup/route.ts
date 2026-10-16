import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { consume, clientKey } from '@/lib/rate-limit';
import { EMAIL_RE, authRedirect, readRaw, readString, weakPassword } from '@/lib/auth-common';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const form = (await request.formData().catch(() => new FormData())) as FormData;
  const displayName = readString(form, 'display_name', 80);
  const email = readString(form, 'email', 200).toLowerCase();
  const password = readRaw(form, 'password', 200);

  if (displayName.length < 2) return authRedirect(request, '/signup', { error: 'name' });
  if (!EMAIL_RE.test(email)) return authRedirect(request, '/signup', { error: 'email' });
  // A password of one repeated character passes a length check and nothing else.
  if (weakPassword(password)) return authRedirect(request, '/signup', { error: 'password' });

  const limit = await consume(`signup:${clientKey(request.headers)}`, 10, 3600);
  if (!limit.allowed) return authRedirect(request, '/signup', { error: 'throttled' });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: new URL('/auth/callback', request.url).toString(),
    },
  });

  if (error) {
    // Supabase says "User already registered" — which is an account-enumeration
    // leak in the form of an error page. Say the neutral thing instead.
    if (/already registered|already exists/i.test(error.message)) {
      return authRedirect(request, '/login', { notice: 'no_account' });
    }
    return authRedirect(request, '/signup', { error: 'server' });
  }

  // `youbiss_on_auth_user_created` seeds the profile, workspace and app rows,
  // so a session here means the account is immediately usable.
  if (data.session) return NextResponse.redirect(new URL('/app', request.url), { status: 302 });
  return authRedirect(request, '/login', { notice: 'confirm' });
}

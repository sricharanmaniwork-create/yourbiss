import { NextResponse } from 'next/server';

/** Cookie hand-off for OAuth, where Supabase owns the final redirect URL. */
export const NEXT_COOKIE = 'youbiss_next';

/**
 * Only same-origin, non-protocol paths survive. Without this, `?next=` would be
 * a free open redirect to any site the attacker names.
 */
export function safeNext(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw) return fallback;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value.includes('\\') || value.includes('://') || value.includes('\n') || value.includes('\r')) return fallback;
  if (value === '/login' || value === '/signup' || value.startsWith('/auth/')) return fallback;
  return value.slice(0, 500);
}

export function nextCookieOptions() {
  return { path: '/', maxAge: 600, sameSite: 'lax' as const, httpOnly: true };
}

/**
 * Auth routes answer a form post with a redirect. Errors travel as a code the
 * page maps to fixed copy, so nothing an attacker typed is reflected back.
 */
export function authRedirect(
  request: Request,
  path: string,
  params: { notice?: string; error?: string; next?: string },
) {
  const url = new URL(path, requestUrl(request));
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, { status: 302 });
}

function requestUrl(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function readString(form: FormData, key: string, max = 200): string {
  const value = form.get(key);
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** Passwords keep their characters verbatim — trimming would break logins. */
export function readRaw(form: FormData, key: string, max = 200): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.slice(0, max) : '';
}

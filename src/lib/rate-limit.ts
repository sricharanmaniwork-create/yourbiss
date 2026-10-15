import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Serverless functions cannot share an in-process counter, and one burst of form
 * submits is spread over several lambdas. The window therefore lives in Postgres
 * (see youbiss.rate_limit_consume), so the limit is actually a limit.
 */
export interface RateResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

const EMPTY: RateResult = { allowed: true, remaining: 100, retryAfterSec: 0 };

export async function consume(
  bucket: string,
  max: number,
  windowSec: number,
): Promise<RateResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('rate_limit_consume', {
    p_bucket: bucket.slice(0, 200),
    p_max: max,
    p_window_sec: windowSec,
  });

  if (error) {
    // Fail open on a transport error but log it: a database hiccup should not
    // stop a customer booking a slot, and the routes do their own validation.
    console.error('[rate-limit] consume failed', error.message);
    return EMPTY;
  }

  const row = (data as Record<string, unknown>[] | Record<string, unknown> | null);
  const first = Array.isArray(row) ? row[0] : row;
  if (!first) return EMPTY;

  return {
    allowed: Boolean(first.allowed),
    remaining: Number(first.remaining ?? 0),
    retryAfterSec: Number(first.retry_after_sec ?? 0),
  };
}

/** Best-effort visitor identity for a bucket key. Never the raw IP. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  const basis = first || headers.get('x-real-ip') || headers.get('user-agent') || 'unknown';
  return basis.replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, 64);
}

export function rateHeaders(result: RateResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.remaining),
    'X-RateLimit-Remaining': String(result.remaining),
    'Retry-After': String(result.retryAfterSec),
  };
}

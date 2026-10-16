import { headers } from 'next/headers';
import { optionalEnv } from '@/lib/env';

/**
 * The origin to put inside a link a user is about to copy out of the app.
 *
 * A relative path is useless once the link leaves the browser, so a share screen
 * needs an absolute address. Taking it from the request rather than from
 * `NEXT_PUBLIC_SITE_URL` means a preview deployment, a custom domain and a dev
 * server on an odd port all share a link that actually opens — the user is
 * looking at the deployment they are copying from.
 *
 * `Host` is client-supplied, so it is matched against a plain hostname-plus-port
 * shape before it is trusted and the protocol comes from the proxy's forwarded
 * header rather than anything in the value itself. A malformed host falls back to
 * `NEXT_PUBLIC_SITE_URL`, which is also the value to set when a deployment should
 * share one canonical address whatever host it is reached on.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? '';
  if (!/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(host)) return configuredOrigin();

  const forwarded = (h.get('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase();
  const secure =
    forwarded === 'https' ? true : forwarded === 'http' ? false : !isLocalHost(host);
  return `${secure ? 'https' : 'http'}://${host}`;
}

/** The configured public URL, for anything that has no request to learn from. */
function configuredOrigin(): string {
  const value = optionalEnv('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000';
  try {
    return new URL(value).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

function isLocalHost(host: string): boolean {
  const name = host.split(':')[0] ?? '';
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name.endsWith('.localhost');
}

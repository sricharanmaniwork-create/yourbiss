import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { OrgRole } from '@/lib/types';

/**
 * The client flavour that carries a member's session. `createServerClient` from
 * @supabase/ssr returns this shape; naming it here lets the assert helpers accept
 * it without depending on the generated Database types, which do not exist yet.
 */
/**
 * The clients are deliberately loose until `supabase gen types` runs against a
 * real project — the schema is created by migrations the developer applies by
 * hand, so there is no generated Database type to import yet. Every read still
 * narrows the row at the point of use.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SessionClient = SupabaseClient<any, 'public', 'public', any, any>;

/**
 * Service-role client. It bypasses Row Level Security, so it exists for exactly
 * two reasons: the public endpoints that must read published content for an
 * anonymous visitor, and the write paths that must be validated by application
 * code before a row appears (form submits, bookings, mail sends).
 *
 * Never hand this client to a component, and never use it where `createClient()`
 * would work — an authorisation check done here is a check RLS would have done
 * for free.
 */
export function createAdminClient() {
  if (!env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_SECRET_KEY is not configured');
  }
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export class AuthorizationError extends Error {
  constructor(message = 'You do not have access to this workspace') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Asserts the signed-in user belongs to `orgId`, using the *user's own* session
 * rather than the admin client, so the check is RLS and not a hand-written
 * comparison we could forget. Throws for anonymous callers.
 */
export async function assertMembership(userClient: SessionClient, orgId: string) {
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) throw new AuthorizationError('Not signed in');

  const { data, error } = await userClient
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  // The clients are intentionally untyped (no generated Database type yet), so
  // the row shape is asserted here — the one place this query is read.
  const membership = data as unknown as { role: OrgRole } | null;
  if (!membership) throw new AuthorizationError();
  return { userId: user.id, role: membership.role };
}

export async function assertAdmin(userClient: SessionClient, orgId: string) {
  const membership = await assertMembership(userClient, orgId);
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    throw new AuthorizationError('This action needs the owner or an admin');
  }
  return membership;
}

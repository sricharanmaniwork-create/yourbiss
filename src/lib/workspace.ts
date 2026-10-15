import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { AuthorizationError } from '@/lib/supabase/admin';
import type { AppKey, Org, OrgRole, UserProfile, WorkspaceContext } from '@/lib/types';

export const APP_KEYS: AppKey[] = [
  'website',
  'forms',
  'bookings',
  'crm',
  'inventory',
  'store',
  'automations',
  'board',
];

/** Cookie that remembers which workspace the member was last looking at. */
const ORG_COOKIE = 'youbiss_org';
const MAX_AGE = 60 * 60 * 24 * 365;

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  role: OrgRole;
}

export interface Session {
  user: { id: string; email: string };
  profile: UserProfile | null;
  workspaces: WorkspaceSummary[];
}

/**
 * Everything the shell needs about who is looking at it. Memoised with `cache`
 * so a layout, a page and a server action in the same request share one round
 * of queries instead of three.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS on org_members means this only returns workspaces the user belongs to.
  const [membersResult, profileResult] = await Promise.all([
    supabase
      .from('orgs')
      .select('id, name, slug, logo_url, org_members!inner(role)')
      .eq('org_members.user_id', user.id)
      .neq('status', 'archived')
      .order('created_at', { ascending: true }),
    supabase.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  if (membersResult.error) throw new Error(membersResult.error.message);

  const workspaces: WorkspaceSummary[] = (membersResult.data ?? [])
    .map((row) => {
      const r = row as unknown as {
        id: string;
        name: string;
        slug: string;
        logo_url: string | null;
        org_members: { role: OrgRole } | { role: OrgRole }[] | null;
      };
      const membership = Array.isArray(r.org_members) ? r.org_members[0] : r.org_members;
      return { id: r.id, name: r.name, slug: r.slug, logo_url: r.logo_url, role: membership?.role ?? 'member' };
    })
    .filter((w) => w.id);

  return {
    user: { id: user.id, email: user.email ?? '' },
    profile: (profileResult.data as unknown as UserProfile | null) ?? null,
    workspaces,
  };
});

/**
 * Resolves the active workspace and whether each module is switched on for it.
 * A member who was pointing at a workspace they have since left falls back to
 * their first one rather than erroring.
 */
export const getWorkspace = cache(async (): Promise<WorkspaceContext | null> => {
  const session = await getSession();
  if (!session || session.workspaces.length === 0) return null;

  const requested = (await cookies()).get(ORG_COOKIE)?.value;
  const org =
    session.workspaces.find((w) => w.id === requested) ?? session.workspaces[0]!;

  const supabase = await createClient();
  const [orgResult, appsResult] = await Promise.all([
    supabase.from('orgs').select('*').eq('id', org.id).maybeSingle(),
    supabase.from('org_apps').select('app_key, status').eq('org_id', org.id),
  ]);
  if (orgResult.error) throw new Error(orgResult.error.message);
  if (!orgResult.data) return null;

  const apps = Object.fromEntries(APP_KEYS.map((key) => [key, false])) as Record<AppKey, boolean>;
  for (const row of (appsResult.data ?? []) as unknown as { app_key: AppKey; status: string }[]) {
    if (row.app_key in apps) apps[row.app_key] = row.status === 'enabled';
  }

  return {
    org: orgResult.data as unknown as Org,
    role: org.role,
    userId: session.user.id,
    apps,
  };
});

/** For pages that cannot render without a workspace. */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const workspace = await getWorkspace();
  if (!workspace) throw new AuthorizationError('No workspace is available for this account');
  return workspace;
}

export async function requireAdmin(): Promise<WorkspaceContext> {
  const workspace = await requireWorkspace();
  if (workspace.role !== 'owner' && workspace.role !== 'admin') {
    throw new AuthorizationError('This page needs the owner or an admin');
  }
  return workspace;
}

export function activeOrgCookieValue(orgId: string) {
  return { name: ORG_COOKIE, value: orgId, options: { path: '/', maxAge: MAX_AGE, sameSite: 'lax' as const } };
}

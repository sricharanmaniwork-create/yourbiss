'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSession } from '@/lib/workspace';
import { isValidSlug, slugify } from '@/lib/utils';

const ORG_COOKIE = 'youbiss_org';

export async function switchWorkspace(orgId: string): Promise<void> {
  const session = await getSession();
  const target = session?.workspaces.find((w) => w.id === orgId);
  // Without this the cookie would let a member claim a workspace they are not in.
  if (!target) throw new Error('That workspace is not one of yours');

  const store = await cookies();
  store.set(ORG_COOKIE, target.id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/app', 'layout');
}

export interface CreateWorkspaceResult {
  ok: true;
  orgId: string;
}

/**
 * `orgs` has no authenticated INSERT on purpose — a member must never be able to
 * write themselves into a workspace — so a new one is created with the service
 * role after the user's own session has been verified.
 */
export async function createWorkspace(input: { name: string }): Promise<CreateWorkspaceResult> {
  const session = await getSession();
  if (!session) throw new Error('Sign in first');

  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) throw new Error('Give the workspace a name of at least two characters');

  const base = slugify(name, 'workspace');
  if (!isValidSlug(base)) throw new Error('That name cannot be turned into a web address');

  const admin = createAdminClient();

  // The slug is unique across every tenant and becomes part of a public URL,
  // so walk a suffix until one is free.
  let slug = base;
  for (let attempt = 1; attempt <= 30; attempt++) {
    const { data, error } = await admin.from('orgs').select('id').eq('slug', slug).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) break;
    if (attempt === 30) throw new Error('Could not find a free web address for that name');
    slug = `${base}-${attempt + 1}`;
  }

  const { data: org, error } = await admin
    .from('orgs')
    .insert({ name, slug, owner_id: session.user.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  if (!org) throw new Error('The workspace could not be created');

  const { error: memberError } = await admin
    .from('org_members')
    .insert({ org_id: org.id, user_id: session.user.id, role: 'owner' });
  if (memberError) throw new Error(memberError.message);

  // Mirror what the onboarding trigger seeds for a brand-new account, but only
  // the three modules this build actually has screens for.
  const { error: appsError } = await admin.from('org_apps').insert([
    { org_id: org.id, app_key: 'website' },
    { org_id: org.id, app_key: 'forms' },
    { org_id: org.id, app_key: 'bookings' },
  ]);
  if (appsError) throw new Error(appsError.message);

  const store = await cookies();
  store.set(ORG_COOKIE, org.id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });

  revalidatePath('/app', 'layout');
  return { ok: true, orgId: org.id };
}

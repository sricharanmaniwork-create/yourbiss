'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, createAdminClient } from '@/lib/supabase/admin';
import { encryptSecret } from '@/lib/crypto';
import { optionalEnv } from '@/lib/env';
import { verifySmtp } from '@/lib/mail';
import { inviteMail, mailBase } from '@/lib/mail/templates';
import { logActivity } from '@/lib/actions/activity';
import { isValidSlug } from '@/lib/utils';
import { isKnownTimeZone } from '@/lib/timezones';
import { APP_KEYS } from '@/lib/workspace';
import type { AppKey, ActionState, OrgRole } from '@/lib/types';

/**
 * Every action here re-checks admin-ness through the member's own session, so
 * RLS decides authorisation instead of a role string read from a cookie.
 */

const orgSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(1, 'The workspace needs a name').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Use at least two characters')
    .max(60)
    .refine((v) => /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(v), 'Use letters, numbers and single dashes')
    .refine((v) => isValidSlug(v), 'That address is reserved'),
  timezone: z.string().max(64).refine(isKnownTimeZone, 'Choose one of the listed time zones'),
  currency: z.string().length(3).refine((v) => /^[A-Z]{3}$/.test(v), 'Use a three-letter code like INR'),
  locale: z.string().max(10).regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Like en-IN or en-US'),
  logo_url: z.union([z.literal(''), z.string().url()]).optional(),
});

function fieldErrorsFrom(issueList: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issueList) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function updateWorkspace(input: z.input<typeof orgSchema>): Promise<ActionState> {
  const parsed = orgSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrorsFrom(parsed.error.issues) };

  const orgId = parsed.data.orgId;
  const supabase = await createClient();
  const admin = await assertAdmin(supabase, orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'You need to be an admin of this workspace' };

  const { data: current } = await supabase.from('orgs').select('slug').eq('id', orgId).maybeSingle();
  const currentSlug = (current as unknown as { slug: string } | null)?.slug;
  const slugChanged = currentSlug !== parsed.data.slug;

  if (slugChanged) {
    // citext means the unique index is already case-insensitive, but checking
    // through the user's client proves RLS sees the row before we try the write.
    const { data: clash } = await supabase.from('orgs').select('id').eq('slug', parsed.data.slug).maybeSingle();
    if (clash) return { ok: false, error: 'That web address is taken by another workspace', fields: { slug: 'Already in use' } };
  }

  const { error } = await supabase
    .from('orgs')
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
      locale: parsed.data.locale,
      logo_url: parsed.data.logo_url?.trim() ? parsed.data.logo_url.trim() : null,
    })
    .eq('id', orgId);

  if (error) {
    if (/duplicate/i.test(error.message)) return { ok: false, error: 'That web address is taken', fields: { slug: 'Already in use' } };
    return { ok: false, error: error.message };
  }

  if (slugChanged) {
    await logActivity(supabase, {
      orgId,
      actorId: admin.userId,
      entityType: 'org',
      entityId: orgId,
      action: 'org.slug_changed',
      summary: `Web address changed to /${parsed.data.slug}`,
    });
  }

  revalidatePath('/app', 'layout');
  revalidatePath('/app/settings');
  return { ok: true };
}

export async function setAppEnabled(orgId: string, appKey: AppKey, enabled: boolean): Promise<ActionState> {
  if (!APP_KEYS.includes(appKey)) return { ok: false, error: 'Unknown app' };

  const supabase = await createClient();
  const { role } = await assertAdmin(supabase, orgId).catch(() => ({ role: null }));
  if (!role) return { ok: false, error: 'Only the owner or an admin can change which apps are on' };

  // Upsert so an app row missing from an older workspace appears rather than
  // silently doing nothing.
  const { error } = await supabase
    .from('org_apps')
    .upsert({ org_id: orgId, app_key: appKey, status: enabled ? 'enabled' : 'disabled' }, { onConflict: 'org_id,app_key' });

  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId,
    actorId: (await supabase.auth.getUser()).data.user?.id ?? '',
    appKey,
    entityType: 'org',
    entityId: orgId,
    action: enabled ? 'app_enabled' : 'app_disabled',
    summary: `${appKey} ${enabled ? 'switched on' : 'switched off'}`,
  });

  revalidatePath('/app', 'layout');
  revalidatePath('/app/settings/apps');
  return { ok: true };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('That is not an email address').max(200),
  role: z.enum(['admin', 'member']),
});

export async function inviteMember(orgId: string, input: z.input<typeof inviteSchema>): Promise<ActionState> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the invite details', fields: fieldErrorsFrom(parsed.error.issues) };

  const supabase = await createClient();
  const admin = await assertAdmin(supabase, orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'Only the owner or an admin can invite people' };

  const { data: org } = await supabase.from('orgs').select('name, slug').eq('id', orgId).maybeSingle();
  const orgRow = org as unknown as { name: string; slug: string } | null;
  if (!orgRow) return { ok: false, error: 'Workspace not found' };

  // Already a member? Their email lives on user_profiles, readable for teammates.
  const { data: existingProfile } = await supabase.from('user_profiles').select('user_id').eq('email', parsed.data.email).maybeSingle();
  if (existingProfile) {
    const userId = (existingProfile as unknown as { user_id: string }).user_id;
    const { data: existingMember } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existingMember) return { ok: false, error: 'That person is already in this workspace', fields: { email: 'Already a member' } };
  }

  const { error: inviteError } = await supabase.from('org_invites').upsert(
    {
      org_id: orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: admin.userId,
      accepted_at: null,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
    { onConflict: 'org_id,email' },
  );
  if (inviteError) return { ok: false, error: inviteError.message };

  const { data: inviteRow } = await supabase
    .from('org_invites')
    .select('token')
    .eq('org_id', orgId)
    .eq('email', parsed.data.email)
    .maybeSingle();
  const token = (inviteRow as unknown as { token: string } | null)?.token;

  await logActivity(supabase, {
    orgId,
    actorId: admin.userId,
    entityType: 'org',
    entityId: orgId,
    action: 'member_invited',
    summary: `Invited ${parsed.data.email} as ${parsed.data.role}`,
  });

  if (token) {
    // Best-effort: the invite row is valid whether or not the mail lands, and the
    // admin can copy the link straight from the members table.
    const { data: inviterData } = await supabase
      .from('user_profiles')
      .select('display_name')
      .eq('user_id', admin.userId)
      .maybeSingle();
    const inviterName =
      (inviterData as unknown as { display_name: string } | null)?.display_name || 'A teammate';

    const { sendMail } = await import('@/lib/mail');
    await sendMail({
      orgId,
      to: parsed.data.email,
      template: 'invite',
      mail: inviteMail(mailBase(orgRow.name), {
        inviterName,
        orgName: orgRow.name,
        role: parsed.data.role,
        acceptUrl: new URL(`/invite/${token}`, optionalEnv('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000').toString(),
      }),
    });
  }

  revalidatePath('/app/settings/members');
  return { ok: true };
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<ActionState> {
  const supabase = await createClient();
  const admin = await assertAdmin(supabase, orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'Only the owner or an admin can revoke an invite' };

  const { error } = await supabase.from('org_invites').delete().eq('org_id', orgId).eq('id', inviteId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/app/settings/members');
  return { ok: true };
}

export async function changeMemberRole(orgId: string, userId: string, role: Exclude<OrgRole, 'owner'>): Promise<ActionState> {
  const supabase = await createClient();
  const admin = await assertAdmin(supabase, orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'Only the owner or an admin can change roles' };
  if (userId === admin.userId) return { ok: false, error: 'You cannot change your own role' };

  const { error } = await supabase.from('org_members').update({ role }).eq('org_id', orgId).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId,
    actorId: admin.userId,
    entityType: 'org',
    entityId: orgId,
    action: 'member_role_changed',
    summary: `Role set to ${role}`,
  });
  revalidatePath('/app/settings/members');
  return { ok: true };
}

export async function removeMember(orgId: string, userId: string): Promise<ActionState> {
  const supabase = await createClient();
  const admin = await assertAdmin(supabase, orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'Only the owner or an admin can remove a member' };
  if (userId === admin.userId) return { ok: false, error: 'Leave the workspace from your own profile instead' };

  const { error } = await supabase.from('org_members').delete().eq('org_id', orgId).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    orgId,
    actorId: admin.userId,
    entityType: 'org',
    entityId: orgId,
    action: 'member_removed',
    summary: 'A member was removed from the workspace',
  });
  revalidatePath('/app/settings/members');
  return { ok: true };
}

export async function leaveWorkspace(orgId: string): Promise<ActionState> {
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return { ok: false, error: 'Sign in again and try once more' };

  // `members_self_leave` is what actually authorises this; the read is only to
  // produce a helpful message when the row is a role that may not leave.
  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', me.user.id)
    .maybeSingle();
  if (!membership) return { ok: false, error: 'You are not a member of that workspace' };
  if ((membership as unknown as { role: OrgRole }).role === 'owner') {
    return { ok: false, error: 'The owner cannot leave. Transfer ownership or archive the workspace instead.' };
  }

  const { error } = await supabase.from('org_members').delete().eq('org_id', orgId).eq('user_id', me.user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app', 'layout');
  return { ok: true };
}

const profileSchema = z.object({
  display_name: z.string().trim().min(1, 'Your name cannot be empty').max(80),
  job_title: z.string().trim().max(80).optional(),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+0-9 ()-]*$/, 'Digits, spaces, brackets, + and - only')
    .optional(),
});

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionState> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrorsFrom(parsed.error.issues) };

  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return { ok: false, error: 'Sign in again and try once more' };

  const { error } = await supabase
    .from('user_profiles')
    .update({
      display_name: parsed.data.display_name,
      job_title: parsed.data.job_title?.trim() || null,
      phone: parsed.data.phone?.trim() || null,
    })
    .eq('user_id', me.user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/app', 'layout');
  return { ok: true };
}

/**
 * `org_email_settings.provider` and every counter column are reverted by a
 * trigger for any non-service role, and `org_email_passwords` grants nothing to
 * `authenticated`. Both are deliberate: the password never leaves the server.
 * So the write is done with the service role after RLS has confirmed admin-ness.
 */
const emailSchema = z.object({
  orgId: z.string().uuid(),
  provider: z.enum(['smtp', 'resend']),
  from_address: z.string().trim().toLowerCase().email('The from address must be a valid email').max(200),
  from_name: z.string().trim().min(1, 'Give the sender a name').max(80),
  reply_to: z
    .union([z.literal(''), z.string().trim().toLowerCase().email('Reply-to must be a valid email').max(200)])
    .optional(),
  smtp_host: z.string().trim().max(253).regex(/^[a-zA-Z0-9.\-]*$/, 'Host names use letters, digits, dots and dashes').optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
  smtp_secure: z.enum(['none', 'ssl', 'starttls']),
  smtp_user: z.string().trim().max(200).optional(),
  daily_quota: z.coerce.number().int().min(1).max(100000).default(100),
  password: z.string().max(400).optional(),
});

export async function saveEmailSettings(input: z.input<typeof emailSchema>): Promise<ActionState> {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrorsFrom(parsed.error.issues) };

  const userClient = await createClient();
  const admin = await assertAdmin(userClient, parsed.data.orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'Only the owner or an admin can change email settings' };

  const wantsSmtp = parsed.data.provider === 'smtp';
  if (wantsSmtp) {
    if (!parsed.data.smtp_host || !parsed.data.smtp_port || !parsed.data.smtp_user) {
      return { ok: false, error: 'A SMTP host, port and username are all required', fields: { smtp_host: 'Required' } };
    }
    const hasExisting = await hasStoredPassword(parsed.data.orgId);
    if (!parsed.data.password && !hasExisting) {
      return { ok: false, error: 'Enter the SMTP password — it is only stored once', fields: { password: 'Required' } };
    }
  }

  const adminClient = createAdminClient();
  const payload = {
    org_id: parsed.data.orgId,
    provider: parsed.data.provider,
    from_address: parsed.data.from_address,
    from_name: parsed.data.from_name,
    reply_to: parsed.data.reply_to?.trim() || null,
    smtp_host: wantsSmtp ? parsed.data.smtp_host : null,
    smtp_port: wantsSmtp ? parsed.data.smtp_port : null,
    smtp_secure: parsed.data.smtp_secure,
    smtp_user: wantsSmtp ? parsed.data.smtp_user : null,
    daily_quota: parsed.data.daily_quota,
  };

  const { error } = await adminClient.from('org_email_settings').upsert(payload, { onConflict: 'org_id' });
  if (error) return { ok: false, error: error.message };

  if (wantsSmtp && parsed.data.password) {
    const { error: secretError } = await adminClient.from('org_email_passwords').upsert(
      { org_id: parsed.data.orgId, ciphertext: encryptSecret(parsed.data.password) },
      { onConflict: 'org_id' },
    );
    if (secretError) return { ok: false, error: 'Settings saved, but the password could not be stored' };
  }

  await logActivity(userClient, {
    orgId: parsed.data.orgId,
    actorId: admin.userId,
    entityType: 'org',
    entityId: parsed.data.orgId,
    action: 'email_settings_updated',
    summary: `Mail sending set to ${wantsSmtp ? parsed.data.smtp_host : 'Resend'}`,
  });

  revalidatePath('/app/settings/email');
  return { ok: true };
}

async function hasStoredPassword(orgId: string): Promise<boolean> {
  const adminClient = createAdminClient();
  const { data } = await adminClient.from('org_email_passwords').select('org_id').eq('org_id', orgId).maybeSingle();
  return Boolean(data);
}

export async function testEmailConnection(orgId: string, to: string): Promise<ActionState> {
  const trimmed = to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return { ok: false, error: 'Enter the address to test against' };

  const userClient = await createClient();
  const admin = await assertAdmin(userClient, orgId).catch(() => null);
  if (!admin) return { ok: false, error: 'Only the owner or an admin can test the connection' };

  const adminClient = createAdminClient();
  const { data: settingsData } = await adminClient.from('org_email_settings').select('*').eq('org_id', orgId).maybeSingle();
  const settings = settingsData as unknown as
    | { provider: 'resend' | 'smtp'; from_address: string; from_name: string; smtp_host: string | null; smtp_port: number | null; smtp_secure: string; smtp_user: string | null }
    | null;
  if (!settings) return { ok: false, error: 'Save the settings before testing them' };

  let outcome: { ok: boolean; error?: string };

  if (settings.provider === 'smtp') {
    if (!settings.smtp_host || !settings.smtp_port || !settings.smtp_user) {
      return { ok: false, error: 'A host, port and username are needed first' };
    }
    const { data: secretData } = await adminClient.from('org_email_passwords').select('ciphertext').eq('org_id', orgId).maybeSingle();
    const ciphertext = (secretData as unknown as { ciphertext: string } | null)?.ciphertext;
    if (!ciphertext) return { ok: false, error: 'Re-enter the SMTP password and save before testing' };
    const { decryptSecret } = await import('@/lib/crypto');
    outcome = await verifySmtp({
      host: settings.smtp_host,
      port: settings.smtp_port,
      secure: settings.smtp_secure === 'ssl',
      user: settings.smtp_user,
      password: decryptSecret(ciphertext),
    });
  } else {
    const { sendMail } = await import('@/lib/mail');
    const sent = await sendMail({
      orgId,
      to: trimmed,
      template: 'test',
      mail: {
        subject: 'Yourbiss mail test',
        html: `<p>If you can read this, ${settings.from_name} can send mail through your ${settings.provider} credentials.</p>`,
        text: 'If you can read this, your mail settings work.',
      },
    });
    outcome = { ok: sent.delivered, error: sent.error };
  }

  const patch = outcome.ok ? { verified_at: new Date().toISOString(), last_error: null } : { verified_at: null, last_error: outcome.error?.slice(0, 500) ?? 'Failed' };
  await adminClient.from('org_email_settings').update(patch).eq('org_id', orgId);

  revalidatePath('/app/settings/email');
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error ?? 'The connection failed' };
}

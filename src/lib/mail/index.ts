import 'server-only';

import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { createAdminClient } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import { optionalEnv } from '@/lib/env';
import type { EmailSettingsRow } from '@/lib/types';
import type { RenderedMail } from './templates';

/**
 * One entry point for outgoing mail.
 *
 * Supabase's built-in SMTP is deliberately not used. Resolution order:
 *   1. the workspace's own settings (custom SMTP, or Resend over its SMTP relay)
 *   2. the platform default: RESEND_API_KEY through the Resend REST API
 *   3. otherwise the message is logged as `skipped` and the caller still succeeds
 *
 * Step 3 matters: a booking must not roll back because an SMTP host timed out.
 * The row lands in email_log and booking_notifications, so it can be reviewed
 * and retried instead of silently vanishing.
 */

export interface SendInput {
  orgId: string;
  to: string;
  mail: RenderedMail;
  template: string;
  relatedType?: string;
  relatedId?: string;
  replyTo?: string;
}

export interface SendOutcome {
  delivered: boolean;
  provider: 'resend' | 'smtp' | 'none';
  error?: string;
  messageId?: string;
}

type Transport =
  | { kind: 'smtp'; host: string; port: number; secure: boolean; user: string; password: string }
  | { kind: 'resend'; apiKey: string };

/**
 * Options are annotated as SMTPTransport.Options because createTransport is
 * overloaded; without the annotation TypeScript resolves the wrong candidate and
 * rejects `host`.
 */
function buildSmtpTransport(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  withTimeouts?: boolean;
}) {
  const options: SMTPTransport.Options = {
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.user, pass: input.password },
    tls: { servername: input.host },
  };

  if (input.withTimeouts) {
    options.connectionTimeout = 10000;
    options.greetingTimeout = 10000;
    options.socketTimeout = 15000;
  }

  return nodemailer.createTransport(options);
}

/** Reads the workspace's mail row plus its encrypted password. Service role only. */
async function resolveTransport(orgId: string): Promise<{ transport: Transport; row: EmailSettingsRow | null; from: string; fromName: string } | null> {
  const supabase = createAdminClient();

  const { data: settings } = await supabase
    .from('org_email_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();

  const row = (settings as unknown as EmailSettingsRow | null) ?? null;

  if (row && row.provider === 'smtp' && row.smtp_host && row.smtp_port && row.smtp_user) {
    const { data: secret } = await supabase.from('org_email_passwords').select('ciphertext').eq('org_id', orgId).maybeSingle();
    const ciphertext = (secret as unknown as { ciphertext: string } | null)?.ciphertext;
    if (!ciphertext) return null;

    return {
      transport: {
        kind: 'smtp',
        host: row.smtp_host,
        port: row.smtp_port,
        secure: row.smtp_secure === 'ssl',
        user: row.smtp_user,
        password: decryptSecret(ciphertext),
      },
      row,
      from: row.from_address,
      fromName: row.from_name,
    };
  }

  if (row && row.provider === 'resend') {
    const apiKey = optionalEnv('RESEND_API_KEY');
    if (!apiKey) return null;
    return { transport: { kind: 'resend', apiKey }, row, from: row.from_address, fromName: row.from_name };
  }

  // No workspace configuration yet: fall back to the platform default.
  const apiKey = optionalEnv('RESEND_API_KEY');
  if (apiKey) {
    const from = String(optionalEnv('EMAIL_DEFAULT_FROM') ?? 'Yourbiss <onboarding@resend.dev>');
    const matched = /^([^<]*)<(.+)>$/.exec(from.trim());
    const address = matched?.[2]?.trim();
    const name = matched?.[1]?.trim();
    return {
      transport: { kind: 'resend', apiKey },
      row: null,
      from: address || from,
      fromName: name || 'Yourbiss',
    };
  }

  return null;
}

export async function sendMail(input: SendInput): Promise<SendOutcome> {
  const log = async (entry: Partial<{ state: string; provider: string; error: string; messageId: string; from: string; subject: string }>) => {
    const supabase = createAdminClient();
    await supabase.from('email_log').insert({
      org_id: input.orgId,
      template: input.template,
      to_address: input.to,
      from_address: entry.from ?? null,
      subject: entry.subject ?? input.mail.subject,
      provider: entry.provider ?? 'none',
      state: entry.state ?? 'skipped',
      provider_id: entry.messageId ?? null,
      error: entry.error ?? null,
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    });
  };

  const resolved = await resolveTransport(input.orgId);
  if (!resolved) {
    await log({ state: 'skipped', error: 'No mail transport configured for this workspace' });
    return { delivered: false, provider: 'none', error: 'No mail transport configured' };
  }

  const { transport, row, from, fromName } = resolved;

  if (row && row.sent_on === new Date().toISOString().slice(0, 10) && row.sent_today >= row.daily_quota) {
    await log({ state: 'skipped', provider: transport.kind, from, subject: input.mail.subject, error: 'Daily quota reached' });
    return { delivered: false, provider: transport.kind, error: 'Daily sending quota reached' };
  }

  const fromHeader = `${fromName} <${from}>`;

  try {
    let messageId: string | undefined;

    if (transport.kind === 'resend') {
      const { Resend } = await import('resend');
      const resend = new Resend(transport.apiKey);
      const result = await resend.emails.send({
        from: fromHeader,
        to: input.to,
        subject: input.mail.subject,
        html: input.mail.html,
        text: input.mail.text,
        replyTo: input.replyTo ?? row?.reply_to ?? undefined,
      });
      if (result.error) throw new Error(result.error.message);
      messageId = result.data?.id;
    } else {
      const sender = buildSmtpTransport(transport);

      const info = await sender.sendMail({
        from: fromHeader,
        to: input.to,
        subject: input.mail.subject,
        html: input.mail.html,
        text: input.mail.text,
        replyTo: input.replyTo ?? row?.reply_to ?? undefined,
      });
      messageId = info.messageId;
      await sender.close();
    }

    await log({ state: 'sent', provider: transport.kind, messageId, from, subject: input.mail.subject });

    if (row) {
      const supabase = createAdminClient();
      const today = new Date().toISOString().slice(0, 10);
      await supabase
        .from('org_email_settings')
        .update({
          sent_today: row.sent_on === today ? row.sent_today + 1 : 1,
          sent_on: today,
          last_error: null,
        })
        .eq('org_id', input.orgId);
    }

    return { delivered: true, provider: transport.kind, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log({ state: 'failed', provider: transport.kind, error: message.slice(0, 500), from, subject: input.mail.subject });

    if (row) {
      const supabase = createAdminClient();
      await supabase.from('org_email_settings').update({ last_error: message.slice(0, 500) }).eq('org_id', input.orgId);
    }

    return { delivered: false, provider: transport.kind, error: message };
  }
}

/** Verifies credentials from Settings -> Email without sending to a customer. */
export async function verifySmtp(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = buildSmtpTransport({ ...input, withTimeouts: true });
    await transport.verify();
    await transport.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { getEmailSettings, recentEmailLog } from '@/lib/repo';
import { optionalEnv } from '@/lib/env';
import { AdminOnly } from '@/components/settings/admin-only';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmailSettingsForm } from '@/components/settings/email-settings-form';
import { formatInZone } from '@/lib/utils';

export const metadata: Metadata = { title: 'Settings · Email' };

export default async function EmailSettingsPage() {
  const workspace = await requireWorkspace();
  if (workspace.role === 'member') {
    return <AdminOnly action="Changing how booking and form mail is sent" />;
  }

  const [settings, log] = await Promise.all([
    getEmailSettings(workspace.org.id),
    recentEmailLog(workspace.org.id, 15),
  ]);

  const platformKey = optionalEnv('RESEND_API_KEY');

  return (
    <div className="max-w-[860px] space-y-4">
      <Card>
        <CardHeader
          title="How this workspace sends mail"
          description="Booking confirmations, reminders, cancellations and form notifications. Your own SMTP server is used first; Supabase's built-in mailer is never involved."
        />
        <CardBody>
          <EmailSettingsForm
            orgId={workspace.org.id}
            settings={
              settings
                ? {
                    provider: settings.provider,
                    from_address: settings.from_address,
                    from_name: settings.from_name,
                    reply_to: settings.reply_to ?? '',
                    smtp_host: settings.smtp_host ?? '',
                    smtp_port: settings.smtp_port ?? 587,
                    smtp_secure: settings.smtp_secure,
                    smtp_user: settings.smtp_user ?? '',
                    daily_quota: settings.daily_quota,
                  }
                : null
            }
            hasStoredPassword={Boolean(settings?.has_password)}
            verifiedAt={settings?.verified_at ?? null}
            lastError={settings?.last_error ?? null}
            sentToday={settings?.sent_today ?? 0}
            sentOn={settings?.sent_on ?? null}
            platformResendKey={Boolean(platformKey)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Delivery log"
          description="Every attempt, including ones skipped because no transport exists. A booking never fails because mail failed."
        />
        {log.length === 0 ? (
          <EmptyState
            title="Nothing sent yet"
            description="As soon as a booking is confirmed or a form is submitted with notifications on, the attempt appears here with the provider's own response."
          />
        ) : (
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Template</TH>
              <TH>To</TH>
              <TH>State</TH>
              <TH>Detail</TH>
            </THead>
            <TBody>
              {log.map((entry) => (
                <TR key={entry.id}>
                  <TD className="whitespace-nowrap text-[12.5px] text-muted">
                    {formatInZone(entry.created_at, workspace.org.timezone, { dateStyle: 'short', timeStyle: 'medium' })}
                  </TD>
                  <TD className="text-[12.5px]">{entry.template}</TD>
                  <TD className="max-w-[190px] truncate text-[12.5px]">{entry.to_address}</TD>
                  <TD>
                    <Badge
                      tone={entry.state === 'sent' ? 'success' : entry.state === 'skipped' ? 'neutral' : 'danger'}
                      dot
                    >
                      {entry.state}
                    </Badge>
                  </TD>
                  <TD className="max-w-[280px] truncate text-[12px] text-muted" title={entry.error ?? entry.subject ?? ''}>
                    {entry.error ?? entry.subject ?? entry.provider}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

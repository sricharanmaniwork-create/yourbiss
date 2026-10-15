'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveEmailSettings, testEmailConnection } from '@/lib/actions/settings';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { FormStatus } from '@/components/ui/form-status';
import { useAction } from '@/components/ui/use-action';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface Draft {
  provider: 'smtp' | 'resend';
  from_address: string;
  from_name: string;
  reply_to: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: 'none' | 'ssl' | 'starttls';
  smtp_user: string;
  daily_quota: number;
}

export function EmailSettingsForm({
  orgId,
  settings,
  hasStoredPassword,
  verifiedAt,
  lastError,
  sentToday,
  sentOn,
  platformResendKey,
}: {
  orgId: string;
  settings: Draft | null;
  hasStoredPassword: boolean;
  verifiedAt: string | null;
  lastError: string | null;
  sentToday: number;
  sentOn: string | null;
  platformResendKey: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(
    settings ?? {
      provider: 'smtp',
      from_address: '',
      from_name: '',
      reply_to: '',
      smtp_host: '',
      smtp_port: 587,
      smtp_secure: 'starttls',
      smtp_user: '',
      daily_quota: 100,
    },
  );
  const [password, setPassword] = useState('');
  const [testTo, setTestTo] = useState('');
  const { state, pending, run, fieldError } = useAction();
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const isSmtp = draft.provider === 'smtp';

  const save = () =>
    run(
      () => saveEmailSettings({ orgId, ...draft, password: password || undefined }),
      () => {
        setPassword('');
        toast.success('Mail settings saved');
        router.refresh();
      },
    );

  const test = async () => {
    setTesting(true);
    setTestState(null);
    const result = await testEmailConnection(orgId, testTo);
    setTesting(false);
    setTestState({ ok: result.ok, message: result.ok ? `A test message was sent to ${testTo}.` : (result.error ?? 'The test failed') });
    if (result.ok) router.refresh();
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-1.5 rounded-md border border-line bg-raised p-1.5 sm:grid-cols-2">
        {(
          [
            { key: 'smtp', label: 'Custom SMTP', blurb: 'Your host, your port, your password.' },
            { key: 'resend', label: 'Resend', blurb: 'The API key set on this deployment.' },
          ] as const
        ).map((option) => {
          const active = draft.provider === option.key;
          const unavailable = option.key === 'resend' && !platformResendKey;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => set('provider', option.key)}
              aria-pressed={active}
              className={cn(
                'rounded-md border px-3.5 py-2.5 text-left transition-colors',
                active ? 'border-brand bg-brand-soft' : 'border-transparent bg-surface hover:bg-white',
              )}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                {option.label}
                {unavailable && <Badge tone="warning">no key set</Badge>}
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{option.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From address" htmlFor="mail-from" error={fieldError('from_address')} required>
          <Input
            id="mail-from"
            type="email"
            value={draft.from_address}
            onChange={(e) => set('from_address', e.target.value)}
            placeholder="hello@northsidedental.in"
            maxLength={200}
            required
          />
        </Field>
        <Field label="From name" htmlFor="mail-name" error={fieldError('from_name')} required>
          <Input
            id="mail-name"
            value={draft.from_name}
            onChange={(e) => set('from_name', e.target.value)}
            placeholder="Northside Dental"
            maxLength={80}
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reply-to address" htmlFor="mail-reply" error={fieldError('reply_to')} hint="optional">
          <Input
            id="mail-reply"
            type="email"
            value={draft.reply_to}
            onChange={(e) => set('reply_to', e.target.value)}
            placeholder="replies@northsidedental.in"
            maxLength={200}
          />
        </Field>
        <Field label="Daily sending limit" htmlFor="mail-quota" error={fieldError('daily_quota')} hint="1 – 100000">
          <Input
            id="mail-quota"
            type="number"
            min={1}
            max={100000}
            value={draft.daily_quota}
            onChange={(e) => set('daily_quota', Number(e.target.value))}
            required
          />
        </Field>
      </div>

      {isSmtp && (
        <fieldset className="rounded-md border border-line p-4">
          <legend className="px-1 text-[12.5px] font-semibold text-ink">SMTP server</legend>
          <p className="mb-3.5 text-[12px] leading-relaxed text-muted">
            Gmail, Zoho Mail, your own Postfix, or Resend&rsquo;s SMTP relay all work here. For Resend&rsquo;s relay use
            host <code className="rounded bg-raised px-1">smtp.resend.com</code>, port 465, SSL, username{' '}
            <code className="rounded bg-raised px-1">resend</code> and your API key as the password.
          </p>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,150px)]">
            <Field label="Host" htmlFor="mail-host" error={fieldError('smtp_host')} required>
              <Input
                id="mail-host"
                value={draft.smtp_host}
                onChange={(e) => set('smtp_host', e.target.value)}
                placeholder="smtp.example.com"
                maxLength={253}
                spellCheck={false}
              />
            </Field>
            <Field label="Port" htmlFor="mail-port" error={fieldError('smtp_port')} required>
              <Input
                id="mail-port"
                type="number"
                min={1}
                max={65535}
                value={draft.smtp_port}
                onChange={(e) => set('smtp_port', Number(e.target.value))}
              />
            </Field>
            <Field label="Encryption" htmlFor="mail-secure" required>
              <Select
                id="mail-secure"
                value={draft.smtp_secure}
                onChange={(e) => set('smtp_secure', e.target.value as Draft['smtp_secure'])}
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="ssl">SSL / TLS (465)</option>
                <option value="none">None (25)</option>
              </Select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Username" htmlFor="mail-user" error={fieldError('smtp_user')} required>
              <Input
                id="mail-user"
                value={draft.smtp_user}
                onChange={(e) => set('smtp_user', e.target.value)}
                placeholder="hello@northsidedental.in"
                maxLength={200}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Password"
              htmlFor="mail-pass"
              error={fieldError('password')}
              hint={hasStoredPassword ? 'stored — leave blank to keep' : 'required'}
              required={!hasStoredPassword}
            >
              <Input
                id="mail-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasStoredPassword ? '••••••••  (unchanged)' : 'app password'}
                autoComplete="new-password"
              />
            </Field>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            The password is encrypted with AES-256-GCM before it is stored, in a table that no browser role can read.
            It is never sent back to this page.
          </p>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button type="button" variant="primary" loading={pending} onClick={save}>
          Save mail settings
        </Button>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Send a test to this address"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@company.com"
            type="email"
            className="h-9 w-[210px]"
          />
          <Button type="button" onClick={() => void test()} loading={testing} disabled={testTo.trim().length < 5}>
            Send test
          </Button>
        </div>
        <div className="min-w-[180px] flex-1">
          {verifiedAt ? (
            <Badge tone="success" dot>
              Verified {new Date(verifiedAt).toLocaleDateString()}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Not verified
            </Badge>
          )}
          {sentOn && (
            <span className="ml-2 text-[12px] text-muted">
              {sentToday}/{draft.daily_quota} sent on {sentOn}
            </span>
          )}
        </div>
      </div>

      <FormStatus state={state} />
      {testState && (
        <p
          role={testState.ok ? 'status' : 'alert'}
          className={cn(
            'rounded-md border px-3 py-2 text-[12.5px] leading-relaxed',
            testState.ok
              ? 'border-[#c6e7d0] bg-[#e6f4ea] text-[#0b6b3c]'
              : 'border-[#f4c7c4] bg-[#fcebea] text-[#a50f0f]',
          )}
        >
          {testState.message}
        </p>
      )}
      {lastError && (
        <p className="rounded-md border border-line bg-raised px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
          Last delivery failure: <span className="text-danger">{lastError}</span>
        </p>
      )}
    </div>
  );
}

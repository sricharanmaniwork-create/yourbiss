import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { YourbissMark } from '@/components/brand/mark';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

const ERROR_COPY: Record<string, string> = {
  password: 'Use a password of at least 8 characters that is not a single repeated or digits-only string.',
  mismatch: 'The two passwords do not match.',
  server: 'The new password could not be saved. Please try again.',
};

/**
 * Where a recovery link leaves the visitor.
 *
 * The `(auth)` group is the wrong home for this page: its layout bounces anyone who already
 * has a session to the dashboard, and the exchange Supabase's link performs *creates* a
 * session before this form is ever shown. So it stands on its own, outside that layout, and
 * asks the auth server for the session instead of assuming one.
 *
 * No session here means the link was opened after its token was spent or expired — the same
 * answer as a half-copied link, and the reason the page does not render a form nobody can
 * submit.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?error=expired_link');

  const error = params.error ? ERROR_COPY[params.error] : undefined;

  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-[400px]">
        <div className="mb-7">
          <YourbissMark />
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-panel">
          <h1 className="text-[19px] font-semibold text-ink">Choose a new password</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            {user.email ? `This link is good for the account signed in as ${user.email}.` : 'This link is good for the account it was sent to.'}
          </p>

          <form method="post" action="/auth/reset-password" className="mt-5 space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3.5 py-2.5 text-[13px] text-[#a50f0f]">
                {error}
              </p>
            )}

            <Field label="New password" htmlFor="password" required hint="at least 8 characters">
              <Input id="password" name="password" type="password" autoComplete="new-password" maxLength={200} required placeholder="••••••••" />
            </Field>

            <Field label="Repeat it" htmlFor="confirm_password" required>
              <Input
                id="confirm_password"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                maxLength={200}
                required
                placeholder="••••••••"
              />
            </Field>

            <Button type="submit" variant="primary" size="lg" className="w-full">
              Save the new password
            </Button>
          </form>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-ink-muted">
          Saved? You stay signed in on this browser, and the link cannot be used again.
        </p>
      </div>
    </main>
  );
}

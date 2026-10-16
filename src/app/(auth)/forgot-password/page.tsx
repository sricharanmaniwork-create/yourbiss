import type { Metadata } from 'next';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
};

const ERROR_COPY: Record<string, string> = {
  email: 'That does not look like an email address.',
  throttled: 'Too many attempts. Wait a few minutes and try again.',
  server: 'The reset link could not be sent just now. Please try again.',
};

const NOTICE_COPY: Record<string, string> = {
  sent: 'If that address has a Yourbiss account, a reset link is on its way. It opens once and expires within an hour.',
};

/**
 * The only password question this form asks is which address to send to, so the page is a
 * plain POST with no client state — the same reason sign-in posts natively: it still works
 * with JavaScript unavailable, and nothing is wasted keeping a spinner honest.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? ERROR_COPY[params.error] : undefined;
  const notice = params.notice ? NOTICE_COPY[params.notice] : undefined;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold text-ink">Forgot your password?</h1>
        <p className="mt-1 text-[13.5px] text-muted">We will email you a link to choose a new one.</p>
      </header>

      {notice && (
        <p className="mb-4 rounded-md border border-[#c7dbfb] bg-brand-soft px-3.5 py-2.5 text-[13px] text-brand-dark">{notice}</p>
      )}

      <form method="post" action="/auth/forgot-password" className="space-y-4">
        {error && (
          <p role="alert" className="rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3.5 py-2.5 text-[13px] text-[#a50f0f]">
            {error}
          </p>
        )}

        <Field label="Work email" htmlFor="email" required>
          <Input id="email" name="email" type="email" autoComplete="email" maxLength={200} required placeholder="you@company.com" />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full">
          Send the reset link
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted">
        Remembered it?{' '}
        <a href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </a>
      </p>
    </>
  );
}

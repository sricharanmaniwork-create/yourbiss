'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { GithubIcon } from '@/components/auth/github-icon';

const ERROR_COPY: Record<string, string> = {
  invalid: 'Check the email address and use a password of at least 8 characters.',
  bad_credentials: 'That email and password do not match an account.',
  throttled: 'Too many attempts. Wait a few minutes and try again.',
  missing_code: 'That sign-in link was incomplete. Try again or use your password.',
  expired_link: 'That sign-in link has already been used or has expired.',
  oauth_unconfigured: 'GitHub sign-in is not set up for this deployment yet.',
  oauth_failed: 'GitHub did not complete the sign-in. You can try again.',
  name: 'Please tell us your name.',
  email: 'That does not look like an email address.',
  password: 'Use a password of at least 8 characters that is not a single repeated or digits-only string.',
  server: 'Could not create the account just now. Please try again.',
};

const NOTICE_COPY: Record<string, string> = {
  confirm: 'We sent a confirmation link. Open it, then sign in.',
  no_account: 'Sign in with your existing password, or check your inbox for a reset link.',
  invited: 'You have been added to a workspace. Pick it from the switcher above.',
};

/**
 * Posts natively to the auth route handler rather than through fetch, so sign-in
 * still works with JavaScript unavailable and no client/server state is wasted
 * keeping a spinner honest.
 */
export function AuthForm({
  mode,
  next,
  errorCode,
  noticeCode,
  action,
}: {
  mode: 'login' | 'signup';
  next: string;
  errorCode?: string;
  noticeCode?: string;
  action: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const error = errorCode ? ERROR_COPY[errorCode] : undefined;
  const notice = noticeCode ? NOTICE_COPY[noticeCode] : undefined;

  return (
    <div>
      {notice && (
        <p className="mb-4 rounded-md border border-[#c7dbfb] bg-brand-soft px-3.5 py-2.5 text-[13px] text-brand-dark">
          {notice}
        </p>
      )}

      <form
        method="post"
        action={next ? `${action}?${new URLSearchParams({ next }).toString()}` : action}
        onSubmit={() => setSubmitting(true)}
        className="space-y-4"
      >
        {error && (
          <p role="alert" className="rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3.5 py-2.5 text-[13px] text-[#a50f0f]">
            {error}
          </p>
        )}

        {mode === 'signup' && (
          <Field label="Your name" htmlFor="display_name" required>
            <Input id="display_name" name="display_name" autoComplete="name" maxLength={80} required placeholder="Priya Raman" />
          </Field>
        )}

        <Field label="Work email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={200}
            required
            placeholder="you@company.com"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          hint={mode === 'signup' ? 'at least 8 characters' : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            maxLength={200}
            required
            placeholder="••••••••"
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
          {mode === 'signup' ? 'Create my workspace' : 'Sign in'}
        </Button>
      </form>

      {mode === 'login' && (
        <p className="mt-3 text-center text-[12.5px] text-muted">
          <a href="/forgot-password" className="font-medium text-brand hover:underline">
            Forgot your password?
          </a>
        </p>
      )}

      <div className="my-5 flex items-center gap-3 text-[12px] text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <a
        href={`/auth/oauth/github${next ? `?${new URLSearchParams({ next }).toString()}` : ''}`}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-surface text-[14px] font-medium text-ink hover:bg-raised"
      >
        <GithubIcon />
        Continue with GitHub
      </a>

      <p className="mt-5 text-center text-[13px] text-muted">
        {mode === 'signup' ? (
          <>
            Already have an account?{' '}
            <a href={`/login${next ? `?${new URLSearchParams({ next }).toString()}` : ''}`} className="font-medium text-brand hover:underline">
              Sign in
            </a>
          </>
        ) : (
          <>
            New to Yourbiss?{' '}
            <a href={`/signup${next ? `?${new URLSearchParams({ next }).toString()}` : ''}`} className="font-medium text-brand hover:underline">
              Create an account
            </a>
          </>
        )}
      </p>
    </div>
  );
}

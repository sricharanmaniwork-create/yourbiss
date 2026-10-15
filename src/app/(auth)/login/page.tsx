import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNext } from '@/lib/auth-common';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Yourbiss workspace.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next, '');

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold text-ink">Welcome back</h1>
        <p className="mt-1 text-[13.5px] text-muted">Sign in to pick up where you left off.</p>
      </header>
      <AuthForm mode="login" next={next} action="/auth/login" errorCode={params.error} noticeCode={params.notice} />
    </>
  );
}

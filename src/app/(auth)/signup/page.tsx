import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';
import { safeNext } from '@/lib/auth-common';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Create a Yourbiss workspace with a website, forms and bookings already set up.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next, '');

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold text-ink">Create your workspace</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          You get a website with an empty canvas, a form and a booking service to start from.
        </p>
      </header>
      <AuthForm mode="signup" next={next} action="/auth/signup" errorCode={params.error} noticeCode={params.notice} />
      <p className="mt-5 text-center text-[11.5px] leading-relaxed text-muted">
        Your email address is stored in Supabase Auth and used only to sign you in and send booking
        notifications you ask for.
      </p>
    </>
  );
}

import Link from 'next/link';
import { YourbissMark } from '@/components/brand/mark';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-10">
      <YourbissMark className="mb-8" />
      <div className="ui-card max-w-[460px] px-8 py-9 text-center">
        <p className="text-[38px] font-semibold leading-none text-brand">404</p>
        <h1 className="mt-3 text-[16px] font-semibold">There is nothing at that address</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          The page was moved, unpublished, or never existed. If it is a site you built, check that the page is
          published.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/app"
            className="inline-flex h-9 items-center rounded-md border border-transparent bg-brand px-4 text-[13.5px] font-medium text-white hover:bg-brand-dark"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

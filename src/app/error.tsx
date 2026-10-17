'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { YourbissMark } from '@/components/brand/mark';

/**
 * The last boundary before the plain white error page. It catches what a section boundary
 * cannot: a failure in a layout rather than in a page — the session read behind `/app`, or
 * the one behind the sign-in screen — plus the routes that belong to no section at all, like
 * `/invite/<token>`. A layout has no boundary of its own to fall back to, so everything
 * below it lands here, and this is where the deployment-level causes get named: a variable
 * that is missing, a database a migration behind the code.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[yourbiss] page failed to render', error);
  }, [error]);

  // Named variables only. React's own minified sentence contains the word
  // "environment", and matching on that told everybody their env was missing.
  const looksLikeConfig = /SUPABASE_[A-Z_]+|APP_ENCRYPTION_KEY|RESEND_API_KEY|CRON_SECRET|SMTP_[A-Z]+|Missing environment variable|Invalid environment|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(
    error.message,
  );
  const hiddenByProduction = /Minified React error|Server Components render/i.test(error.message);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-10">
      <YourbissMark className="mb-8" />
      <div className="ui-card max-w-[480px] px-8 py-9">
        <h1 className="text-[16px] font-semibold">This page could not load</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {looksLikeConfig
            ? 'The app is missing configuration it needs, or cannot reach the service it needs. The variables it names are set under Vercel → Settings → Environment Variables; a change there only takes effect on a redeploy.'
            : hiddenByProduction
              ? error.digest
                ? 'The page failed on the server, and a production build keeps the reason out of the browser. The reference below is printed in Vercel → Logs → Runtime — open the deploy, search for it, and the line beside it is the actual failure. A database that has not had its latest migration run is the usual reason.'
                : 'The page failed on the server, and a production build keeps the reason out of the browser. Vercel → Logs → Runtime holds the failure behind this request.'
              : 'Reloading usually clears a transient failure. If it does not, the message below names what the database or the server refused.'}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
          {error.message}
        </pre>
        {error.digest && <p className="mt-2 text-[11.5px] text-muted">Reference: {error.digest}</p>}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center rounded-md border border-transparent bg-brand px-4 text-[13.5px] font-medium text-white hover:bg-brand-dark"
          >
            Try again
          </button>
          <Link
            href="/app"
            className="inline-flex h-9 items-center rounded-md border border-line bg-white px-4 text-[13.5px] font-medium text-ink hover:bg-raised"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

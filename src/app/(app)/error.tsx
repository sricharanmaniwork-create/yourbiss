'use client';

import { useEffect } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A query or RPC that failed says so in its own words, and those words are shown
 * because they are ours — a missing column, a policy rejection, a quantity the ledger
 * refuses. Hiding them turns a support ticket into a guess.
 *
 * A Server Components failure is the opposite case. Production replaces its message
 * with React's minified text and hands the reason to the server log, keyed by the
 * digest, so the card points at that log instead of pretending the browser knows.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[yourbiss] screen failed to render', error);
  }, [error]);

  // Named variables only. React's own minified sentence contains the word
  // "environment", and matching on that told everybody their env was missing.
  const looksLikeConfig = /SUPABASE_[A-Z_]+|APP_ENCRYPTION_KEY|RESEND_API_KEY|CRON_SECRET|SMTP_[A-Z]+|Missing environment variable|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(
    error.message,
  );
  const hiddenByProduction = /Minified React error|Server Components render/i.test(error.message);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5">
      <div className="ui-card max-w-[520px] px-7 py-8">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#fcebea] text-danger">
          <CircleAlert size={19} />
        </div>
        <h1 className="text-[17px] font-semibold">This screen could not load</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {looksLikeConfig
            ? 'The app is missing configuration it needs, or cannot reach the service it needs. The variables it names are set under Vercel → Settings → Environment Variables; a change there only takes effect on a redeploy.'
            : hiddenByProduction
              ? error.digest
                ? 'The page failed on the server, and a production build keeps the reason out of the browser. The reference below is printed in Vercel → Logs → Runtime — open the deploy, search for it, and the line beside it is the actual failure. A database that has not had its latest migration run is the usual reason.'
                : 'The page failed on the server, and a production build keeps the reason out of the browser. Vercel → Logs → Runtime holds the failure behind this request.'
              : 'The database call behind this page failed. Trying again usually clears a transient error; if it does not, the message below names what the database refused.'}
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
          {error.message}
        </pre>
        {error.digest && <p className="mt-2 text-[11.5px] text-muted">Reference: {error.digest}</p>}
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button
            variant="ghost"
            // A hard reload, not router.push: the tree that threw is still
            // mounted, and only a fresh request can hand the screen back to the
            // server that failed.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            onClick={() => (window.location.href = '/app')}
          >
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

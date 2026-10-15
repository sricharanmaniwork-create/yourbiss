'use client';

import { useEffect } from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A thrown error here means a query or RPC failed. The message is shown because
 * these are our own errors (a missing column, a policy rejection), and hiding
 * them turns a support ticket into a guess.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[yourbiss] screen failed to render', error);
  }, [error]);

  const looksLikeConfig = /environment|SUPABASE|APP_ENCRYPTION_KEY|fetch failed/i.test(error.message);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5">
      <div className="ui-card max-w-[520px] px-7 py-8">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#fcebea] text-danger">
          <CircleAlert size={19} />
        </div>
        <h1 className="text-[17px] font-semibold">This screen could not load</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          {looksLikeConfig
            ? 'The app is missing configuration it needs. Check the environment variables named below, then restart the server.'
            : 'The database call behind this page failed. Trying again usually clears a transient error.'}
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

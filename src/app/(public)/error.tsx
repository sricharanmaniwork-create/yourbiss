'use client';

import { useEffect } from 'react';

/**
 * A public page — a published site, a shared form, a booking link — is read by somebody
 * with no account and no way to look at server logs. So the database sentence that failed
 * stays out of this card: it names tables and columns, and to a visitor it is noise that
 * also leaks how the product is built. The digest is the one thing worth printing: a
 * visitor can quote it, and it is exactly what Vercel → Logs → Runtime searches for.
 */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[yourbiss] public page failed to render', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#f2f4f7] px-4 py-10">
      <div className="mx-auto w-full max-w-[520px] rounded-xl border border-[#e4e8ee] bg-white px-6 py-10 text-center">
        <h1 className="text-[17px] font-semibold text-[#111827]">This page could not load</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#475467]">
          Something went wrong on our side, not yours. Reloading usually clears it. If it keeps happening, pass the
          reference below to whoever owns this page.
        </p>
        {error.digest ? (
          <p className="mt-4 rounded-md border border-[#e4e8ee] bg-[#fafbfc] px-3 py-2 font-mono text-[12px] text-[#475467]">
            {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-9 items-center rounded-md bg-[#2e6be6] px-4 text-[13.5px] font-medium text-white hover:bg-[#2559c4]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

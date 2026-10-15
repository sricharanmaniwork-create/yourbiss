'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy } from 'lucide-react';

/** The origin never changes during a session, so there is nothing to subscribe to. */
function noopSubscribe() {
  return () => {};
}

export function CopyAddress({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // The absolute address only exists in the browser. Reading window.location
  // during render would differ between the server and client HTML and produce a
  // hydration mismatch, so it comes through as an external store: the server
  // snapshot is empty and React re-reads the real origin after hydration.
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => '');
  const url = `${origin}/s/${slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access is denied on insecure origins; selecting the text lets
      // the user copy by hand instead of showing a dead button.
      selectInto(codeRef.current);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <code
        ref={codeRef}
        className="min-w-0 flex-1 truncate rounded-md border border-line bg-raised px-3 py-2 text-[12.5px] text-ink"
      >
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className="flex h-8 flex-none items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink hover:bg-raised"
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function selectInto(code: HTMLElement | null) {
  const selection = window.getSelection();
  if (!selection || !code) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}

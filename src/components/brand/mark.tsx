import { cn } from '@/lib/utils';

/**
 * Wordmark drawn inline rather than shipped as an asset so it stays crisp at any
 * size and follows the current text colour.
 */
export function YourbissMark({
  tone = 'dark',
  className,
}: {
  tone?: 'dark' | 'light';
  className?: string;
}) {
  const glyph = tone === 'light' ? '#5b9bff' : '#2e6be6';
  const word = tone === 'light' ? '#ffffff' : '#111827';
  return (
    <span className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect x="1" y="1" width="30" height="30" rx="8" fill={glyph} />
        {/* Two stacked "surfaces" — a page and a form on top of it. */}
        <path d="M9 11.5h14M9 16h14M9 20.5h9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </svg>
      <span className="text-[17px] font-semibold tracking-[-0.02em]" style={{ color: word }}>
        Yourbiss
      </span>
    </span>
  );
}

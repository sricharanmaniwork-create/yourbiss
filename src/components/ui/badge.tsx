import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'bg-[#eef0f3] text-[#41474f] border-[#dfe3e9]',
  brand: 'bg-brand-soft text-brand-dark border-[#c7dbfb]',
  success: 'bg-[#e6f4ea] text-[#0b6b3c] border-[#c6e7d0]',
  warning: 'bg-[#fdf3e0] text-[#8a5300] border-[#f3ddb0]',
  danger: 'bg-[#fcebea] text-[#a50f0f] border-[#f4c7c4]',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  children,
  dot,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[2px] text-[11.5px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-[6px] w-[6px] flex-none rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATE_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  published: 'success',
  archived: 'neutral',
  active: 'success',
  hidden: 'neutral',
  enabled: 'success',
  disabled: 'neutral',
  pending: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  completed: 'brand',
  no_show: 'danger',
  new: 'brand',
  read: 'neutral',
  replied: 'success',
  spam: 'danger',
  unverified: 'warning',
  verified: 'success',
  failed: 'danger',
  ordered: 'brand',
  partially_received: 'warning',
  received: 'success',
  qualified: 'brand',
  converted: 'success',
  owner: 'brand',
  admin: 'brand',
  member: 'neutral',
  suspended: 'danger',
};

/** One mapping so a status reads the same colour in every module. */
export function StatusBadge({ state, className }: { state: string; className?: string }) {
  const tone = STATE_TONE[state] ?? 'neutral';
  return (
    <Badge tone={tone} dot className={cn('capitalize', className)}>
      {state.replace(/_/g, ' ')}
    </Badge>
  );
}

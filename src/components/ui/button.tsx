import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const VARIANTS = {
  primary:
    'bg-brand text-white border-transparent hover:bg-brand-dark disabled:hover:bg-brand',
  secondary:
    'bg-surface text-ink border-line-strong hover:bg-raised',
  ghost:
    'bg-transparent text-ink-soft border-transparent hover:bg-black/[0.05] hover:text-ink',
  danger:
    'bg-danger text-white border-transparent hover:bg-[#b31d13]',
  outlineDanger:
    'bg-surface text-danger border-[#f0c3bf] hover:bg-[#fdf2f1]',
} as const;

const SIZES = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-[5px]',
  md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-md',
  lg: 'h-10 px-5 text-[14px] gap-2 rounded-md',
  icon: 'h-9 w-9 p-0 rounded-md',
  iconSm: 'h-7 w-7 p-0 rounded-[5px]',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center border font-medium',
        'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

/** Anchor styled as a button — for navigation that should not become a POST. */
export const ButtonLink = forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}>(function ButtonLink({ className, variant = 'secondary', size = 'md', children, ...rest }, ref) {
  return (
    <a
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center border font-medium',
        'transition-colors duration-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
});

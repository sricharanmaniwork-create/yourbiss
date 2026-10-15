import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

const CONTROL_BASE =
  'w-full rounded-md border bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] ' +
  'transition-colors duration-100 focus:border-brand disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-muted';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL_BASE, 'h-9', invalid ? 'border-danger' : 'border-line-strong', className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, 'py-2 leading-relaxed', invalid ? 'border-danger' : 'border-line-strong', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        // The chevron is drawn by us so it looks the same on every platform.
        'h-9 appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%223%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8',
        invalid ? 'border-danger' : 'border-line-strong',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Label({
  className,
  children,
  htmlFor,
  required,
  hint,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className={cn('mb-1.5 flex items-baseline justify-between gap-3', className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-soft">
        {children}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </div>
  );
}

/**
 * Wraps a control with its label and error so every form in the product
 * renders validation the same way.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required} hint={hint}>
          {label}
        </Label>
      )}
      {children}
      {error && (
        <p role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function useFieldId(prefix?: string) {
  const id = useId();
  return prefix ? `${prefix}-${id}` : id;
}

export const Checkbox = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Checkbox({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'h-4 w-4 flex-none cursor-pointer appearance-none rounded border border-line-strong bg-surface',
          'checked:border-brand checked:bg-brand',
          'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%224%22%3E%3Cpath%20d%3D%22M5%2013l4%204L19%207%22%2F%3E%3C%2Fsvg%3E")] bg-[length:11px] bg-center bg-no-repeat',
          'checked:bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%224%22%3E%3Cpath%20d%3D%22M5%2013l4%204L19%207%22%2F%3E%3C%2Fsvg%3E")] checked:bg-[length:11px]',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[38px] flex-none rounded-full border transition-colors duration-150',
        checked ? 'border-brand bg-brand' : 'border-line-strong bg-[#dfe3e9]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

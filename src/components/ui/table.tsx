import { cn } from '@/lib/utils';

export function Table({ className, children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-[13px]', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <thead className={cn('bg-raised', className)}>
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  className,
  align = 'left',
  sortable,
  active,
  ascending,
  onSort,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  active?: boolean;
  ascending?: boolean;
  onSort?: () => void;
}) {
  const content = (
    <>
      {children}
      {sortable && (
        <span aria-hidden="true" className={cn('ml-1 text-[10px]', active ? 'text-brand' : 'text-[#b6bec9]')}>
          {active ? (ascending ? '▲' : '▼') : '⇅'}
        </span>
      )}
    </>
  );
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {sortable && onSort ? (
        <button type="button" onClick={onSort} className="inline-flex items-center hover:text-ink">
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
  selected,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-line last:border-b-0',
        onClick && 'cursor-pointer hover:bg-brand-soft/50',
        selected && 'bg-brand-soft',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  className,
  align = 'left',
  colSpan,
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cn(
        'px-4 py-2.5 align-middle text-ink',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

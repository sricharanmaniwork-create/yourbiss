'use client';

import Link from 'next/link';
import { ArrowLeft, Check, Monitor, Phone, Plus, Redo2, Save, SquareChevronLeft, Tablet, Undo2 } from 'lucide-react';
import type { Device } from './canvas';
import { cn } from '@/lib/utils';

/**
 * The strip across the top of the editor: where you are, whether it is saved,
 * and the handful of things that act on the whole page rather than one block.
 */
export function Toolbar({
  siteName,
  siteId,
  pageTitle,
  isHome,
  device,
  setDevice,
  canUndo,
  canRedo,
  undo,
  redo,
  dirty,
  savedAt,
  saving,
  saveNow,
  addPage,
  previewHref,
  status,
}: {
  siteName: string;
  siteId: string;
  pageTitle: string;
  isHome: boolean;
  device: Device;
  setDevice: (device: Device) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  dirty: boolean;
  savedAt: string | null;
  saving: boolean;
  saveNow: () => void;
  addPage: () => void;
  previewHref: string | null;
  status: 'draft' | 'published' | 'archived';
}) {
  const saved = savedAt
    ? new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <header className="flex h-[52px] flex-none items-center gap-2 border-b border-line bg-surface px-3">
      <Link
        href={`/app/websites/${siteId}`}
        className="inline-flex flex-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted hover:bg-raised hover:text-ink"
      >
        <ArrowLeft size={14} />
        <span className="hidden max-w-[130px] truncate sm:inline">{siteName}</span>
      </Link>

      <span className="h-4 w-px flex-none bg-line" />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">{pageTitle}</p>
        <p className="flex items-center gap-1.5 truncate text-[11.5px] text-muted">
          {isHome && <span className="rounded bg-brand/10 px-1 font-medium text-brand-dark">Home</span>}
          {saving ? (
            <>
              <span className="ui-spinner" aria-hidden="true" />
              Saving…
            </>
          ) : dirty ? (
            'Unsaved changes'
          ) : saved ? (
            <>
              <Check size={12} className="text-[#18794d]" />
              Saved at {saved}
            </>
          ) : (
            'Up to date'
          )}
        </p>
      </div>

      <div className="hidden items-center gap-1 md:flex">
        <Icon title="Add a page" onClick={addPage} aria-label="Add a page">
          <Plus size={15} />
        </Icon>
      </div>

      <div className="flex items-center gap-0.5 rounded-md border border-line bg-raised p-0.5">
        <Icon title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} aria-label="Undo">
          <Undo2 size={15} />
        </Icon>
        <Icon title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} aria-label="Redo">
          <Redo2 size={15} />
        </Icon>
      </div>

      <div className="flex items-center gap-0.5 rounded-md border border-line bg-raised p-0.5" role="group" aria-label="Preview width">
        {(
          [
            { key: 'desktop', label: 'Desktop', icon: <Monitor size={15} /> },
            { key: 'tablet', label: 'Tablet', icon: <Tablet size={15} /> },
            { key: 'mobile', label: 'Phone', icon: <Phone size={15} /> },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setDevice(option.key)}
            aria-pressed={device === option.key}
            title={`${option.label} width`}
            className={cn(
              'rounded p-1.5 transition-colors',
              device === option.key ? 'bg-surface text-brand-dark shadow-[var(--shadow-panel)]' : 'text-muted hover:text-ink',
            )}
          >
            {option.icon}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={saveNow}
        disabled={!dirty && !saving}
        className="hidden h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-raised disabled:opacity-50 sm:inline-flex"
      >
        <Save size={14} />
        Save
      </button>

      {previewHref ? (
        <a
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-raised lg:inline-flex"
        >
          <SquareChevronLeft size={14} />
          {status === 'published' ? 'Open live page' : 'Open last published'}
        </a>
      ) : (
        <Link
          href={`/app/websites/${siteId}`}
          className="hidden h-8 items-center rounded-md border border-line-strong px-2.5 text-[12.5px] font-medium text-ink-soft hover:bg-raised lg:inline-flex"
        >
          Publish from the site page
        </Link>
      )}
    </header>
  );
}

function Icon({
  title,
  onClick,
  disabled,
  children,
  ...rest
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      {...rest}
      className="rounded p-1.5 text-ink-soft transition-colors hover:bg-black/[.05] hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

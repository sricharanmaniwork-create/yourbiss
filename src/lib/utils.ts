import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Editor-safe id. Blocks and fields reference these inside jsonb documents. */
export function uid(prefix = 'b'): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 12)}`;
}

export function slugify(input: string, fallback = 'untitled'): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return base || fallback;
}

/** Mirrors youbiss.is_reserved_slug() so the UI rejects what the DB would. */
const RESERVED = new Set([
  'api', 'app', 'admin', 'auth', 'login', 'signup', 'signin', 'signout', 'logout', 'dashboard',
  'assets', 'static', 'public', 'cdn', 'docs', 'help', 'support', 'status', 'mail', 'www',
  'site', 'sites', 'form', 'forms', 'book', 'booking', 'bookings', 'embed', 'settings',
  'invite', 'invites', 'onboarding', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'favicon',
  '_next', 'node_modules', 'preview', 'editor', 'account', 'billing', 'team',
]);

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(value) && !RESERVED.has(value);
}

export function isValidPagePath(value: string): boolean {
  if (value === '/') return true;
  return /^\/[a-z0-9]([a-z0-9/-]{0,94})$/.test(value) && !value.endsWith('/');
}

export function formatMoney(cents: number, currency = 'INR', locale = 'en-IN') {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Money stored as `numeric(14,2)` in whole units — a CRM deal, an inventory price.
 * Bookings store cents, so the two helpers must not be swapped by mistake.
 */
export function formatAmount(units: number, currency = 'INR', locale = 'en-IN') {
  return formatMoney(Math.round((Number.isFinite(units) ? units : 0) * 100), currency, locale);
}

/**
 * `locale` rides along in the options but is not part of
 * `Intl.DateTimeFormatOptions` — it belongs to the constructor's first argument,
 * which is where a workspace's own locale has to be applied.
 */
export function formatInZone(iso: string, timeZone: string, opts?: Intl.DateTimeFormatOptions & { locale?: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const { locale = 'en-IN', ...rest } = opts ?? {};
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
    ...rest,
  }).format(date);
}

/** Date without a clock, in a zone. `timeStyle: 'none'` is not a legal option. */
export function formatDateInZone(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone }).format(date);
}

/** Clock only, in a zone — what a slot chip and an agenda row show. */
export function clockInZone(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}

/** Date as `YYYY-MM-DD` in a specific zone, without pulling a date library in. */
export function dateInZone(day: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(day)
    .slice(0, 10);
}

export function addDays(day: string, count: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string>): Result<never> {
  return { ok: false, error, fieldErrors };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Escape before interpolating into HTML the workspace itself configured. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

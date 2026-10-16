import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { escapeHtml } from '@/lib/utils';
import { mailBase, shell, type Base, type RenderedMail } from './templates';

/**
 * A workspace's own wording for a letter.
 *
 * `email_templates` (migration 0006) holds one row per letter per workspace, and its own
 * comment is the rule: a missing row means "use the built-in default". This module is what
 * reads it, so the table is either honoured or absent — never decorative.
 *
 * The wording is treated as **text, never as markup**. The column is called `html_body`
 * because that is what a mail body eventually is, but everything in it is escaped and then
 * re-built as paragraphs and line breaks, with a bare URL turned into a link. A workspace can
 * therefore write a letter in its own voice, and cannot send a `<script>`, a remote stylesheet
 * or a tracking pixel through a box that has no review step in front of it.
 */

export interface OverrideRow {
  subject: string;
  html_body: string;
  text_body: string | null;
}

/** A row the workspace saved, as the settings screen reads it. */
export interface StoredTemplate extends OverrideRow {
  key: string;
  enabled: boolean;
  updated_at: string;
}

export interface TokenInfo {
  name: string;
  meaning: string;
}

export interface TemplateKeyInfo {
  key: string;
  label: string;
  note: string;
  tokens: TokenInfo[];
  /** The letters that go to the team rather than to a customer. */
  internal?: boolean;
}

const BOOKING_TOKENS: TokenInfo[] = [
  { name: 'customer_name', meaning: 'Who the appointment belongs to' },
  { name: 'customer_email', meaning: 'Their email address' },
  { name: 'customer_phone', meaning: 'Their phone number, when they gave one' },
  { name: 'service_name', meaning: 'The service that was booked' },
  { name: 'staff_name', meaning: 'Who they are meeting' },
  { name: 'when', meaning: 'Date and time in the booking’s own timezone' },
  { name: 'timezone', meaning: 'That timezone, spelled out' },
  { name: 'duration', meaning: 'How long the appointment runs' },
  { name: 'price', meaning: 'The price shown on the booking page, if it has one' },
  { name: 'location', meaning: 'In person, online or by phone' },
  { name: 'notes', meaning: 'What the customer typed in the notes box' },
  { name: 'code', meaning: 'The reference the manage page asks for' },
  { name: 'org_name', meaning: 'This workspace’s name' },
  { name: 'manage_url', meaning: 'The page where they move or cancel it' },
  { name: 'rebook_url', meaning: 'The booking page, to choose a new time' },
];

const KEY_INFO: TemplateKeyInfo[] = [
  {
    key: 'booking_confirmation',
    label: 'Booking confirmation',
    note: 'Sent to the customer the moment a booking is made, on the public page or by the team.',
    tokens: BOOKING_TOKENS,
  },
  {
    key: 'booking_reminder',
    label: 'Booking reminder',
    note: 'Sent once, to customers whose appointment starts within the next day.',
    tokens: BOOKING_TOKENS,
  },
  {
    key: 'booking_cancelled',
    label: 'Booking cancelled',
    note: 'Sent when the appointment is cancelled from either side.',
    tokens: BOOKING_TOKENS,
  },
  {
    key: 'booking_rescheduled',
    label: 'Booking moved',
    note: 'Sent when the appointment is moved. The previous time is not available to the letter — the move overwrites it.',
    tokens: BOOKING_TOKENS,
  },
  {
    key: 'team_new_booking',
    label: 'New booking for the team',
    note: 'Sent to the team member who was booked, so an appointment never waits for someone to open the calendar.',
    tokens: BOOKING_TOKENS,
    internal: true,
  },
  {
    key: 'form_response',
    label: 'New form response',
    note: 'Sent to the people a form notifies when a response arrives.',
    tokens: [
      { name: 'form_title', meaning: 'The form that was answered' },
      { name: 'org_name', meaning: 'This workspace’s name' },
      { name: 'submitter_email', meaning: 'The address given on the form, if any' },
      { name: 'answers', meaning: 'Every answer, one per line' },
    ],
  },
  {
    key: 'invite_member',
    label: 'Team invitation',
    note: 'Sent when someone is added to this workspace.',
    tokens: [
      { name: 'inviter_name', meaning: 'Who sent the invitation' },
      { name: 'org_name', meaning: 'This workspace’s name' },
      { name: 'role', meaning: 'The role they were given' },
      { name: 'accept_url', meaning: 'The link that accepts the invitation' },
    ],
  },
];

/**
 * What a workspace can rewrite, in the order the settings screen shows it.
 *
 * `verify_email`, `reset_password` and `welcome` are deliberately absent: those are sent by
 * the authentication server before a session exists, so they go through the project's own
 * mailer — which is pointed at Resend's SMTP relay, see the README.
 */
export const TEMPLATE_KEYS: TemplateKeyInfo[] = KEY_INFO;

export const OVERRIDABLE_KEYS = new Set(TEMPLATE_KEYS.map((info) => info.key));

/** The workspace's own version of one letter, or null when it wants ours. */
export async function templateOverride(orgId: string, key: string): Promise<OverrideRow | null> {
  if (!OVERRIDABLE_KEYS.has(key)) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('email_templates')
    .select('subject, html_body, text_body, enabled')
    .eq('org_id', orgId)
    .eq('key', key)
    .maybeSingle();

  const row = (data ?? null) as (OverrideRow & { enabled: boolean }) | null;
  if (!row || !row.enabled) return null;
  return { subject: row.subject, html_body: row.html_body, text_body: row.text_body };
}

/**
 * `{{code}}`, `{{ code }}` — both are filled; a token this letter does not carry is left
 * exactly as written, because a template that shows `{{price}}` is a mistake the workspace can
 * see and fix, and one that silently shows nothing is not.
 */
export function fillTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name: string) => tokens[name.toLowerCase()] ?? whole);
}

/** Line after line of text, with the bare URLs made clickable. Input must already be escaped. */
function blocks(escaped: string): string {
  const withLinks = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" style="color:#2E6BE6">${url}</a>`);
  return withLinks
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * The letter as the workspace wrote it, inside the same card as ours.
 *
 * The token values are substituted before anything is escaped, so a customer called
 * `Ada <script>` arrives as text rather than as a tag, and a `text_body` the workspace left
 * empty falls back to the same wording with the markup removed by construction.
 */
export function renderOverride(base: Base, row: OverrideRow, tokens: Record<string, string>): RenderedMail {
  const subject = fillTokens(row.subject, tokens).trim().slice(0, 200);
  const body = fillTokens(row.html_body, tokens);
  const text = row.text_body && row.text_body.trim() !== '' ? fillTokens(row.text_body, tokens) : body;

  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: text.replace(/\s+/g, ' ').trim().slice(0, 110),
      heading: subject === '' ? base.brand : subject,
      bodyHtml: blocks(escapeHtml(body)),
      footer: base.footer,
    }),
    text,
  };
}

/**
 * The letter that actually goes out.
 *
 * One read per send, on a unique index, and it never throws: a database that cannot answer
 * about wording is not a reason to lose a booking confirmation, so the built-in letter stands.
 */
export async function resolveMail(input: {
  orgId: string;
  template: string;
  brand: string;
  tokens?: Record<string, string>;
  builtIn: RenderedMail;
}): Promise<RenderedMail> {
  if (!input.tokens) return input.builtIn;
  const row = await templateOverride(input.orgId, input.template);
  if (!row) return input.builtIn;
  return renderOverride(mailBase(input.brand), row, input.tokens);
}

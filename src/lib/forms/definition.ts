import {
  fieldIsVisible,
  isPresentational,
  type FormFieldDef,
  type FormSettings,
} from './types';

/**
 * Reading a form's answers, in the three shapes the product needs: the order the
 * builder shows, the subset a visitor actually saw, and the flat label/value text
 * a table, a CSV or an email is made of.
 *
 * `settings.field_order` is written by the drag-sort in the builder and decides
 * presentation only; `fields` stays the source of truth for content, so a field
 * that has never been moved needs no entry here.
 */
export function orderedFields(fields: FormFieldDef[], order: string[] | undefined): FormFieldDef[] {
  if (!order?.length) return fields;
  const byId = new Map(fields.map((field) => [field.id, field]));
  const sorted: FormFieldDef[] = [];
  for (const id of order) {
    const field = byId.get(id);
    if (field) {
      sorted.push(field);
      byId.delete(id);
    }
  }
  // Anything added after the last save keeps its place at the end rather than
  // vanishing because an older ordering did not know about it.
  for (const field of fields) if (byId.has(field.id)) sorted.push(field);
  return sorted;
}

/** The order to store after a drag-sort: ids only, in the new sequence. */
export function fieldOrderOf(fields: FormFieldDef[]): string[] {
  return fields.map((field) => field.id);
}

/**
 * A form past its `close_at` stops taking responses on both sides: the page shows a
 * notice instead of a submit button, and the route refuses the post anyway, so a
 * visitor holding the form open from before the deadline cannot slip one in.
 */
export function isFormClosed(closeAt: string | null, now = new Date()): boolean {
  if (!closeAt) return false;
  const at = Date.parse(closeAt);
  return Number.isFinite(at) && at <= now.getTime();
}

/**
 * Fields whose logic says they were on screen for these answers. A hidden field's
 * answer is not trusted — the required check, the stored row and the notification
 * all use this list, which is why the same helper runs in the browser.
 */
export function visibleFields(fields: FormFieldDef[], answers: Record<string, unknown>): FormFieldDef[] {
  return fields.filter((field) => fieldIsVisible(field, answers));
}

export function answerValue(field: FormFieldDef, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter(Boolean).join(', ');
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (field.type === 'rating') return raw === '' ? '' : `${raw} / 5`;
  if (field.type === 'rupees') return raw === '' ? '' : `₹${raw}`;
  return String(raw);
}

/** Collecting fields only, in the order given, with the answer as text. */
export function answerSummary(
  fields: FormFieldDef[],
  answers: Record<string, unknown>,
): { label: string; value: string }[] {
  return fields
    .filter((field) => !isPresentational(field.type))
    .map((field) => ({ label: field.label || field.id, value: answerValue(field, answers[field.id]) }));
}

const CSV_ESCAPE = /[",\n\r]/;

function csvCell(value: string): string {
  return CSV_ESCAPE.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Export for the responses table. The header is every collecting field in display
 * order plus the metadata columns, and it is derived from the form rather than
 * from the rows, so a response that skipped an optional field still lands in the
 * right column instead of shifting everything left.
 */
export function submissionsCsv(
  fields: FormFieldDef[],
  settings: FormSettings,
  submissions: { id: string; created_at: string; state: string; submitter_email: string | null; data: Record<string, unknown> }[],
): string {
  const collecting = orderedFields(fields, settings.field_order).filter((field) => !isPresentational(field.type));
  const head = ['Submitted at', 'State', 'Email', ...collecting.map((field) => field.label || field.id)];
  const lines = [head.map(csvCell).join(',')];

  for (const submission of submissions) {
    const cells = [
      submission.created_at,
      submission.state,
      submission.submitter_email ?? '',
      ...collecting.map((field) => answerValue(field, submission.data?.[field.id])),
    ];
    lines.push(cells.map(csvCell).join(','));
  }

  // The BOM is what makes Excel read UTF-8 answers instead of mojibake.
  return `﻿${lines.join('\r\n')}\r\n`;
}

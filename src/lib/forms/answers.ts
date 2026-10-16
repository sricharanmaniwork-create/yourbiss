import { z } from 'zod';
import { fieldIsVisible, isPresentational, type FormFieldDef } from './types';
import { orderedFields } from './definition';

/**
 * Validating an answer set for a published form.
 *
 * The rule that shapes everything here is that conditional logic is evaluated
 * against the answers as they arrived, and a field the visitor never saw is
 * neither required nor stored. That is the one thing the database cannot judge on
 * its own, so this module — not a policy — is where a submission is checked.
 *
 * The public form component validates with this same function, so the wording a
 * visitor sees in the browser is the wording the route would have answered with.
 */

/** Guards against a payload stuffed with unrelated keys. */
export const MAX_ANSWER_KEYS = 200;

export interface AnswerCheck {
  /** Only the fields that were on screen, with their answers normalised. */
  values: Record<string, unknown>;
  errors: Record<string, string>;
  /** The field id holding an email address, so the row can be indexed by it. */
  emailFieldId: string | null;
}

export function checkAnswers(
  fields: FormFieldDef[],
  order: string[] | undefined,
  answers: Record<string, unknown>,
): AnswerCheck {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  let emailFieldId: string | null = null;

  const shown = orderedFields(fields, order).filter((field) => fieldIsVisible(field, answers));

  for (const field of shown) {
    if (isPresentational(field.type)) continue;
    if (field.type === 'email' && !emailFieldId) emailFieldId = field.id;

    const raw = answers[field.id];
    const empty = isEmptyAnswer(raw);

    if (empty) {
      // "Tick this to continue" reads better than "Field is required" for a
      // consent box, and the field already carries that message.
      if (field.required) errors[field.id] = messageFor(field, `${field.label || 'This field'} is required`);
      continue;
    }

    const result = schemaFor(field).safeParse(raw);
    if (!result.success) {
      errors[field.id] = messageFor(field, result.error.issues[0]?.message ?? 'Check this answer');
      continue;
    }
    values[field.id] = result.data;
  }

  return { values, errors, emailFieldId };
}

function messageFor(field: FormFieldDef, fallback: string): string {
  return field.validation?.message?.trim() ? field.validation.message : fallback;
}

function isEmptyAnswer(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw === 'boolean') return raw === false;
  return false;
}

const trimToString = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/**
 * Every schema here runs on a value already known not to be empty, so each one
 * only has to say whether the shape is right.
 */
function schemaFor(field: FormFieldDef): z.ZodTypeAny {
  const label = field.label || 'This field';
  const v = field.validation ?? {};

  switch (field.type) {
    case 'text':
    case 'name':
      return z
        .preprocess(trimToString, z.string().min(1).max(v.max_len ?? 2000))
        .refine((s) => !v.min_len || s.length >= v.min_len, `Use at least ${v.min_len} characters`)
        .refine((s) => !v.pattern || safePattern(v.pattern).test(s), `“${label}” is not in the expected format`);

    case 'textarea':
    case 'address':
      return z
        .preprocess(trimToString, z.string().min(1).max(v.max_len ?? 8000))
        .refine((s) => !v.min_len || s.length >= v.min_len, `Use at least ${v.min_len} characters`);

    case 'email':
      return z.preprocess(trimToString, z.string().email('Enter an email address like you@example.com').max(320));

    case 'phone':
      return z.preprocess(trimToString, z.string().regex(/^[+0-9 ()\-.]{5,32}$/, 'Enter a valid phone number'));

    case 'url':
      return z.preprocess(trimToString, z.string().url('Enter a full web address, https:// included').max(600));

    case 'number':
    case 'rupees':
      return z
        .union([z.coerce.number(), z.string()])
        .transform((n) => (typeof n === 'string' ? Number(n) : n))
        .refine((n) => Number.isFinite(n), `Enter a number`)
        .refine((n) => v.min === undefined || n >= v.min, `Must be at least ${v.min}`)
        .refine((n) => v.max === undefined || n <= v.max, `Must be at most ${v.max}`);

    case 'date':
      return z
        .preprocess(trimToString, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date'))
        .refine(isRealDate, 'Enter a real date');

    case 'time':
      return z
        .preprocess(trimToString, z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'))
        .refine((t) => {
          const parts = t.split(':');
          return Number(parts[0]) <= 23 && Number(parts[1]) <= 59;
        }, 'Enter a time between 00:00 and 23:59');

    case 'rating':
      return z.coerce.number().int('Choose a whole number').min(1, `Choose ${label}`).max(5);

    case 'checkbox_single':
      // The only field where the answer is the consent itself: anything but a
      // tick fails, and the field's own message explains why.
      return z.union([z.literal(true), z.literal('true'), z.literal('1'), z.literal('on')]);

    case 'select':
    case 'radio': {
      const allowed = optionValues(field);
      return allowed.length > 0
        ? z
            .preprocess(trimToString, z.string())
            .refine((s) => allowed.includes(s), `Choose one of the options given`)
        : z.preprocess(trimToString, z.string().max(400));
    }

    case 'checkbox':
    case 'multiselect': {
      const allowed = optionValues(field);
      return z
        .union([z.array(z.union([z.string(), z.number()])), z.string()])
        .transform((list) => (Array.isArray(list) ? list.map((x) => String(x).trim()) : [list.trim()]))
        .refine((list) => list.every((x) => x !== '' && (!allowed.length || allowed.includes(x))), `Only use the options given`)
        .refine((list) => new Set(list).size === list.length, 'The same option cannot be chosen twice');
    }

    default:
      return z.unknown();
  }
}

function optionValues(field: FormFieldDef): string[] {
  return (field.options ?? []).map((o) => String(o.value ?? '')).filter((x) => x !== '');
}

function safePattern(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch {
    return /.^/;
  }
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A stored answer key must be a field the form defines, whatever the visitor sends. */
export function unexpectedAnswerKeys(fields: FormFieldDef[], answers: Record<string, unknown>): string | null {
  const known = new Set(fields.map((field) => field.id));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) return `Unexpected answer "${key.slice(0, 40)}"`;
  }
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) return 'Too many answers in one submission';
  return null;
}

/**
 * The email address to notify, and to hash into the visitor key. Taken from the
 * field the form actually asks the question with — a contact form and a booking
 * enquiry both put it somewhere different.
 */
export function emailAnswerOf(values: Record<string, unknown>, emailFieldId: string | null): string | null {
  if (!emailFieldId) return null;
  const value = values[emailFieldId];
  return typeof value === 'string' && value.includes('@') ? value.toLowerCase() : null;
}

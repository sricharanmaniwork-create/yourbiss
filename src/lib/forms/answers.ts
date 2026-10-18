import { z } from 'zod';
import {
  choiceValues,
  collectsMany,
  COMPOSITE_PART_MAX_CHARS,
  compositeParts,
  fieldIsVisible,
  isComposite,
  isPresentational,
  partValue,
  SIGNATURE_MAX_CHARS,
  type FormFieldDef,
} from './types';
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

    // A page that was open across the change still posts one box of text for a field
    // that now has parts. Filling every part with nothing would record an empty answer
    // and call it a submission, so the visitor is told to reload instead.
    if (isComposite(field.type) && typeof raw === 'string') {
      errors[field.id] = `“${field.label || 'This field'}” is answered part by part now. Reload the page and answer again.`;
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
  // A matrix, a decision or a location arrives as an object; it counts as
  // unanswered only when every one of its parts is empty.
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).every((part) => isEmptyAnswer(part));
  }
  return false;
}

const trimToString = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

/** A payload that should have been a part-object arrives as anything; read it as `{}`. */
const asRecord = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function isNumericText(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim());
}

/** `0.3` steps against a `4` answer are a rounding question, not a wrong one. */
function isOnStep(value: number, from: number, step: number): boolean {
  const offBy = Math.abs((value - from) / step - Math.round((value - from) / step));
  return offBy < 1e-6;
}

/**
 * Every schema here runs on a value already known not to be empty, so each one
 * only has to say whether the shape is right.
 */
function schemaFor(field: FormFieldDef): z.ZodTypeAny {
  const label = field.label || 'This field';
  const v = field.validation ?? {};

  switch (field.type) {
    case 'text':
      return z
        .preprocess(trimToString, z.string().min(1).max(v.max_len ?? 2000))
        .refine((s) => !v.min_len || s.length >= v.min_len, `Use at least ${v.min_len} characters`)
        .refine((s) => !v.pattern || safePattern(v.pattern).test(s), `“${label}” is not in the expected format`);

    case 'textarea':
      return z
        .preprocess(trimToString, z.string().min(1).max(v.max_len ?? 8000))
        .refine((s) => !v.min_len || s.length >= v.min_len, `Use at least ${v.min_len} characters`);

    case 'name':
    case 'address': {
      const parts = compositeParts(field);
      return z
        .preprocess(asRecord, z.record(z.string(), z.unknown()))
        .refine((o) => Object.keys(o).every((key) => parts.includes(key)), `Only answer the parts “${label}” shows`)
        .transform((o) => Object.fromEntries(parts.map((part) => [part, partValue(o, part)])))
        .refine(
          (o) => Object.values(o).every((value) => value.length <= COMPOSITE_PART_MAX_CHARS),
          `Keep each part of “${label}” under ${COMPOSITE_PART_MAX_CHARS} characters`,
        )
        .refine((o) => !v.max_len || Object.values(o).join(' ').length <= v.max_len, `Use at most ${v.max_len} characters`)
        .refine(
          // A required composite wants what it shows: the parts are the question, and
          // switching one on in the builder is what makes it an answer the app needs.
          (o) => !field.required || parts.every((part) => o[part] !== ''),
          `Fill in every part of “${label}”`,
        );
    }

    case 'email':
      return z.preprocess(trimToString, z.string().email('Enter an email address like you@example.com').max(320));

    case 'phone':
      return z.preprocess(trimToString, z.string().regex(/^[+0-9 ()\-.]{5,32}$/, 'Enter a valid phone number'));

    case 'url':
      return z.preprocess(trimToString, z.string().url('Enter a full web address, https:// included').max(600));

    case 'number':
    case 'rupees':
    case 'currency':
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

    case 'datetime':
      return z
        .preprocess(trimToString, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a date and time'))
        .refine((s) => {
          const [day, clock] = s.split('T');
          const [hh, mm] = clock!.split(':').map(Number);
          return isRealDate(day!) && hh! <= 23 && mm! <= 59;
        }, 'Enter a real date and time');

    case 'monthyear':
      return z
        .preprocess(trimToString, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month and year'))
        .refine((s) => {
          const year = Number(s.slice(0, 4));
          return year >= 1900 && year <= 2200;
        }, 'Enter a year between 1900 and 2200');

    case 'time':
      return z
        .preprocess(trimToString, z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'))
        .refine((t) => {
          const parts = t.split(':');
          return Number(parts[0]) <= 23 && Number(parts[1]) <= 59;
        }, 'Enter a time between 00:00 and 23:59');

    case 'rating': {
      const min = field.rating?.min ?? 1;
      const max = field.rating?.max ?? 5;
      return z
        .coerce.number()
        .int('Choose a whole number')
        .refine((n) => n >= min && n <= max, `Choose a rating between ${min} and ${max}`);
    }

    case 'slider': {
      const min = v.min ?? 0;
      const max = v.max ?? 100;
      const step = field.slider?.step ?? 1;
      return z
        .coerce.number()
        .refine((n) => Number.isFinite(n), 'Move the slider to a value')
        .refine((n) => n >= min && n <= max, `Choose a value between ${min} and ${max}`)
        .refine((n) => isOnStep(n, min, step), 'That value is not on the slider');
    }

    case 'signature':
      // The answer is the drawing itself, held as a small base64 image so a
      // response row stays a single, exportable value.
      return z
        .preprocess(trimToString, z.string())
        .refine((s) => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s), 'Draw your signature in the box')
        .refine((s) => s.length <= SIGNATURE_MAX_CHARS, 'That signature is too large to store');

    case 'yes_or_no':
      return z
        .preprocess(trimToString, z.string())
        .refine((s) => s === 'yes' || s === 'no', 'Choose Yes or No');

    case 'decision': {
      const askReason = field.decision?.ask_reason ?? false;
      return z
        .preprocess(asRecord, z.object({ value: z.unknown().optional(), reason: z.unknown().optional() }))
        .transform((d) => ({
          value: typeof d.value === 'string' ? d.value.trim() : '',
          reason: typeof d.reason === 'string' ? d.reason.trim() : '',
        }))
        .refine((d) => d.value === 'approve' || d.value === 'reject', `Choose ${field.decision?.approve ?? 'approve'} or ${field.decision?.reject ?? 'reject'}`)
        .refine((d) => d.reason.length <= 2000, 'That reason is too long')
        .refine((d) => !askReason || d.reason !== '', 'Say why');
    }

    case 'matrix': {
      const rows = (field.matrix?.rows ?? []).map((r) => String(r.value));
      const columns = new Set((field.matrix?.columns ?? []).map((c) => String(c.value)));
      return z
        .preprocess(asRecord, z.record(z.string(), z.unknown()))
        .transform((o) => Object.fromEntries(Object.entries(o).map(([k, val]) => [k, typeof val === 'string' ? val.trim() : val])))
        .refine((o) => Object.keys(o).every((k) => rows.includes(k)), 'Only answer the rows given')
        .refine((o) => Object.values(o).every((val) => typeof val === 'string' && columns.has(val)), 'Choose one of the columns for each row')
        .refine((o) => !field.required || rows.every((r) => o[r]), 'Answer every row');
    }

    case 'geolocation':
      // Coordinates only. Turning them into a street address needs a geocoding
      // service, and no answer is invented without one.
      return z
        .preprocess(asRecord, z.object({ lat: z.unknown(), lng: z.unknown(), accuracy: z.unknown().optional() }))
        .refine((p) => isNumericText(p.lat) && Number(p.lat) >= -90 && Number(p.lat) <= 90, 'Enter a latitude between -90 and 90')
        .refine((p) => isNumericText(p.lng) && Number(p.lng) >= -180 && Number(p.lng) <= 180, 'Enter a longitude between -180 and 180')
        .transform((p) => ({
          lat: Number(String(p.lat).trim()),
          lng: Number(String(p.lng).trim()),
          ...(isNumericText(p.accuracy) && Number(p.accuracy) >= 0 ? { accuracy: Number(String(p.accuracy).trim()) } : {}),
        }));

    case 'checkbox_single':
      // The only field where the answer is the consent itself: anything but a
      // tick fails, and the field's own message explains why.
      return z.union([z.literal(true), z.literal('true'), z.literal('1'), z.literal('on')]);

    case 'select':
    case 'radio':
    case 'checkbox':
    case 'multiselect':
    case 'image_choice': {
      const allowed = choiceValues(field);
      if (collectsMany(field)) {
        return z
          .union([z.array(z.union([z.string(), z.number()])), z.string()])
          .transform((list) => (Array.isArray(list) ? list.map((x) => String(x).trim()) : [list.trim()]))
          .refine((list) => list.every((x) => x !== '' && allowed.includes(x)), 'Only use the options given')
          .refine((list) => new Set(list).size === list.length, 'The same option cannot be chosen twice');
      }
      return z.preprocess(trimToString, z.string()).refine((s) => allowed.includes(s), 'Choose one of the options given');
    }

    default:
      return z.unknown();
  }
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

import { z } from 'zod';
import {
  activeRule,
  calculateOf,
  choiceValues,
  collectsMany,
  COMPOSITE_PART_MAX_CHARS,
  compositeParts,
  fieldIsVisible,
  fieldIsRequired,
  isComposite,
  isEmptyAnswer,
  isPresentational,
  kindCeiling,
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
 *
 * Two passes, on purpose. The first asks whether the answer is the right *shape* —
 * a date that is a date, a choice that was offered. The second asks whether it obeys
 * the form's *rules* — at least ten characters, not in the past, the same as the
 * address typed above. Shape belongs to zod, where each kind states what it accepts;
 * rules belong to `grammarError`, because several of them have to look at another
 * field's answer or at today's date, and zod refinements cannot reach either.
 *
 * A third thing happens after both: the answers a Calculate field is built from are all
 * settled, so its own answer is worked out here. Nothing on the page is trusted with it.
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

/**
 * `today` is the day where the workspace keeps its clock, as `YYYY-MM-DD`. It is
 * passed in rather than read from a clock because a "no past dates" rule judged by
 * the visitor's browser and by the server has to be judged against the same day, or
 * the same answer is accepted in one place and refused in the other.
 *
 * `page` is the set of questions a visitor is being asked right now, on a form that is
 * answered a page at a time. Every field is still read for the rules and for whether a
 * hidden question is hidden — a rule on page one can point at an answer on page three —
 * but only the page in hand is required, checked or reported. Without it, pressing Next
 * would tell somebody to fill in questions they have not reached.
 */
export function checkAnswers(
  fields: FormFieldDef[],
  order: string[] | undefined,
  answers: Record<string, unknown>,
  today: string,
  page?: Set<string>,
): AnswerCheck {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  let emailFieldId: string | null = null;

  const visible = orderedFields(fields, order).filter((field) => fieldIsVisible(field, answers, fields));
  const asking = page === undefined ? visible : visible.filter((field) => page.has(field.id));

  for (const field of asking) {
    // A Calculate field is asked for nothing: nobody types into it, and its answer is
    // written below, from the answers that passed their own checks.
    if (isPresentational(field.type) || field.type === 'formula') continue;
    if (field.type === 'email' && !emailFieldId) emailFieldId = field.id;

    const raw = answers[field.id];
    const empty = isEmptyAnswer(raw);

    if (empty) {
      // "Tick this to continue" reads better than "Field is required" for a
      // consent box, and the field already carries that message.
      if (fieldIsRequired(field, answers, fields)) errors[field.id] = messageFor(field, `${field.label || 'This field'} is required`);
      continue;
    }

    // A page that was open across the change still posts one box of text for a field
    // that now has parts. Filling every part with nothing would record an empty answer
    // and call it a submission, so the visitor is told to reload instead.
    if (isComposite(field.type) && typeof raw === 'string') {
      errors[field.id] = `“${field.label || 'This field'}” is answered part by part now. Reload the page and answer again.`;
      continue;
    }

    const result = schemaFor(field, fieldIsRequired(field, answers, fields)).safeParse(raw);
    if (!result.success) {
      errors[field.id] = messageFor(field, result.error.issues[0]?.message ?? 'Check this answer');
      continue;
    }
    values[field.id] = result.data;
  }

  // Rules run after every shape check, so one that compares two fields can read the
  // other answer whether it came before or after this one in the form. On a page of a
  // multi-page form that other answer may live on a page still to come or one already
  // left, so rules read every visible answer.
  const context: Record<string, unknown> = {};
  for (const field of visible) {
    // A calculated answer is written out below from the numbers here, so it is never read
    // into them — that would let whatever the browser sent for that key go into a sum.
    if (isPresentational(field.type) || field.type === 'formula') continue;
    if (field.id in values) {
      context[field.id] = values[field.id];
      continue;
    }
    // On the page being asked, an answer that failed its shape check or was left blank
    // is nothing a rule may lean on. On a page not in hand, the answer has not been
    // checked at all this pass, so it is read as typed.
    if (page === undefined || page.has(field.id)) continue;
    const typed = answers[field.id];
    if (typed !== undefined && !isEmptyAnswer(typed)) context[field.id] = typed;
  }

  for (const field of asking) {
    const value = values[field.id];
    if (value === undefined) continue;
    const failed = grammarError(field, value, context, fields, today);
    if (!failed) continue;
    delete values[field.id];
    errors[field.id] = messageFor(field, failed);
  }

  // The last thing done to a response is writing out its calculated answers, from the
  // numbers above that were accepted. A sum with no answer to write down — a division by
  // a figure that came out zero — is refused on that question rather than stored as a
  // guess, and the visitor is pointed at it to change the numbers it reads.
  for (const field of asking) {
    if (field.type !== 'formula') continue;
    const answer = calculateOf(field, context);
    if (answer === null) {
      errors[field.id] = messageFor(field, `“${field.label || 'This field'}” cannot be worked out from these answers`);
      continue;
    }
    values[field.id] = answer;
  }

  return { values, errors, emailFieldId };
}

function messageFor(field: FormFieldDef, fallback: string): string {
  return field.validation?.message?.trim() ? field.validation.message : fallback;
}

/**
 * Whether a shaped answer also obeys the rules the form was built with.
 *
 * Each rule is read through `activeRule`, which is what lets this stay a flat list:
 * a rule switched off, or parked on a kind Publish would not have accepted, reads as
 * `undefined` and asks for nothing.
 */
function grammarError(
  field: FormFieldDef,
  value: unknown,
  values: Record<string, unknown>,
  fields: FormFieldDef[],
  today: string,
): string | null {
  const label = field.label || 'This field';
  const text = typeof value === 'string' ? value : null;
  const chosen = Array.isArray(value) ? value : null;

  const minLen = activeRule(field, 'min_len');
  if (text !== null && minLen !== undefined && text.length < minLen) return `Use at least ${minLen} characters`;

  const maxLen = activeRule(field, 'max_len');
  if (text !== null && maxLen !== undefined && text.length > maxLen) return `Use at most ${maxLen} characters`;

  const minWords = activeRule(field, 'min_words');
  const maxWords = activeRule(field, 'max_words');
  if (text !== null && (minWords !== undefined || maxWords !== undefined)) {
    const words = wordCount(text);
    if (minWords !== undefined && words < minWords) return `Use at least ${minWords} words`;
    if (maxWords !== undefined && words > maxWords) return `Use at most ${maxWords} words`;
  }

  if (text !== null) {
    const lower = text.toLowerCase();
    for (const key of ['contains', 'starts_with', 'ends_with'] as const) {
      const wanted = activeRule(field, key);
      if (wanted === undefined) continue;
      const term = wanted.trim().toLowerCase();
      const holding = key === 'contains' ? lower.includes(term) : key === 'starts_with' ? lower.startsWith(term) : lower.endsWith(term);
      if (!holding) {
        const said = key === 'contains' ? 'include' : key === 'starts_with' ? 'start with' : 'end with';
        return `“${label}” must ${said} “${wanted.trim()}”`;
      }
    }

    const pattern = activeRule(field, 'pattern');
    if (pattern !== undefined && !safePattern(pattern).test(text)) return `“${label}” is not in the expected format`;
  }

  if (typeof value === 'number') {
    // A slider cannot be dragged past its own ends, so those two numbers are the
    // control, not a rule; on every other kind they are a rule the visitor can miss.
    if (field.type !== 'slider') {
      const min = activeRule(field, 'min');
      const max = activeRule(field, 'max');
      if (min !== undefined && value < min) return `Must be at least ${min}`;
      if (max !== undefined && value > max) return `Must be at most ${max}`;
    }

    const decimals = activeRule(field, 'decimals');
    if (decimals !== undefined && decimalPlaces(value) > decimals) {
      if (decimals === 0) return `${label} must be a whole number`;
      return `${label} can have ${decimals} digit${decimals === 1 ? '' : 's'} after the point`;
    }
  }

  if (text !== null) {
    const dayProblem = dayError(field, text, today);
    if (dayProblem) return dayProblem;
  }

  const minChoices = activeRule(field, 'min_choices');
  const maxChoices = activeRule(field, 'max_choices');
  if (chosen !== null && collectsMany(field)) {
    if (minChoices !== undefined && chosen.length < minChoices) return `Choose at least ${minChoices} of these`;
    if (maxChoices !== undefined && chosen.length > maxChoices) return `Choose at most ${maxChoices} of these`;
  }

  if (text !== null && field.type === 'email') {
    const domain = text.slice(text.lastIndexOf('@') + 1).toLowerCase();
    const blocked = activeRule(field, 'block_domains') ?? [];
    const hit = blocked.find((listed) => holdsDomain(domain, listed));
    if (hit) return `Please use an email address that is not at ${hit}`;
    const allowed = activeRule(field, 'allow_domains') ?? [];
    if (allowed.length > 0 && !allowed.some((listed) => holdsDomain(domain, listed))) {
      return `Please use an email address at ${allowed.join(' or ')}`;
    }
  }

  if (text !== null && field.type === 'phone') {
    const digits = text.replace(/\D/g, '');
    const minDigits = activeRule(field, 'min_digits');
    const maxDigits = activeRule(field, 'max_digits');
    if (minDigits !== undefined && digits.length < minDigits) return `Enter at least ${minDigits} digits`;
    if (maxDigits !== undefined && digits.length > maxDigits) return `Enter at most ${maxDigits} digits`;
    if (activeRule(field, 'need_country_code') && !text.startsWith('+')) return 'Start with the country code, like +91';
  }

  const twin = activeRule(field, 'same_as');
  if (twin !== undefined) {
    const other = fields.find((candidate) => candidate.id === twin);
    const wanted = values[twin];
    // No answer above to compare against — the other field was hidden, left blank or
    // itself wrong — is not this field's fault, so nothing is said here about it.
    if (other && wanted !== undefined && !sameAnswer(value, wanted)) {
      return `“${label}” must be the same as “${other.label || 'the field above'}”`;
    }
  }

  return null;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Digits after the point, read off the number as it was stored. */
function decimalPlaces(value: number): number {
  const text = String(Math.abs(value));
  const small = text.indexOf('e-');
  if (small !== -1) return Number(text.slice(small + 2)) || 0;
  const point = text.indexOf('.');
  return point === -1 ? 0 : text.slice(point + 1).length;
}

/**
 * A day rule judged against the day the workspace is living through.
 *
 * Compared as text, because `2026-04-01` sorts after `2026-03-31` without a date
 * library and a timezone in the way. A month field is judged on its month: April is
 * not "in the past" while it is still April.
 */
function dayError(field: FormFieldDef, value: string, today: string): string | null {
  if (field.type !== 'date' && field.type !== 'datetime' && field.type !== 'monthyear') return null;
  const width = field.type === 'monthyear' ? 7 : 10;
  const word = field.type === 'monthyear' ? 'month' : 'day';
  const given = value.slice(0, width);
  const now = today.slice(0, width);

  if (activeRule(field, 'no_past') && given < now) return `Choose a ${word} that is not in the past`;
  if (activeRule(field, 'no_future') && given > now) return `Choose a ${word} that is not in the future`;

  const minDay = activeRule(field, 'min_day');
  if (minDay !== undefined && given < minDay.slice(0, width)) return `Choose a ${word} on or after ${minDay.slice(0, width)}`;
  const maxDay = activeRule(field, 'max_day');
  if (maxDay !== undefined && given > maxDay.slice(0, width)) return `Choose a ${word} on or before ${maxDay.slice(0, width)}`;

  return null;
}

/** `gmail.com` covers `mail.gmail.com`, so a blocked company cannot be slipped past by its subdomain. */
function holdsDomain(domain: string, listed: string): boolean {
  return domain === listed || domain.endsWith(`.${listed}`);
}

/** Two answers that hold the same thing. Addresses and email are read without regard to case. */
function sameAnswer(one: unknown, other: unknown): boolean {
  if (typeof one === 'string' && typeof other === 'string') return one.trim().toLowerCase() === other.trim().toLowerCase();
  return one === other;
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
 *
 * `required` is whether the field is compulsory for *these* answers — it can come from
 * a rule rather than the checkbox — because a partial answer to a compulsory matrix or
 * composite is not an answer to it.
 */
function schemaFor(field: FormFieldDef, required: boolean): z.ZodTypeAny {
  const label = field.label || 'This field';
  const v = field.validation ?? {};

  switch (field.type) {
    case 'text':
      return z.preprocess(trimToString, z.string().min(1).max(kindCeiling(field), 'That answer is too long'));

    case 'textarea':
      return z.preprocess(trimToString, z.string().min(1).max(kindCeiling(field), 'That answer is too long'));

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
        .refine(
          // A required composite wants what it shows: the parts are the question, and
          // switching one on in the builder is what makes it an answer the app needs.
          (o) => !required || parts.every((part) => o[part] !== ''),
          `Fill in every part of “${label}”`,
        );
    }

    case 'email':
      return z.preprocess(trimToString, z.string().email('Enter an email address like you@example.com').max(kindCeiling(field)));

    case 'phone':
      return z.preprocess(trimToString, z.string().regex(/^[+0-9 ()\-.]{5,32}$/, 'Enter a valid phone number'));

    case 'url':
      return z.preprocess(trimToString, z.string().url('Enter a full web address, https:// included').max(kindCeiling(field)));

    case 'number':
    case 'rupees':
    case 'currency':
      // The size of the number is the form's rule, checked after the shape; all that
      // matters here is that an answer was a number at all.
      return z
        .union([z.coerce.number(), z.string()])
        .transform((n) => (typeof n === 'string' ? Number(n) : n))
        .refine((n) => Number.isFinite(n), `Enter a number`);

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
        .refine((o) => !required || rows.every((r) => o[r]), 'Answer every row');
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

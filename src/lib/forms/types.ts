import { z } from 'zod';
import {
  evaluateFormula,
  FORMULA_MAX_CHARS,
  formulaProblem,
  formulaReferences,
  numberAnswer,
} from './formula';

/**
 * Form field model. A form's `fields` array is the single document both the
 * builder UI and the public page render from, and the shape the server validates
 * a submission against.
 *
 * There is deliberately no file-upload field yet: an attachment needs a storage
 * bucket, a size and type limit, and a retention rule before an answer can hold
 * one.
 *
 * `formula` is the one kind whose answer the form writes itself. Nobody types into it, and
 * the number stored with a response is worked out on the server from the answers that
 * passed their own checks — whatever the browser sends under that key is dropped.
 *
 * The kinds below are chosen from what Zoho's own field registry can express, keeping
 * the ones this stack can serve without a vendor. Two of their types are intentionally
 * absent rather than faked: `SMART_SCAN` needs a document-reading model, and a payment
 * field needs a gateway — both wait until you decide on that dependency.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'rupees'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'monthyear'
  | 'time'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkbox_single'
  | 'multiselect'
  | 'image_choice'
  | 'matrix'
  | 'decision'
  | 'yes_or_no'
  | 'rating'
  | 'slider'
  | 'formula'
  | 'signature'
  | 'geolocation'
  | 'url'
  | 'name'
  | 'address'
  | 'section'
  | 'heading'
  | 'note'
  | 'divider'
  | 'spacer'
  | 'page_break';

/**
 * Fields that render but never collect an answer.
 *
 * `page_break` is one of these because it is a place in the form, not a question: the
 * answers a page holds are stored exactly as a single-page form stores them, and nothing
 * is recorded for the break itself.
 */
export const PRESENTATIONAL: FieldKind[] = ['section', 'heading', 'note', 'divider', 'spacer', 'page_break'];

export function isPresentational(kind: FieldKind): boolean {
  return PRESENTATIONAL.includes(kind);
}

/**
 * Answer kinds whose value is not a scalar. The responses table, the CSV and the
 * notification all flatten an answer to text, and these four are the shapes that
 * need a rule to do it — a matrix is a row-per-question, not a comma-separated list.
 */
export const STRUCTURED: FieldKind[] = ['matrix', 'decision', 'geolocation'];

export function isStructured(kind: FieldKind): boolean {
  return STRUCTURED.includes(kind);
}

/**
 * Fields whose answer is one object of named parts — a name is a title and a surname, an
 * address is a street and a PIN, and neither is a string somebody split with a comma.
 *
 * The parts a field shows are the parts it stores, and a required composite wants every
 * one of them: switching on "Middle name" and leaving the field required is a decision
 * the builder makes where the visitor can see it, not a box hidden inside the answer.
 */
export const COMPOSITE: FieldKind[] = ['name', 'address'];

export type NamePart = 'prefix' | 'first' | 'middle' | 'last' | 'suffix';
export type AddressPart = 'line1' | 'line2' | 'city' | 'state' | 'zip' | 'country';

export const NAME_PARTS: readonly NamePart[] = ['prefix', 'first', 'middle', 'last', 'suffix'];
export const ADDRESS_PARTS: readonly AddressPart[] = ['line1', 'line2', 'city', 'state', 'zip', 'country'];

export const NAME_PART_LABELS: Record<NamePart, string> = {
  prefix: 'Title',
  first: 'First name',
  middle: 'Middle name',
  last: 'Last name',
  suffix: 'Suffix',
};

export const ADDRESS_PART_LABELS: Record<AddressPart, string> = {
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  state: 'State / District',
  zip: 'PIN / Postal code',
  country: 'Country',
};

/** A composite's parts switch on a saved field the builder never opened — and the
 * inspector seeds from these, so the object it writes always holds every part. */
export const NAME_PARTS_DEFAULT: Record<NamePart, boolean> = {
  prefix: false,
  first: true,
  middle: false,
  last: true,
  suffix: false,
};

export const ADDRESS_PARTS_DEFAULT: Record<AddressPart, boolean> = {
  line1: true,
  line2: false,
  city: true,
  state: true,
  zip: true,
  country: true,
};

export function isComposite(kind: FieldKind): boolean {
  return COMPOSITE.includes(kind);
}

/** The parts this field asks for and stores, in the order the form shows them. */
export function compositeParts(field: FormFieldDef): string[] {
  if (field.type === 'name') {
    const on = field.name_parts;
    return NAME_PARTS.filter((part) => (on ? on[part] : NAME_PARTS_DEFAULT[part]));
  }
  if (field.type === 'address') {
    // Country is a part somebody types, not a dropdown: a list of countries would have
    // to arrive with a list of states for every one of them, and a half-filled dropdown
    // is worse than a box that accepts any country spelled any way.
    const on = field.address_parts;
    return ADDRESS_PARTS.filter((part) => (on ? on[part] : ADDRESS_PARTS_DEFAULT[part]));
  }
  return [];
}

/** What each part of a composite reads as, on screen and in an export. */
export function partLabel(field: FormFieldDef, part: string): string {
  if (field.type === 'name') return NAME_PART_LABELS[part as NamePart] ?? part;
  if (field.type === 'address') return ADDRESS_PART_LABELS[part as AddressPart] ?? part;
  return part;
}

/** One part of a composite answer, blank read as `''` so the emptiness rule has one shape. */
export function partValue(raw: unknown, part: string): string {
  if (typeof raw === 'string') return part === 'first' || part === 'line1' ? raw.trim() : '';
  if (!raw || typeof raw !== 'object') return '';
  const value = (raw as Record<string, unknown>)[part];
  return typeof value === 'string' ? value.trim() : '';
}

/** Kinds whose choices the builder edits as one list. `matrix` is not in here: its rows
 * and columns are two axes, not a choice list. */
export const OPTION_BEARING: FieldKind[] = ['select', 'radio', 'checkbox', 'multiselect', 'image_choice'];

/** Kinds that hold exactly one answer out of the choices they are given. */
export const SINGLE_CHOICE: FieldKind[] = ['select', 'radio', 'image_choice', 'yes_or_no', 'decision'];

/**
 * Whether the answer is a list rather than one value. Everything that checks an
 * answer — required, allowed options, length ranges — has to know which of the two
 * it is holding, and a `checkbox` field and an `image_choice` field configured as a
 * pick-many hold the same shape.
 */
export function collectsMany(field: FormFieldDef): boolean {
  if (field.type === 'checkbox' || field.type === 'multiselect') return true;
  return field.type === 'image_choice' && field.choice_style === 'checkbox';
}

/**
 * The values a field will accept as its answer. For a choice list that is the
 * options; `yes_or_no` and `decision` carry their two answers in props instead, so
 * the tokens are fixed here and the labels come from the field.
 */
export function choiceValues(field: FormFieldDef): string[] {
  if (field.type === 'yes_or_no') return ['yes', 'no'];
  if (field.type === 'decision') return ['approve', 'reject'];
  return (field.options ?? []).map((o) => String(o.value ?? '')).filter((v) => v !== '');
}

/** What each accepted value reads as on screen and in an export. */
export function choiceLabel(field: FormFieldDef, value: string): string {
  if (field.type === 'yes_or_no') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value;
  if (field.type === 'decision') {
    if (value === 'approve') return field.decision?.approve || 'Approve';
    if (value === 'reject') return field.decision?.reject || 'Reject';
    return value;
  }
  return field.options?.find((o) => String(o.value) === value)?.label ?? value;
}

export type RatingSymbol = 'number' | 'star' | 'heart' | 'thumb' | 'smiley';

/**
 * Which kinds each rule in `FieldValidation` can be put on.
 *
 * Publish refuses a rule the validator would never read, so a form cannot promise a
 * check it does not perform — the builder only offers these, and the server enforces
 * the same list whatever a hand-edited definition tries to store.
 */
/**
 * The kinds each rule below may sit on. Kept here rather than repeated in the
 * builder and the validator, so the knobs on screen and the checks on the server
 * cannot drift apart.
 */
const LENGTH_KINDS: FieldKind[] = ['text', 'textarea', 'email', 'phone', 'url'];
const WORD_KINDS: FieldKind[] = ['text', 'textarea'];
const PATTERN_KINDS: FieldKind[] = ['text', 'textarea'];
const TEXT_RULE_KINDS: FieldKind[] = ['text', 'textarea'];
const DECIMAL_KINDS: FieldKind[] = ['number', 'rupees', 'currency', 'formula'];
const RANGE_KINDS: FieldKind[] = ['number', 'rupees', 'currency', 'slider'];
const DAY_KINDS: FieldKind[] = ['date', 'datetime', 'monthyear'];
const MANY_CHOICE_KINDS: FieldKind[] = ['checkbox', 'multiselect', 'image_choice'];
const DOMAIN_KINDS: FieldKind[] = ['email'];
const PHONE_RULE_KINDS: FieldKind[] = ['phone'];

/**
 * A field whose answer can be held to the same answer as another field's. Only kinds
 * that store one comparable value are in here: two matrices or two signatures cannot
 * "match" in a way anybody would recognise.
 */
const SAME_AS_KINDS: FieldKind[] = ['text', 'email', 'phone', 'url', 'number', 'rupees', 'select', 'radio'];

export interface FieldValidation {
  min_len?: number;
  max_len?: number;
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
  min_words?: number;
  max_words?: number;
  /** Compared ignoring case, against the answer as typed. */
  contains?: string;
  starts_with?: string;
  ends_with?: string;
  /** Digits after the point. `0` is a whole number. */
  decimals?: number;
  /** Day window, for the kinds that hold a day. */
  no_past?: boolean;
  no_future?: boolean;
  min_day?: string;
  max_day?: string;
  min_choices?: number;
  max_choices?: number;
  /** Email, matched against the lower-cased part after the `@`. */
  allow_domains?: string[];
  block_domains?: string[];
  /** Phone, counted on the digits alone. */
  min_digits?: number;
  max_digits?: number;
  need_country_code?: boolean;
  /** A field id of the same type: the two answers must be typed the same. */
  same_as?: string;
}

export interface MatrixAxes {
  rows: FieldOption[];
  columns: FieldOption[];
}

export interface FieldOption {
  label: string;
  value: string;
  /**
   * Choices sharing a group name render as an `<optgroup>` in a dropdown and as a
   * titled block in a choice list. The value stays what is stored — grouping is
   * presentation, and renaming a group must not silently rewrite answers.
   */
  group?: string;
  /** `image_choice` only: the picture a visitor picks instead of reading a label. */
  image_url?: string;
}

export type LogicOperator =
  | 'is' | 'is_not' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_filled' | 'gt' | 'lt' | 'before' | 'after';

/** Kinds whose answer is a number, so a rule can be told to compare it with one. */
const NUMERIC_SOURCES: readonly FieldKind[] = ['number', 'rupees', 'currency', 'rating', 'slider'];

/**
 * Whether a question of this kind can go into a sum. The same list a `gt` or `lt` rule
 * may read, and a Calculate field's answer is deliberately not in it: one sum working
 * out another would have to be answered in order, and a form is not a spreadsheet.
 */
export function isCalculableAnswer(kind: FieldKind): boolean {
  return NUMERIC_SOURCES.includes(kind);
}

/** Kinds whose answer is a day or a month, so a rule can be told before or after one. */
const DAY_SOURCES: readonly FieldKind[] = ['date', 'datetime', 'monthyear', 'time'];

/** Kinds whose answer is a single written value, so a rule can be told how it opens or ends. */
const WRITTEN_SOURCES: readonly FieldKind[] = ['text', 'textarea', 'email', 'phone', 'url', 'name', 'address', 'select', 'radio'];

export interface LogicCondition {
  field_id: string;
  operator: LogicOperator;
  value?: string;
  /** Which part of a name or address to read. Only legal when that is the source. */
  part?: string;
}

/**
 * What a matched rule does to this question.
 *
 * `show` and `hide` decide whether the question is asked at all — a hidden field is
 * never required and its answer is never stored. `require` asks the question as usual
 * but makes an answer compulsory, which is what an office wants when a box only
 * matters once a particular choice has been made.
 */
export interface FieldLogic {
  action: 'show' | 'hide' | 'require';
  match: 'all' | 'any';
  conditions: LogicCondition[];
}

/** The kinds each rule operator can be pointed at, and the wording for when it cannot. */
const LOGIC_SOURCE_KINDS: Partial<Record<LogicOperator, readonly FieldKind[]>> = {
  gt: NUMERIC_SOURCES,
  lt: NUMERIC_SOURCES,
  before: DAY_SOURCES,
  after: DAY_SOURCES,
  starts_with: WRITTEN_SOURCES,
  ends_with: WRITTEN_SOURCES,
};

/** `is empty` and `is filled` read the answer alone, so they are given nothing to compare with. */
const VALUELESS_OPERATORS: LogicOperator[] = ['is_empty', 'is_filled'];

export function logicOperatorNeedsValue(operator: LogicOperator): boolean {
  return !VALUELESS_OPERATORS.includes(operator);
}

/** Whether an operator can be pointed at a question of this kind. */
export function logicOperatorFits(kind: FieldKind, operator: LogicOperator): boolean {
  const kinds = LOGIC_SOURCE_KINDS[operator];
  return kinds ? kinds.includes(kind) : true;
}

/** The rules a condition can use, in the order the builder lists them. */
export const LOGIC_OPERATORS: LogicOperator[] = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_filled',
  'gt',
  'lt',
  'before',
  'after',
];

/**
 * Each one reads as a verb phrase, because the builder puts it after the question name
 * and a Publish refusal quotes it the same way: "asks “Joining date” whether it is
 * earlier than".
 */
export const LOGIC_OPERATOR_LABELS: Record<LogicOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_empty: 'is empty',
  is_filled: 'is answered',
  gt: 'is more than',
  lt: 'is less than',
  before: 'is earlier than',
  after: 'is later than',
};

/** A rule is typed in the shape the answer it reads is stored in. */
const LOGIC_VALUE_HINTS: Partial<Record<FieldKind, string>> = {
  number: '10',
  rupees: '1000',
  currency: '1000',
  rating: '3',
  slider: '40',
  date: '2026-03-04',
  datetime: '2026-03-04T09:30',
  monthyear: '2026-03',
  time: '14:30',
};

export function logicValuePlaceholder(kind: FieldKind | null): string {
  return (kind === null ? undefined : LOGIC_VALUE_HINTS[kind]) ?? 'the answer';
}

export interface FormFieldDef {
  id: string;
  type: FieldKind;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: FieldOption[];
  validation?: FieldValidation;
  logic?: FieldLogic;
  width?: 'full' | 'half';
  /** Drawn before or after the input, for a code or a unit the answer cannot carry. */
  prefix?: string;
  suffix?: string;
  /** Filled in before the visitor touches the field, and stored as their answer. */
  default_value?: string;
  /**
   * `formula` only: the sum its answer is worked out from — numbers, other questions in
   * braces, and `+ - * / ( )`. `formula.ts` is what reads it, in the browser and on the
   * server alike.
   */
  formula?: string;
  /** `image_choice` only: pick one, or pick as many as you like. */
  choice_style?: 'radio' | 'checkbox';
  /** A dropdown long enough to need a search box inside it. */
  searchable?: boolean;
  /** Radio and checkbox choices laid out side by side instead of stacked. */
  inline_choices?: boolean;
  /** `currency` only. A symbol is display, never data — the answer stays a number. */
  currency_symbol?: string;
  rating?: { min: number; max: number; symbol: RatingSymbol };
  slider?: { step: number; show_value: boolean };
  matrix?: MatrixAxes;
  decision?: { approve: string; reject: string; ask_reason: boolean };
  /** `name` only: the parts shown and stored. */
  name_parts?: Partial<Record<NamePart, boolean>>;
  /** `address` only: the parts shown and stored. */
  address_parts?: Partial<Record<AddressPart, boolean>>;
}

/** A part longer than this is somebody pasting a paragraph into one box of it. */
export const COMPOSITE_PART_MAX_CHARS = 200;

/** A matrix wider than this is a spreadsheet, not a form question. */
export const MATRIX_MAX_ROWS = 20;
export const MATRIX_MAX_COLUMNS = 10;

/**
 * A signature is stored as a PNG data URL inside the answer, so its length is the whole
 * budget: 40,000 characters is about 29 KB of image, which is a signature pad at
 * readable resolution and nowhere near enough to smuggle a document through.
 */
export const SIGNATURE_MAX_CHARS = 40000;

/**
 * The longest answer each kind can hold at all, whatever a form asks for. These come
 * from the columns and the shapes the validator reads, not from a rule somebody typed.
 */
const ANSWER_CEILING: Partial<Record<FieldKind, number>> = {
  text: 2000,
  textarea: 8000,
  email: 320,
  url: 600,
  phone: 32,
};

/**
 * The longest answer this kind can hold at all — a structural limit, the same for
 * every form, and the ceiling the server validates against.
 */
export function kindCeiling(field: FormFieldDef): number {
  return ANSWER_CEILING[field.type] ?? 2000;
}

/**
 * The character limit to put on the box a visitor types into: the kind's own, lowered
 * by the form's maximum when the form asks for less. Stopping the keystroke is the
 * kind-agnostic part; the rule itself still reports its own wording on the server.
 */
export function answerCeiling(field: FormFieldDef): number {
  const wanted = activeRule(field, 'max_len');
  return typeof wanted === 'number' ? Math.min(kindCeiling(field), wanted) : kindCeiling(field);
}

const logicOperatorEnum = z.enum([
  'is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'is_empty', 'is_filled', 'gt', 'lt', 'before', 'after',
]);

/**
 * The kinds each rule may sit on, and the word Publish uses when it says it may not.
 *
 * `answers.ts` reads a rule only for the kinds on the left, so a rule parked on
 * anything else would be a form promising a check it never runs. The builder draws
 * its boxes from the same table, which is why a knob cannot appear that does nothing.
 */
const RULE_KINDS: Partial<Record<keyof FieldValidation, { kinds: readonly FieldKind[]; word: string }>> = {
  min_len: { kinds: LENGTH_KINDS, word: 'character count' },
  max_len: { kinds: LENGTH_KINDS, word: 'character count' },
  pattern: { kinds: PATTERN_KINDS, word: 'must-match' },
  min_words: { kinds: WORD_KINDS, word: 'word count' },
  max_words: { kinds: WORD_KINDS, word: 'word count' },
  contains: { kinds: TEXT_RULE_KINDS, word: 'contains' },
  starts_with: { kinds: TEXT_RULE_KINDS, word: 'starts with' },
  ends_with: { kinds: TEXT_RULE_KINDS, word: 'ends with' },
  decimals: { kinds: DECIMAL_KINDS, word: 'decimal places' },
  min: { kinds: RANGE_KINDS, word: 'smallest value' },
  max: { kinds: RANGE_KINDS, word: 'largest value' },
  no_past: { kinds: DAY_KINDS, word: 'date' },
  no_future: { kinds: DAY_KINDS, word: 'date' },
  min_day: { kinds: DAY_KINDS, word: 'date' },
  max_day: { kinds: DAY_KINDS, word: 'date' },
  allow_domains: { kinds: DOMAIN_KINDS, word: 'email domain' },
  block_domains: { kinds: DOMAIN_KINDS, word: 'email domain' },
  min_choices: { kinds: MANY_CHOICE_KINDS, word: 'choice count' },
  max_choices: { kinds: MANY_CHOICE_KINDS, word: 'choice count' },
  min_digits: { kinds: PHONE_RULE_KINDS, word: 'phone digits' },
  max_digits: { kinds: PHONE_RULE_KINDS, word: 'phone digits' },
  need_country_code: { kinds: PHONE_RULE_KINDS, word: 'phone country code' },
  same_as: { kinds: SAME_AS_KINDS, word: 'matching' },
};

/**
 * Whether a rule can be put on a kind at all. The builder only draws a knob this says
 * yes to, and Publish refuses to save one it says no to, so there is no box anywhere
 * that looks like it checks something and does not.
 */
export function ruleAppliesTo(key: keyof FieldValidation, kind: FieldKind): boolean {
  const rule = RULE_KINDS[key];
  return rule ? rule.kinds.includes(kind) : true;
}

/**
 * A rule read the way the validator reads it: switched on, and sitting on a kind that
 * can fail it. The same call answers for the builder, Publish and `answers.ts`, so a
 * rule parked on the wrong kind is invisible to all three rather than half-obeyed.
 */
export function activeRule<K extends keyof FieldValidation>(
  field: FormFieldDef,
  key: K,
): FieldValidation[K] | undefined {
  if (!ruleAppliesTo(key, field.type)) return undefined;
  const value = field.validation?.[key];
  return ruleIsSet(value) ? value : undefined;
}

/** A rule counts as switched on — a `false` switch and an empty box ask for nothing. */
function ruleIsSet(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const DOMAIN_TEXT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const lengthSchema = z.number().int().min(0).max(100000);
const wordSchema = z.number().int().min(1).max(10000);
const choiceCountSchema = z.number().int().min(1).max(120);
const digitSchema = z.number().int().min(1).max(20);

/** Trimmed and lower-cased here, so the answer is compared against what was stored. */
const domainListSchema = z
  .array(z.string().max(120).transform((value) => value.trim().toLowerCase()))
  .max(40);

export const fieldOptionSchema = z
  .object({
    label: z.string().max(200),
    value: z.string().max(200),
    group: z.string().max(120).optional(),
    image_url: z
      .string()
      .max(600)
      .refine((v) => v === '' || /^https?:\/\//.test(v), 'An image choice needs a full URL')
      .optional(),
  })
  .passthrough();

export const formFieldSchema: z.ZodType<FormFieldDef> = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Field ids may contain letters, numbers, dash and underscore'),
    type: z.enum([
      'text', 'textarea', 'email', 'phone', 'number', 'rupees', 'currency', 'date', 'datetime', 'monthyear', 'time',
      'select', 'radio', 'checkbox', 'checkbox_single', 'multiselect', 'image_choice', 'matrix', 'decision',
      'yes_or_no', 'rating', 'slider', 'signature', 'geolocation', 'url', 'name', 'address',
      'section', 'heading', 'note', 'divider', 'spacer', 'page_break', 'formula',
    ]),
    label: z.string().max(200),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(500).optional(),
    required: z.boolean().optional(),
    options: z.array(fieldOptionSchema).max(120).optional(),
    validation: z
      .object({
        min_len: lengthSchema.optional(),
        max_len: lengthSchema.optional(),
        min: z.number().min(-1000000).max(1000000).optional(),
        max: z.number().min(-1000000).max(1000000).optional(),
        pattern: z.string().max(200).optional(),
        message: z.string().max(200).optional(),
        min_words: wordSchema.optional(),
        max_words: wordSchema.optional(),
        contains: z.string().max(120).optional(),
        starts_with: z.string().max(120).optional(),
        ends_with: z.string().max(120).optional(),
        decimals: z.number().int().min(0).max(6).optional(),
        no_past: z.boolean().optional(),
        no_future: z.boolean().optional(),
        min_day: z.string().regex(DAY_TEXT, 'Use a date like 2026-04-01').optional(),
        max_day: z.string().regex(DAY_TEXT, 'Use a date like 2026-04-01').optional(),
        min_choices: choiceCountSchema.optional(),
        max_choices: choiceCountSchema.optional(),
        allow_domains: domainListSchema.optional(),
        block_domains: domainListSchema.optional(),
        min_digits: digitSchema.optional(),
        max_digits: digitSchema.optional(),
        need_country_code: z.boolean().optional(),
        same_as: z.string().max(64).optional(),
      })
      .passthrough()
      .optional(),
    logic: z
      .object({
        action: z.enum(['show', 'hide', 'require']),
        match: z.enum(['all', 'any']),
        conditions: z
          .array(
            z
              .object({
                field_id: z.string().max(64),
                operator: logicOperatorEnum,
                value: z.string().max(400).optional(),
                part: z.string().max(32).optional(),
              })
              .passthrough(),
          )
          .max(12),
      })
      .passthrough()
      .optional(),
    width: z.enum(['full', 'half']).optional(),
    prefix: z.string().max(40).optional(),
    suffix: z.string().max(40).optional(),
    default_value: z.string().max(400).optional(),
    // Only that it is text of a sane size. Whether the sum *reads* as a sum is
    // `formulaProblem`, run at Publish, because a half-typed expression is a draft a
    // builder is still working on rather than a shape the field id could not hold.
    formula: z.string().max(FORMULA_MAX_CHARS, 'That calculation is too long').optional(),
    choice_style: z.enum(['radio', 'checkbox']).optional(),
    searchable: z.boolean().optional(),
    inline_choices: z.boolean().optional(),
    currency_symbol: z.string().max(6).optional(),
    rating: z
      .object({
        min: z.number().int().min(0).max(10).default(1),
        max: z.number().int().min(1).max(10).default(5),
        symbol: z.enum(['number', 'star', 'heart', 'thumb', 'smiley']).default('star'),
      })
      .passthrough()
      .optional(),
    slider: z
      .object({
        step: z.number().min(0.1).max(1000).default(1),
        show_value: z.boolean().default(true),
      })
      .passthrough()
      .optional(),
    matrix: z
      .object({
        rows: z.array(fieldOptionSchema).max(MATRIX_MAX_ROWS).default([]),
        columns: z.array(fieldOptionSchema).max(MATRIX_MAX_COLUMNS).default([]),
      })
      .passthrough()
      .optional(),
    decision: z
      .object({
        approve: z.string().max(60).default('Approve'),
        reject: z.string().max(60).default('Reject'),
        ask_reason: z.boolean().default(false),
      })
      .passthrough()
      .optional(),
    name_parts: z
      .object({
        prefix: z.boolean().default(NAME_PARTS_DEFAULT.prefix),
        first: z.boolean().default(NAME_PARTS_DEFAULT.first),
        middle: z.boolean().default(NAME_PARTS_DEFAULT.middle),
        last: z.boolean().default(NAME_PARTS_DEFAULT.last),
        suffix: z.boolean().default(NAME_PARTS_DEFAULT.suffix),
      })
      .passthrough()
      .optional(),
    address_parts: z
      .object({
        line1: z.boolean().default(ADDRESS_PARTS_DEFAULT.line1),
        line2: z.boolean().default(ADDRESS_PARTS_DEFAULT.line2),
        city: z.boolean().default(ADDRESS_PARTS_DEFAULT.city),
        state: z.boolean().default(ADDRESS_PARTS_DEFAULT.state),
        zip: z.boolean().default(ADDRESS_PARTS_DEFAULT.zip),
        country: z.boolean().default(ADDRESS_PARTS_DEFAULT.country),
      })
      .passthrough()
      .optional(),
  })
  .passthrough() as unknown as z.ZodType<FormFieldDef>;

export interface FormSettings {
  submit_label: string;
  success_message: string;
  redirect_url: string;
  one_per_visitor: boolean;
  close_at: string | null;
  field_order: string[];
  /** Ask for the answers on every page to be read back before they are sent. */
  review_page: boolean;
  /** Draw how far through the pages a visitor is. */
  show_progress: boolean;
}

export const FORM_SETTINGS_DEFAULT: FormSettings = {
  submit_label: 'Submit',
  success_message: 'Thank you. Your response has been recorded.',
  redirect_url: '',
  one_per_visitor: false,
  close_at: null,
  field_order: [],
  review_page: false,
  show_progress: true,
};

const urlOrEmpty = z
  .string()
  .max(600)
  .refine((v) => v === '' || /^https?:\/\//.test(v), 'Enter a full URL');

export const formSettingsSchema = z
  .object({
    submit_label: z.string().max(60).default('Submit'),
    success_message: z.string().max(1000).default(FORM_SETTINGS_DEFAULT.success_message),
    redirect_url: urlOrEmpty.default(''),
    one_per_visitor: z.boolean().default(false),
    close_at: z.string().max(40).nullable().default(null),
    field_order: z.array(z.string().max(64)).max(200).default([]),
    review_page: z.boolean().default(FORM_SETTINGS_DEFAULT.review_page),
    show_progress: z.boolean().default(FORM_SETTINGS_DEFAULT.show_progress),
  })
  .passthrough();

export type FormTheme = {
  accent: string;
  background: string;
  label_case: 'normal' | 'uppercase';
  rounded: boolean;
  width: 'narrow' | 'default' | 'wide';
};

export const FORM_THEME_DEFAULT: FormTheme = {
  accent: '#2E6BE6',
  background: '#FFFFFF',
  label_case: 'normal',
  rounded: true,
  width: 'default',
};

export const formThemeSchema = z
  .object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour').default('#2E6BE6'),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour').default('#FFFFFF'),
    label_case: z.enum(['normal', 'uppercase']).default('normal'),
    rounded: z.boolean().default(true),
    width: z.enum(['narrow', 'default', 'wide']).default('default'),
  })
  .passthrough();

export const formDefinitionSchema = z.object({
  title: z.string().trim().min(1, 'Give the form a title').max(140),
  description: z.string().max(2000).default(''),
  slug: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/, 'Use lowercase letters, numbers and dashes'),
  fields: z.array(formFieldSchema).min(1, 'Add at least one field').max(120),
  settings: formSettingsSchema.default({ ...FORM_SETTINGS_DEFAULT }),
  theme: formThemeSchema.default({ ...FORM_THEME_DEFAULT }),
});

export type FormDefinition = z.infer<typeof formDefinitionSchema>;

/**
 * Rules that a plain zod shape cannot express: an option-bearing field must have
 * choices, a default has to be one of them, and conditional logic may only point
 * at a real collecting field.
 */
export function validateFieldSemantics(fields: FormFieldDef[]): string | null {
  const ids = new Set<string>();

  for (const field of fields) {
    if (ids.has(field.id)) return `Two fields share the id "${field.id}"`;
    ids.add(field.id);

    if (OPTION_BEARING.includes(field.type)) {
      const options = field.options ?? [];
      if (options.length === 0) return `"${field.label}" needs at least one choice`;
      if (options.some((o) => !o.label.trim())) return `"${field.label}" has a choice with no label`;
      if (new Set(options.map((o) => o.value)).size !== options.length) {
        return `"${field.label}" has two choices that store the same value`;
      }
      if (field.type === 'image_choice' && options.some((o) => !o.image_url)) {
        return `"${field.label}" has a choice with no image`;
      }
    }

    if (field.type === 'matrix') {
      const rows = field.matrix?.rows ?? [];
      const columns = field.matrix?.columns ?? [];
      if (rows.length === 0) return `"${field.label}" needs at least one row`;
      if (columns.length === 0) return `"${field.label}" needs at least one column`;
      if (rows.some((r) => !r.label.trim()) || columns.some((c) => !c.label.trim())) {
        return `"${field.label}" has a matrix label that is blank`;
      }
    }

    if (field.type === 'rating') {
      const { min, max } = field.rating ?? { min: 1, max: 5 };
      if (min >= max) return `"${field.label}" needs a highest rating above its lowest`;
    }

    if (field.type === 'slider') {
      const min = field.validation?.min;
      const max = field.validation?.max;
      if (min !== undefined && max !== undefined && min >= max) {
        return `"${field.label}" needs a slider maximum above its minimum`;
      }
    }

    if (field.type === 'formula') {
      const calculation = validateCalculation(field, fields);
      if (calculation) return calculation;
    }

    const ruleError = validateRules(field, fields);
    if (ruleError) return ruleError;

    if (isComposite(field.type) && compositeParts(field).length === 0) {
      return `"${field.label}" has every part switched off, so it asks nothing`;
    }

    const def = field.default_value?.trim();
    if (def) {
      if (isStructured(field.type) || isComposite(field.type)) {
        return `"${field.label}" cannot have a default answer — ${FIELD_KIND_LABELS[field.type]} has more than one part`;
      }
      if (OPTION_BEARING.includes(field.type) || field.type === 'yes_or_no' || field.type === 'decision') {
        const allowed = choiceValues(field);
        const wanted = collectsMany(field) ? def.split(',').map((v) => v.trim()).filter(Boolean) : [def];
        if (wanted.some((v) => !allowed.includes(v))) {
          return `"${field.label}" defaults to a choice it does not offer`;
        }
      }
    }

    const logicError = validateLogic(field, fields);
    if (logicError) return logicError;

    if (field.validation?.pattern) {
      try {
        new RegExp(field.validation.pattern);
      } catch {
        return `"${field.label}" has an invalid regular expression`;
      }
    }
  }

  return null;
}

/**
 * A rule has to sit on a kind that can fail it, and its two ends have to be in the
 * right order. This runs at Publish, over the parsed definition, so a form cannot go
 * live promising a check `answers.ts` would never make.
 */
function validateRules(field: FormFieldDef, fields: FormFieldDef[]): string | null {
  const rules = field.validation;
  if (!rules) return null;

  const named = `"${field.label}"`;
  const kindName = FIELD_KIND_LABELS[field.type];

  for (const [key, rule] of Object.entries(RULE_KINDS) as [keyof FieldValidation, { kinds: readonly FieldKind[]; word: string }][]) {
    if (ruleIsSet(rules[key]) && !rule.kinds.includes(field.type)) {
      return `${named} cannot carry a ${rule.word} check — ${kindName} asks for no such answer`;
    }
  }

  if (ruleIsSet(rules.min_len) && ruleIsSet(rules.max_len) && (rules.min_len ?? 0) > (rules.max_len ?? 0)) {
    return `${named} needs a character maximum above its character minimum`;
  }
  if (rules.min_words !== undefined && rules.max_words !== undefined && rules.min_words > rules.max_words) {
    return `${named} needs a word maximum above its word minimum`;
  }
  if (rules.min !== undefined && rules.max !== undefined && rules.min > rules.max) {
    return `${named} needs a largest value above its smallest`;
  }
  if (rules.min_digits !== undefined && rules.max_digits !== undefined && rules.min_digits > rules.max_digits) {
    return `${named} needs more digits at the top of its range than at the bottom`;
  }
  if (rules.min_day && rules.max_day && rules.min_day > rules.max_day) {
    return `${named} needs a latest date after its earliest`;
  }

  const allowed = rules.allow_domains ?? [];
  const blocked = rules.block_domains ?? [];
  for (const domain of [...allowed, ...blocked]) {
    if (!DOMAIN_TEXT.test(domain)) return `${named} has an email domain that is not a domain: "${domain}"`;
  }
  const contradicted = allowed.find((domain) => blocked.includes(domain));
  if (contradicted) return `${named} both allows and blocks "${contradicted}", so nobody can answer it`;

  if (rules.min_choices !== undefined || rules.max_choices !== undefined) {
    if (!collectsMany(field)) return `${named} sets a number of choices to pick, and it is not a field that picks several`;
    const options = field.options ?? [];
    if (rules.min_choices !== undefined && rules.min_choices > options.length) {
      return `${named} asks for more choices than it offers`;
    }
    if (rules.min_choices !== undefined && rules.max_choices !== undefined && rules.min_choices > rules.max_choices) {
      return `${named} needs a largest number of choices above its smallest`;
    }
  }

  if (rules.same_as?.trim()) {
    const other = fields.find((candidate) => candidate.id === rules.same_as);
    if (!other) return `${named} is meant to match a field that does not exist`;
    if (other.id === field.id) return `${named} cannot be made to match itself`;
    if (isPresentational(other.type)) return `${named} is meant to match a field that collects no answer`;
    if (other.type !== field.type) {
      return `${named} is meant to match the ${FIELD_KIND_LABELS[other.type]} field — only the same kind of question can hold the same answer`;
    }
  }

  return null;
}

/**
 * A Calculate field is the one question whose answer the form writes itself, so it is
 * held to before Publish: the sum has to read as arithmetic, and every question inside it
 * has to be a number somebody else types. Reading itself, another sum or a question that
 * collects nothing would leave the answer with nothing to work from, or two sums waiting
 * on each other.
 */
function validateCalculation(field: FormFieldDef, fields: FormFieldDef[]): string | null {
  const named = `"${field.label}"`;
  const problem = formulaProblem(field.formula ?? '');
  if (problem) return `${named} ${problem}`;
  if (field.required === true) return `${named} is worked out by the form, so it cannot be compulsory`;
  if (field.default_value?.trim()) return `${named} is worked out by the form, so it cannot have a default answer`;

  for (const id of formulaReferences(field.formula ?? '')) {
    const source = fields.find((candidate) => candidate.id === id);
    if (!source) return `${named} reads {${id}}, which is not a question in this form`;
    if (source.id === field.id) return `${named} cannot read its own answer`;
    if (source.type === 'formula') return `${named} reads “${source.label}”, which is itself worked out from these answers`;
    if (isPresentational(source.type)) return `${named} reads “${source.label}”, which collects no answer`;
    if (!isCalculableAnswer(source.type)) return `${named} reads “${source.label}”, which is not a number`;
  }

  return null;
}

/**
 * A rule is only worth publishing when the answer it reads can be read: the question it
 * points at has to exist and collect an answer, the comparison has to be one that kind
 * of answer takes, and the rule has to have something to compare against. A rule with
 * no conditions, or a compulsory rule on a question already compulsory, asks nothing.
 */
function validateLogic(field: FormFieldDef, fields: FormFieldDef[]): string | null {
  const logic = field.logic;
  if (!logic) return null;

  const named = `"${field.label}"`;
  if (logic.conditions.length === 0) return `${named} has a rule with nothing to check`;
  if (logic.action === 'require' && field.required === true) {
    return `${named} is already compulsory, so its rule asks for nothing`;
  }

  for (const condition of logic.conditions) {
    const source = fields.find((candidate) => candidate.id === condition.field_id) ?? null;
    if (!source) return `${named} has logic referring to a field that does not exist`;
    if (source.id === field.id) return `${named} cannot be controlled by an answer to itself`;
    if (isPresentational(source.type)) return `${named} has logic referring to a field that collects no answer`;
    // A rule is judged before any answer is checked, and a calculated answer only exists
    // after the checks have run, so pointing at one would read what the browser sent.
    if (source.type === 'formula') return `${named} has logic referring to “${source.label}”, which is worked out after the answers are read`;

    if (!logicOperatorFits(source.type, condition.operator)) {
      return `${named} asks “${source.label}” whether it ${LOGIC_OPERATOR_LABELS[condition.operator]} — that kind of question cannot be asked that way`;
    }

    if (logicOperatorNeedsValue(condition.operator) && !condition.value?.trim()) {
      return `${named} has a rule that compares an answer to nothing`;
    }

    // A part is only a thing to read on a question made of parts, and only one it asks.
    const part = condition.part?.trim();
    if (part) {
      if (!isComposite(source.type)) return `${named} reads a part of “${source.label}”, which has none`;
      if (!compositeParts(source).includes(part)) {
        return `${named} reads a part “${source.label}” does not ask for`;
      }
    }
  }

  return null;
}

/**
 * Whether a field should be shown, given the answers so far. Shared by the live
 * public form (browser) and the server validator, so a hidden required field is
 * treated the same way on both sides.
 */
export function fieldIsVisible(
  field: FormFieldDef,
  answers: Record<string, unknown>,
  fields: FormFieldDef[],
): boolean {
  const logic = field.logic;
  if (!logic || logic.conditions.length === 0 || logic.action === 'require') return true;
  const matched = logicMatches(logic, answers, fields);
  return logic.action === 'show' ? matched : !matched;
}

/**
 * Whether an answer is compulsory — either the question says so on its own, or a rule
 * makes it so once a particular answer has been given. A question a rule hides is
 * never compulsory: `fieldIsVisible` already took it out of the form.
 */
export function fieldIsRequired(
  field: FormFieldDef,
  answers: Record<string, unknown>,
  fields: FormFieldDef[],
): boolean {
  if (field.required === true) return true;
  const logic = field.logic;
  if (!logic || logic.action !== 'require' || logic.conditions.length === 0) return false;
  return logicMatches(logic, answers, fields);
}

function logicMatches(logic: FieldLogic, answers: Record<string, unknown>, fields: FormFieldDef[]): boolean {
  const results = logic.conditions.map((condition) =>
    evaluateCondition(
      condition,
      answers[condition.field_id],
      fields.find((candidate) => candidate.id === condition.field_id) ?? null,
    ),
  );
  return logic.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * One rule, judged against one answer.
 *
 * The source field is what makes this readable: an answer is flattened the way that
 * kind of question holds it, so a matrix, a decision or a name never has to be
 * compared as the text of an object. A question nobody answered matches no comparison
 * at all — only `is empty` fires on a blank, which is what stops a rule coming true
 * because somebody left the box alone.
 */
function evaluateCondition(
  condition: LogicCondition,
  actual: unknown,
  source: FormFieldDef | null,
): boolean {
  const empty = isEmptyAnswer(actual);
  if (condition.operator === 'is_empty') return empty;
  if (condition.operator === 'is_filled') return !empty;
  if (empty) return false;

  const wanted = String(condition.value ?? '');
  const value = source ? logicValue(source, actual, condition.part) : String(actual ?? '');

  switch (condition.operator) {
    case 'is':
      return answerText(value) === wanted;
    case 'is_not':
      return answerText(value) !== wanted;
    case 'contains':
      return answerHolds(value, wanted);
    case 'not_contains':
      return !answerHolds(value, wanted);
    case 'starts_with':
      return answerText(value).toLowerCase().startsWith(wanted.toLowerCase());
    case 'ends_with':
      return answerText(value).toLowerCase().endsWith(wanted.toLowerCase());
    case 'gt':
      return Number(answerText(value)) > Number(wanted);
    case 'lt':
      return Number(answerText(value)) < Number(wanted);
    // Days are typed `2026-03-04` and months `2026-03`, so the text is already in the
    // order the calendar is in. No date maths is needed to say which came first.
    case 'before':
      return answerText(value) < wanted;
    case 'after':
      return answerText(value) > wanted;
    default:
      return true;
  }
}

/** One answer reduced to what a rule can be compared against. */
function logicValue(source: FormFieldDef, raw: unknown, part?: string): string | string[] {
  if (isComposite(source.type)) return part ? partValue(raw, part) : compositeText(source, raw);
  if (Array.isArray(raw)) return raw.map((entry) => String(entry).trim());
  if (source.type === 'matrix') {
    const cells = raw as Record<string, unknown>;
    return (source.matrix?.rows ?? []).map((row) => String(cells[String(row.value)] ?? '')).filter((cell) => cell !== '');
  }
  if (source.type === 'decision') {
    const parts = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return String(parts.value ?? '');
  }
  if (source.type === 'geolocation') {
    const parts = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return `${String(parts.lat ?? '')}, ${String(parts.lng ?? '')}`;
  }
  if (typeof raw === 'object') return '';
  return String(raw).trim();
}

function answerText(value: string | string[]): string {
  return Array.isArray(value) ? value.join(',') : value;
}

/** A list is held to its members; written text is held to what it contains. */
function answerHolds(value: string | string[], wanted: string): boolean {
  if (Array.isArray(value)) return value.includes(wanted);
  return value.toLowerCase().includes(wanted.toLowerCase());
}

/**
 * Whether an answer says nothing at all. A tick not ticked, a list with nothing in it
 * and an object whose every part is blank all count as no answer.
 */
export function isEmptyAnswer(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw === 'boolean') return raw === false;
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).every((part) => isEmptyAnswer(part));
  }
  return false;
}

/** The parts of a name or an address, written out the way the form shows them. */
export function compositeText(field: FormFieldDef, raw: unknown): string {
  if (!isComposite(field.type)) return '';
  const parts = (field.type === 'name' ? NAME_PARTS : ADDRESS_PARTS)
    .map((part) => partValue(raw, part))
    .filter((value) => value !== '');
  return parts.join(field.type === 'name' ? ' ' : ', ');
}

/**
 * The answer a Calculate field works out for these answers, rounded as its own rule asks.
 *
 * Both sides call this — the page a visitor is filling in and the route storing the
 * response — so the number on the screen and the number in the row cannot be two numbers.
 * A sum is read from the answers as they stand, which is why a question nobody answered
 * counts as zero, and `null` is a sum with no answer to write down.
 */
export function calculateOf(field: FormFieldDef, answers: Record<string, unknown>): number | null {
  if (field.type !== 'formula') return null;
  const expression = field.formula?.trim() ?? '';
  if (expression === '') return null;
  const value = evaluateFormula(expression, (id) => numberAnswer(answers[id]));
  if (value === null) return null;
  const decimals = activeRule(field, 'decimals');
  if (decimals === undefined) return Number.isFinite(value) ? value : null;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Number.isFinite(rounded) ? rounded : null;
}

/** A calculated answer written down: its rounding, its unit, the same words on the page and in an export. */
export function calculationText(field: FormFieldDef, value: unknown): string {
  // Nothing answered is not zero answered — a sum that could not be worked out, or a
  // response saved before this question was in the form, exports as an empty cell.
  if (value === null || value === undefined || value === '') return '';
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) return '';
  const decimals = activeRule(field, 'decimals');
  const digits = decimals === undefined ? String(number) : number.toFixed(decimals);
  return `${field.prefix ?? ''}${digits}${field.suffix ? ` ${field.suffix}` : ''}`;
}

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Short text',
  textarea: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  rupees: 'Amount (₹)',
  currency: 'Currency amount',
  date: 'Date',
  datetime: 'Date and time',
  monthyear: 'Month and year',
  time: 'Time',
  select: 'Dropdown',
  radio: 'Single choice',
  checkbox: 'Multiple choice',
  checkbox_single: 'Single checkbox',
  multiselect: 'Multi select',
  image_choice: 'Image choice',
  matrix: 'Matrix',
  decision: 'Decision box',
  yes_or_no: 'Yes / No',
  rating: 'Rating',
  slider: 'Slider',
  formula: 'Calculate',
  signature: 'Signature',
  geolocation: 'Location',
  url: 'Website',
  name: 'Name',
  address: 'Address',
  section: 'Section title',
  heading: 'Heading',
  note: 'Help text',
  divider: 'Divider',
  spacer: 'Spacer',
  page_break: 'Page break',
};

const KIND_LABEL_FALLBACK: Partial<Record<FieldKind, string>> = {
  currency: 'Amount',
  datetime: 'Date and time',
  monthyear: 'Month and year',
  image_choice: 'Choose one',
  matrix: 'Please answer each row',
  decision: 'Approve or reject',
  yes_or_no: 'Yes or No',
  slider: 'Slide to a value',
  signature: 'Sign in the box',
  geolocation: 'Location',
};

export function blankField(type: FieldKind, index: number): FormFieldDef {
  const label =
    type === 'email' ? 'Email address'
    : type === 'phone' ? 'Phone number'
    : type === 'name' ? 'Name'
    : type === 'address' ? 'Address'
    : type === 'date' ? 'Date'
    : type === 'time' ? 'Time'
    : type === 'number' ? 'Number'
    : type === 'rupees' ? 'Amount'
    : type === 'textarea' ? 'Details'
    : type === 'select' ? 'Choose one'
    : type === 'radio' ? 'Choose one'
    : type === 'checkbox' ? 'Choose all that apply'
    : type === 'multiselect' ? 'Choose all that apply'
    : type === 'checkbox_single' ? 'I agree'
    : type === 'rating' ? 'How would you rate it?'
    : type === 'formula' ? 'Total'
    : type === 'url' ? 'Website'
    : type === 'section' ? 'Section'
    : type === 'heading' ? 'A heading'
    : type === 'note' ? 'Please read this before continuing.'
    : type === 'spacer' || type === 'page_break' ? ''
    : KIND_LABEL_FALLBACK[type] ?? 'Question';

  const withChoices = OPTION_BEARING.includes(type);

  return {
    id: `field_${index}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    label,
    required: false,
    width: 'full',
    ...(withChoices
      ? {
          options:
            type === 'image_choice'
              ? [
                  { label: 'Choice one', value: 'choice_one', image_url: '' },
                  { label: 'Choice two', value: 'choice_two', image_url: '' },
                ]
              : [
                  { label: 'Option one', value: 'option_one' },
                  { label: 'Option two', value: 'option_two' },
                ],
        }
      : {}),
    ...(type === 'checkbox_single' ? { validation: { message: 'This must be checked to continue' } } : {}),
    ...(type === 'image_choice' ? { choice_style: 'radio' as const } : {}),
    ...(type === 'currency' ? { currency_symbol: '₹' } : {}),
    ...(type === 'rating' ? { rating: { min: 1, max: 5, symbol: 'star' as const } } : {}),
    ...(type === 'slider'
      ? { validation: { min: 0, max: 100 }, slider: { step: 1, show_value: true } }
      : {}),
    ...(type === 'matrix'
      ? {
          matrix: {
            rows: [
              { label: 'Row one', value: 'row_one' },
              { label: 'Row two', value: 'row_two' },
            ],
            columns: [
              { label: 'Poor', value: 'poor' },
              { label: 'Good', value: 'good' },
            ],
          },
        }
      : {}),
    ...(type === 'decision' ? { decision: { approve: 'Approve', reject: 'Reject', ask_reason: false } } : {}),
  };
}

import { z } from 'zod';

/**
 * Form field model. A form's `fields` array is the single document both the
 * builder UI and the public page render from, and the shape the server validates
 * a submission against.
 *
 * There is deliberately no file-upload field yet: an attachment needs a storage
 * bucket, a size and type limit, and a retention rule before an answer can hold
 * one.
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
  | 'signature'
  | 'geolocation'
  | 'url'
  | 'name'
  | 'address'
  | 'section'
  | 'heading'
  | 'note'
  | 'divider'
  | 'spacer';

/** Fields that render but never collect an answer. */
export const PRESENTATIONAL: FieldKind[] = ['section', 'heading', 'note', 'divider', 'spacer'];

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
export interface FieldValidation {
  min_len?: number;
  max_len?: number;
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
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

export type LogicOperator = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_filled' | 'gt' | 'lt';

export interface LogicCondition {
  field_id: string;
  operator: LogicOperator;
  value?: string;
}

export interface FieldLogic {
  action: 'show' | 'hide';
  match: 'all' | 'any';
  conditions: LogicCondition[];
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
}

/** A matrix wider than this is a spreadsheet, not a form question. */
export const MATRIX_MAX_ROWS = 20;
export const MATRIX_MAX_COLUMNS = 10;

/**
 * A signature is stored as a PNG data URL inside the answer, so its length is the whole
 * budget: 40,000 characters is about 29 KB of image, which is a signature pad at
 * readable resolution and nowhere near enough to smuggle a document through.
 */
export const SIGNATURE_MAX_CHARS = 40000;

const logicOperatorEnum = z.enum(['is', 'is_not', 'contains', 'is_empty', 'is_filled', 'gt', 'lt']);

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
      'section', 'heading', 'note', 'divider', 'spacer',
    ]),
    label: z.string().max(200),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(500).optional(),
    required: z.boolean().optional(),
    options: z.array(fieldOptionSchema).max(120).optional(),
    validation: z
      .object({
        min_len: z.number().int().min(0).max(100000).optional(),
        max_len: z.number().int().min(0).max(100000).optional(),
        min: z.number().min(-1000000).max(1000000).optional(),
        max: z.number().min(-1000000).max(1000000).optional(),
        pattern: z.string().max(200).optional(),
        message: z.string().max(200).optional(),
      })
      .passthrough()
      .optional(),
    logic: z
      .object({
        action: z.enum(['show', 'hide']),
        match: z.enum(['all', 'any']),
        conditions: z
          .array(
            z
              .object({
                field_id: z.string().max(64),
                operator: logicOperatorEnum,
                value: z.string().max(400).optional(),
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
  })
  .passthrough() as unknown as z.ZodType<FormFieldDef>;

export interface FormSettings {
  submit_label: string;
  success_message: string;
  redirect_url: string;
  one_per_visitor: boolean;
  close_at: string | null;
  field_order: string[];
}

export const FORM_SETTINGS_DEFAULT: FormSettings = {
  submit_label: 'Submit',
  success_message: 'Thank you. Your response has been recorded.',
  redirect_url: '',
  one_per_visitor: false,
  close_at: null,
  field_order: [],
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
  const collecting = new Set<string>();

  for (const field of fields) {
    if (ids.has(field.id)) return `Two fields share the id "${field.id}"`;
    ids.add(field.id);
    if (!isPresentational(field.type)) collecting.add(field.id);

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

    const def = field.default_value?.trim();
    if (def) {
      if (isStructured(field.type)) {
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

    if (field.logic) {
      for (const condition of field.logic.conditions) {
        if (!ids.has(condition.field_id)) {
          return `"${field.label}" has logic referring to a field that does not exist`;
        }
        if (condition.field_id === field.id) {
          return `"${field.label}" cannot control its own visibility`;
        }
        if (!collecting.has(condition.field_id)) {
          return `"${field.label}" has logic referring to a field that collects no answer`;
        }
      }
    }

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
 * Whether a field should be shown, given the answers so far. Shared by the live
 * public form (browser) and the server validator, so a hidden required field is
 * treated the same way on both sides.
 */
export function fieldIsVisible(field: FormFieldDef, answers: Record<string, unknown>): boolean {
  if (!field.logic || field.logic.conditions.length === 0) return true;

  const results = field.logic.conditions.map((c) => evaluateCondition(c, answers[c.field_id]));
  const matched = field.logic.match === 'all' ? results.every(Boolean) : results.some(Boolean);

  return field.logic.action === 'show' ? matched : !matched;
}

function evaluateCondition(condition: LogicCondition, actual: unknown): boolean {
  const empty =
    actual === undefined ||
    actual === null ||
    (typeof actual === 'string' && actual.trim() === '') ||
    (Array.isArray(actual) && actual.length === 0);

  switch (condition.operator) {
    case 'is_empty':
      return empty;
    case 'is_filled':
      return !empty;
    case 'is':
      return String(actual ?? '') === String(condition.value ?? '');
    case 'is_not':
      return String(actual ?? '') !== String(condition.value ?? '');
    case 'contains':
      if (Array.isArray(actual)) return actual.some((v) => String(v) === String(condition.value ?? ''));
      return String(actual ?? '').toLowerCase().includes(String(condition.value ?? '').toLowerCase());
    case 'gt':
      return Number(actual) > Number(condition.value);
    case 'lt':
      return Number(actual) < Number(condition.value);
    default:
      return true;
  }
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
  signature: 'Signature',
  geolocation: 'Location',
  url: 'Website',
  name: 'Full name',
  address: 'Address',
  section: 'Section title',
  heading: 'Heading',
  note: 'Help text',
  divider: 'Divider',
  spacer: 'Spacer',
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
    : type === 'name' ? 'Full name'
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
    : type === 'url' ? 'Website'
    : type === 'section' ? 'Section'
    : type === 'heading' ? 'A heading'
    : type === 'note' ? 'Please read this before continuing.'
    : type === 'spacer' ? ''
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

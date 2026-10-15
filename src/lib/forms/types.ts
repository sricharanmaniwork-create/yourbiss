import { z } from 'zod';

/**
 * Form field model. A form's `fields` array is the single document both the
 * builder UI and the public page render from, and the shape the server validates
 * a submission against.
 */
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'rupees'
  | 'date'
  | 'time'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'checkbox_single'
  | 'multiselect'
  | 'file'
  | 'rating'
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

export interface FieldOption {
  label: string;
  value: string;
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
  validation?: {
    min_len?: number;
    max_len?: number;
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
    allowed_types?: string[];
    max_mb?: number;
  };
  logic?: FieldLogic;
  width?: 'full' | 'half';
}

const logicOperatorEnum = z.enum(['is', 'is_not', 'contains', 'is_empty', 'is_filled', 'gt', 'lt']);

export const fieldOptionSchema = z.object({ label: z.string().max(200), value: z.string().max(200) }).passthrough();

export const formFieldSchema: z.ZodType<FormFieldDef> = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Field ids may contain letters, numbers, dash and underscore'),
    type: z.enum([
      'text', 'textarea', 'email', 'phone', 'number', 'rupees', 'date', 'time', 'select', 'radio',
      'checkbox', 'checkbox_single', 'multiselect', 'file', 'rating', 'url', 'name', 'address',
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
        allowed_types: z.array(z.string().max(40)).max(20).optional(),
        max_mb: z.number().int().min(1).max(50).optional(),
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
  })
  .passthrough() as unknown as z.ZodType<FormFieldDef>;

export interface FormSettings {
  submit_label: string;
  success_message: string;
  redirect_url: string;
  require_verified_email: boolean;
  one_per_visitor: boolean;
  close_at: string | null;
  field_order: string[];
}

export const FORM_SETTINGS_DEFAULT: FormSettings = {
  submit_label: 'Submit',
  success_message: 'Thank you. Your response has been recorded.',
  redirect_url: '',
  require_verified_email: false,
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
    require_verified_email: z.boolean().default(false),
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
 * options, and conditional logic may only point at a real collecting field.
 */
export function validateFieldSemantics(fields: FormFieldDef[]): string | null {
  const ids = new Set<string>();
  const collecting = new Set<string>();

  for (const field of fields) {
    if (ids.has(field.id)) return `Two fields share the id "${field.id}"`;
    ids.add(field.id);
    if (!isPresentational(field.type)) collecting.add(field.id);

    if (['select', 'radio', 'checkbox', 'multiselect'].includes(field.type)) {
      const options = field.options ?? [];
      if (options.length === 0) return `"${field.label}" needs at least one choice`;
      if (options.some((o) => !o.label.trim())) return `"${field.label}" has a choice with no label`;
    }

    if (field.type === 'file') {
      const maxMb = field.validation?.max_mb ?? 5;
      if (maxMb > 25) return `"${field.label}" cannot accept files larger than 25 MB`;
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
  date: 'Date',
  time: 'Time',
  select: 'Dropdown',
  radio: 'Single choice',
  checkbox: 'Multiple choice',
  checkbox_single: 'Single checkbox',
  multiselect: 'Multi select',
  file: 'File upload',
  rating: 'Rating',
  url: 'Website',
  name: 'Full name',
  address: 'Address',
  section: 'Section title',
  heading: 'Heading',
  note: 'Help text',
  divider: 'Divider',
  spacer: 'Spacer',
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
    : type === 'file' ? 'Attachment'
    : type === 'rating' ? 'How would you rate it?'
    : type === 'url' ? 'Website'
    : type === 'section' ? 'Section'
    : type === 'heading' ? 'A heading'
    : type === 'note' ? 'Please read this before continuing.'
    : type === 'spacer' ? ''
    : 'Question';

  const withChoices = ['select', 'radio', 'checkbox', 'multiselect'].includes(type);

  return {
    id: `field_${index}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    label,
    required: false,
    width: 'full',
    ...(withChoices
      ? {
          options: [
            { label: 'Option one', value: 'option_one' },
            { label: 'Option two', value: 'option_two' },
          ],
        }
      : {}),
    ...(type === 'checkbox_single' ? { validation: { message: 'This must be checked to continue' } } : {}),
    ...(type === 'file' ? { validation: { max_mb: 5, allowed_types: ['image/jpeg', 'image/png', 'application/pdf'] } } : {}),
  };
}

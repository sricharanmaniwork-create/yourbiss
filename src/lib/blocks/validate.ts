import { z } from 'zod';
import { pageTreeSchema, type BlockNode, type PageTree } from './types';
import { REGISTRY } from './registry';
import { propsSchema } from './controls';
import { auditTree } from './tree';

export interface TreeValidation {
  tree: PageTree;
  errors: { blockId: string; message: string }[];
  fatal: string | null;
}

/**
 * Server-side gate for a saved page tree. Structural rules come from auditTree,
 * per-block props from the registry's generated schema. Anything the renderer
 * could be asked to draw has to survive this first.
 */
export function validateTree(input: unknown): TreeValidation {
  const parsed = pageTreeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      tree: { type: 'page', id: 'page-root', props: {}, styles: {}, children: [] },
      errors: [],
      fatal: parsed.error.issues[0]?.message ?? 'The page content is not valid',
    };
  }

  let tree = parsed.data;
  const structural = auditTree(tree);
  if (structural) return { tree, errors: [], fatal: structural };

  const errors: { blockId: string; message: string }[] = [];
  const cleaned: BlockNode[] = [];

  const visit = (node: BlockNode, depth: number): BlockNode | null => {
    const def = REGISTRY[node.type];
    if (!def) {
      errors.push({ blockId: node.id, message: `Unknown block type "${node.type}"` });
      return null;
    }

    const result = propsSchema(def).safeParse(node.props);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ blockId: node.id, message: `${def.label}: ${issue.message}` });
      }
      return null;
    }

    const children = depth > 20 ? [] : node.children.map((c) => visit(c, depth + 1)).filter((c): c is BlockNode => c !== null);

    if (def.isContainer || node.type === 'columns') {
      if (node.type === 'columns') {
        const wanted = Number(result.data.count ?? 2);
        if (children.length !== wanted) {
          errors.push({ blockId: node.id, message: `Columns needs exactly ${wanted} container child blocks` });
          return null;
        }
      }
    } else if (children.length > 0) {
      errors.push({ blockId: node.id, message: `${def.label} cannot contain other blocks` });
      return null;
    }

    return { ...node, props: result.data as Record<string, unknown>, children };
  };

  for (const child of tree.children) {
    const next = visit(child, 1);
    if (next) cleaned.push(next);
  }

  if (errors.length > 0) {
    return { tree, errors, fatal: null };
  }

  tree = { ...tree, children: cleaned };
  return { tree, errors: [], fatal: null };
}

const emailField = z.string().trim().email();

/**
 * Answers submitted to a public form, checked against the form's own stored
 * definition. Conditional fields are skipped when their rule says hidden, so a
 * legitimately invisible field never reports as missing.
 */
export function buildAnswerSchema(fields: unknown): z.ZodType<Record<string, unknown>> {
  const list = Array.isArray(fields) ? (fields as Record<string, unknown>[]) : [];
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of list) {
    const key = typeof field.id === 'string' ? field.id : null;
    if (!key) continue;
    shape[key] = answerSchemaFor(field);
  }

  return z.object(shape).passthrough() as unknown as z.ZodType<Record<string, unknown>>;
}

function answerSchemaFor(field: Record<string, unknown>): z.ZodTypeAny {
  const type = String(field.type ?? 'text');
  const label = typeof field.label === 'string' ? field.label : 'This field';
  const required = field.required === true;
  const options = Array.isArray(field.options) ? (field.options as { value?: string }[]) : [];
  const allowed = options.map((o) => String(o.value ?? '')).filter(Boolean);

  let schema: z.ZodTypeAny;

  switch (type) {
    case 'email':
      schema = emailField;
      break;
    case 'phone':
      schema = z.string().regex(/^[+0-9 ()\-.]{5,32}$/, 'Enter a valid phone number');
      break;
    case 'number':
    case 'rupees':
      schema = z.union([z.coerce.number(), z.literal('')]).refine(
        (v) => v === '' || (typeof v === 'number' && Number.isFinite(v)),
        'Enter a number',
      );
      break;
    case 'date':
      schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
      break;
    case 'time':
      schema = z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time');
      break;
    case 'url':
      schema = z.string().url('Enter a full web address');
      break;
    case 'rating':
      schema = z.coerce.number().int().min(1).max(5);
      break;
    case 'checkbox_single':
      schema = z.union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('')]);
      break;
    case 'checkbox':
    case 'multi_select':
      schema = z.array(z.string().max(200)).max(40);
      break;
    case 'select':
    case 'radio':
      schema = allowed.length > 0 ? z.enum(allowed as [string, ...string[]]) : z.string().max(400);
      break;
    case 'file':
      // The upload itself is validated by the storage policies; the answer only
      // ever carries the stored key.
      schema = z.string().max(600);
      break;
    case 'section':
    case 'divider':
    case 'heading':
    case 'spacer':
    case 'note':
      schema = z.unknown().optional();
      break;
    case 'textarea':
      schema = z.string().max(8000);
      break;
    default:
      schema = z.string().max(2000);
  }

  if (type === 'section' || type === 'divider' || type === 'heading' || type === 'spacer' || type === 'note') {
    return schema;
  }

  if (type === 'checkbox' || type === 'multi_select') {
    return required
      ? (schema as z.ZodArray<z.ZodTypeAny>).refine((v: unknown[]) => v.length > 0, `${label} is required`)
      : (schema as z.ZodArray<z.ZodTypeAny>).optional().default([]);
  }

  return required
    ? schema.refine(
        (v: unknown) => {
          if (v === undefined || v === null) return false;
          if (typeof v === 'string') return v.trim().length > 0;
          return true;
        },
        `${label} is required`,
      )
    : schema.optional();
}

/** Guards against a payload stuffed with unrelated keys. */
export const MAX_ANSWER_KEYS = 200;

export function fieldIdsAreKnown(fields: unknown, answers: Record<string, unknown>): string | null {
  const list = Array.isArray(fields) ? (fields as { id?: string }[]) : [];
  const known = new Set(list.map((f) => f.id).filter((v): v is string => typeof v === 'string'));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) return `Unexpected answer "${key}"`;
  }
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) return 'Too many answers in one submission';
  return null;
}

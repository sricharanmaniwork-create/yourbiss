import { z } from 'zod';
import type { BlockType } from './types';

/**
 * Control descriptors. One definition per property drives three things: the
 * properties panel UI, the default props for a new block, and the zod schema the
 * server validates on save. Adding a block therefore cannot produce an editor
 * that accepts a value the renderer will later choke on.
 */
export type Control =
  | { kind: 'text'; key: string; label: string; placeholder?: string; max?: number; help?: string }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string; max?: number; rows?: number; help?: string }
  | { kind: 'richtext'; key: string; label: string; max?: number; help?: string }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; suffix?: string; help?: string }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[]; help?: string }
  | { kind: 'toggle'; key: string; label: string; help?: string }
  | { kind: 'color'; key: string; label: string; help?: string }
  | { kind: 'image'; key: string; label: string; help?: string }
  | { kind: 'link'; key: string; label: string; help?: string }
  | {
      kind: 'entity';
      key: string;
      label: string;
      entity: 'form' | 'booking_service' | 'page' | 'staff';
      optional?: boolean;
      help?: string;
    };

export interface ItemsControl {
  key: string;
  label: string;
  itemLabel: string;
  /** Which item property names the row in the repeater list. */
  titleKey: string;
  max: number;
  controls: Control[];
  blank: Record<string, unknown>;
}

export type BlockGroup = 'Structure' | 'Basics' | 'Content' | 'Engage' | 'Live data';

export interface BlockDefinition {
  type: BlockType;
  label: string;
  group: BlockGroup;
  icon: string;
  description: string;
  /** Where the canvas will let this block be dropped. */
  allowedIn: ('page' | 'section' | 'container' | 'columns')[];
  isContainer?: boolean;
  controls: Control[];
  items?: ItemsControl;
  /** Layout controls shown for this block in the style section. */
  styleKeys?: ('align' | 'width' | 'padding' | 'gap' | 'color' | 'background' | 'radius' | 'shadow' | 'font')[];
  /** Blocks that need a server-supplied option list before they can be edited. */
  needsOptions?: ('forms' | 'services' | 'pages' | 'staff')[];
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const URL_OR_RELATIVE = /^(https?:\/\/|mailto:|tel:|\/|#)/;

export function controlSchema(control: Control): z.ZodTypeAny {
  switch (control.kind) {
    case 'text':
      return z.string().max(control.max ?? 400).catch('');
    case 'textarea':
      return z.string().max(control.max ?? 4000).catch('');
    case 'richtext':
      return z.string().max(control.max ?? 4000).catch('');
    case 'number':
      return z.coerce
        .number({ message: `${control.label} must be a number` })
        .int()
        .min(control.min ?? -1000000)
        .max(control.max ?? 1000000)
        .catch(0);
    case 'select':
      return z.enum((control.options as { value: string }[]).map((o) => o.value) as [string, ...string[]]).catch(
        control.options[0]?.value ?? '',
      );
    case 'toggle':
      return z.boolean().catch(false);
    case 'color':
      return z.string().refine((v) => v === '' || HEX.test(v), 'Use a hex colour like #2E6BE6').catch('');
    case 'image':
      return z.string().refine((v) => v === '' || URL_OR_RELATIVE.test(v), 'Enter an image URL or pick from the media library')
        .catch('');
    case 'link':
      return z.string().refine((v) => v === '' || URL_OR_RELATIVE.test(v), 'Enter a URL, /path, mailto: or tel: link').catch('');
    case 'entity':
      return control.optional
        ? z.string().max(64).catch('')
        : z.string().min(1, `${control.label} is required`).max(64);
  }
}

export function controlDefault(control: Control): unknown {
  switch (control.kind) {
    case 'number':
      return control.min ?? 0;
    case 'toggle':
      return false;
    case 'select':
      return control.options[0]?.value ?? '';
    default:
      return '';
  }
}

/**
 * Loose on purpose at the edges: unknown keys survive (so a future block version
 * does not delete data), but every declared control is type-checked and clamped.
 */
export function propsSchema(def: BlockDefinition): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const control of def.controls) shape[control.key] = controlSchema(control);

  if (def.items) {
    const itemShape: Record<string, z.ZodTypeAny> = {};
    for (const c of def.items.controls) itemShape[c.key] = controlSchema(c);
    shape[def.items.key] = z
      .array(z.object(itemShape).passthrough())
      .max(def.items.max, `At most ${def.items.max} ${def.items.itemLabel.toLowerCase()} entries`)
      .catch([]);
  }

  return z.object(shape).passthrough() as unknown as z.ZodType<Record<string, unknown>>;
}

export function defaultProps(def: BlockDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of def.controls) out[c.key] = controlDefault(c);
  if (def.items) out[def.items.key] = [def.items.blank];
  return out;
}

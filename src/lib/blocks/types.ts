import { z } from 'zod';

export type BlockType =
  // structure
  | 'section'
  | 'columns'
  | 'container'
  // content
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'button_group'
  | 'divider'
  | 'spacer'
  | 'list'
  | 'quote'
  | 'badge_row'
  | 'video'
  // composed
  | 'card_grid'
  | 'feature_row'
  | 'pricing_table'
  | 'gallery'
  | 'faq'
  | 'stats'
  | 'team'
  | 'testimonials'
  | 'cta_banner'
  // chrome
  | 'navbar'
  | 'footer'
  | 'social_links'
  | 'contact_details'
  | 'map'
  | 'newsletter_form'
  // live, data-bound
  | 'form_embed'
  | 'booking_embed'
  | 'product_grid'
  | 'store_cart';

export const blockTypes = new Set<string>([
  'section', 'columns', 'container', 'heading', 'text', 'image', 'button', 'button_group',
  'divider', 'spacer', 'list', 'quote', 'badge_row', 'video', 'card_grid',
  'feature_row', 'pricing_table', 'gallery', 'faq', 'stats', 'team', 'testimonials',
  'cta_banner', 'navbar', 'footer', 'social_links', 'contact_details', 'map',
  'newsletter_form', 'form_embed', 'booking_embed', 'product_grid', 'store_cart',
]);

export const Align = ['left', 'center', 'right'] as const;
export const Sizing = ['narrow', 'default', 'wide', 'full'] as const;

/**
 * Style keys the canvas and the published page both understand. Anything else is
 * dropped, which keeps a hand-edited jsonb document from becoming an XSS vector.
 */
export const styleSchema = z
  .object({
    align: z.enum(Align).optional(),
    color: z.string().max(32).optional(),
    background: z.string().max(64).optional(),
    padding_y: z.string().max(24).optional(),
    padding_x: z.string().max(24).optional(),
    gap: z.string().max(24).optional(),
    font_size: z.string().max(24).optional(),
    font_weight: z.string().max(16).optional(),
    line_height: z.string().max(16).optional(),
    radius: z.string().max(24).optional(),
    border_color: z.string().max(32).optional(),
    border_width: z.string().max(12).optional(),
    shadow: z.enum(['none', 'sm', 'md', 'lg']).optional(),
    width: z.enum(Sizing).optional(),
    columns: z.number().int().min(1).max(6).optional(),
    opacity: z.number().min(0).max(1).optional(),
  })
  .strict();

export type BlockStyle = z.infer<typeof styleSchema>;

export interface BlockNode {
  id: string;
  type: BlockType;
  props: Record<string, unknown>;
  styles: BlockStyle;
  children: BlockNode[];
}

export interface PageTree {
  type: 'page';
  id: string;
  props: Record<string, unknown>;
  styles: BlockStyle;
  children: BlockNode[];
}

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.string().refine((t) => blockTypes.has(t), 'Unknown block type'),
      props: z.record(z.string(), z.unknown()).default({}),
      styles: styleSchema.default({}),
      children: z.array(blockNodeSchema).default([]),
    })
    .strict() as unknown as z.ZodType<BlockNode>,
);

export const pageTreeSchema: z.ZodType<PageTree> = z
  .object({
    type: z.literal('page'),
    id: z.string().min(1).max(64),
    props: z.record(z.string(), z.unknown()).default({}),
    styles: styleSchema.default({}),
    children: z.array(blockNodeSchema),
  })
  .strict() as unknown as z.ZodType<PageTree>;

export function emptyPage(id = 'page-root'): PageTree {
  return { type: 'page', id, props: {}, styles: {}, children: [] };
}

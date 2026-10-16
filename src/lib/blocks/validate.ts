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

import type { BlockNode, BlockType, PageTree } from './types';

export type Place = { parentId: string; index: number };

/**
 * Pure tree operations. Each returns a new tree — the editor keeps a stack of
 * these for undo/redo, which only works if nothing ever mutates in place.
 *
 * Containment model: only `page`, `section`, `container` and `columns` have
 * children. Everything else is a leaf whose items live in `props` (an array of
 * cards, FAQ entries, gallery images). That keeps drag-and-drop to four legal
 * parents instead of an open-ended tree, and makes a dropped-into-itself
 * heading structurally impossible.
 */
const CONTAINER_TYPES = new Set<string>(['section', 'container']);

export function isContainer(type: 'page' | BlockType): boolean {
  return type === 'page' || type === 'section' || type === 'container' || type === 'columns';
}

export function canContain(parentType: 'page' | BlockType, childType: BlockType): boolean {
  if (parentType === 'columns') return childType === 'container';
  return CONTAINER_TYPES.has(parentType) || parentType === 'page';
}

export function findNode(tree: PageTree | BlockNode, id: string): BlockNode | PageTree | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** The page root is not a block and cannot be selected as one. */
export function findBlock(tree: PageTree, id: string): BlockNode | null {
  if (tree.id === id) return null;
  const stack: BlockNode[] = [...tree.children];
  while (stack.length > 0) {
    const node = stack.shift() as BlockNode;
    if (node.id === id) return node;
    stack.unshift(...node.children);
  }
  return null;
}

export function walk(
  tree: PageTree,
  visit: (node: BlockNode | PageTree, parentId: string | null, depth: number, index: number) => void,
): void {
  const step = (node: BlockNode | PageTree, parentId: string | null, depth: number, index: number) => {
    visit(node, parentId, depth, index);
    node.children.forEach((child, i) => step(child, node.id, depth + 1, i));
  };
  step(tree, null, 0, -1);
}

export function flatten(tree: PageTree) {
  const rows: { node: BlockNode; parentId: string; depth: number; index: number }[] = [];
  walk(tree, (node, parentId, depth, index) => {
    if (parentId !== null && node.type !== 'page') {
      rows.push({ node: node as BlockNode, parentId, depth, index });
    }
  });
  return rows;
}

export function countBlocks(tree: PageTree): number {
  return flatten(tree).length;
}

export function parentOf(tree: PageTree, id: string): string | null {
  let result: string | null = null;
  walk(tree, (node, parentId) => {
    if (node.id === id) result = parentId;
  });
  return result;
}

export function indexOfChild(tree: PageTree, parentId: string, childId: string): number {
  const parent = findNode(tree, parentId);
  if (!parent) return -1;
  return parent.children.findIndex((c) => c.id === childId);
}

export function isDescendant(node: BlockNode | PageTree, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((child) => isDescendant(child, id));
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(Math.max(0, Math.trunc(index)), length);
}

export function insertNode(tree: PageTree, node: BlockNode, place: Place): PageTree | null {
  let inserted = false;

  const step = (current: BlockNode | PageTree): BlockNode | PageTree => {
    if (!inserted && current.id === place.parentId) {
      inserted = true;
      const children = [...current.children];
      children.splice(clampIndex(place.index, children.length), 0, node);
      return { ...current, children };
    }
    return { ...current, children: current.children.map((c) => step(c) as BlockNode) };
  };

  const next = step(tree) as PageTree;
  return inserted ? next : null;
}

export function removeNode(tree: PageTree, id: string): { tree: PageTree; node: BlockNode | null } {
  let removed: BlockNode | null = null;

  const step = (current: BlockNode | PageTree): BlockNode | PageTree => {
    const keep = current.children.filter((child) => {
      if (child.id === id) {
        removed = child;
        return false;
      }
      return true;
    });

    if (keep.length !== current.children.length) {
      return { ...current, children: keep };
    }
    return { ...current, children: current.children.map((child) => step(child) as BlockNode) };
  };

  return { tree: step(tree) as PageTree, node: removed };
}

export function updateNode(
  tree: PageTree,
  id: string,
  patch: { props?: Record<string, unknown>; styles?: Partial<PageTree['styles']> },
): PageTree {
  const step = (current: BlockNode | PageTree): BlockNode | PageTree =>
    current.id === id
      ? {
          ...current,
          props: patch.props ? { ...current.props, ...patch.props } : current.props,
          styles: patch.styles ? { ...current.styles, ...patch.styles } : current.styles,
        }
      : { ...current, children: current.children.map((c) => step(c) as BlockNode) };

  return step(tree) as PageTree;
}

/**
 * Replace props wholesale. The properties panel uses this rather than
 * updateNode, because merging leaves stale keys when a field is cleared.
 */
export function replaceProps(tree: PageTree, id: string, props: Record<string, unknown>): PageTree {
  const step = (current: BlockNode | PageTree): BlockNode | PageTree =>
    current.id === id
      ? { ...current, props }
      : { ...current, children: current.children.map((c) => step(c) as BlockNode) };

  return step(tree) as PageTree;
}

export function moveNode(tree: PageTree, id: string, target: Place): PageTree | null {
  if (id === target.parentId) return tree;

  const node = findBlock(tree, id);
  if (!node) return tree;

  const targetParent = findNode(tree, target.parentId);
  if (!targetParent || !isContainer(targetParent.type)) return tree;

  // A container may not be dropped inside itself.
  if (isDescendant(node, target.parentId)) return tree;

  const childType = node.type;
  if (!canContain(targetParent.type, childType)) return tree;

  const sourceParentId = parentOf(tree, id);
  const sourceIndex = sourceParentId ? indexOfChild(tree, sourceParentId, id) : -1;
  const { tree: without, node: detached } = removeNode(tree, id);
  if (!detached) return tree;

  // Removing an earlier sibling of the same parent shifts the caret left one.
  const adjusted =
    sourceParentId === target.parentId && sourceIndex !== -1 && sourceIndex < target.index
      ? { ...target, index: target.index - 1 }
      : target;

  return insertNode(without, detached, adjusted);
}

export function relabel(node: BlockNode): BlockNode {
  return {
    ...node,
    id: makeBlockId(node.type),
    props: JSON.parse(JSON.stringify(node.props ?? {})) as Record<string, unknown>,
    styles: { ...node.styles },
    children: node.children.map(relabel),
  };
}

export function duplicateNode(tree: PageTree, id: string): { tree: PageTree; newId: string | null } {
  const node = findBlock(tree, id);
  const parentId = parentOf(tree, id);
  if (!node || !parentId) return { tree, newId: null };

  const fresh = relabel(node);
  const index = indexOfChild(tree, parentId, id);
  const next = insertNode(tree, fresh, { parentId, index: index + 1 });
  return { tree: next ?? tree, newId: fresh.id };
}

let counter = 0;
export function makeBlockId(type: BlockType | 'page'): string {
  counter += 1;
  const stamp = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${type.replace(/_/g, '-')}-${stamp}${rand}${counter.toString(36)}`;
}

/**
 * Rejects subtrees that could not be created by the editor: unknown parents,
 * cycles, or a node id used twice. Called on every save, because a hand-edited
 * jsonb value reaches this code just as easily as the canvas does.
 */
export function auditTree(tree: PageTree): string | null {
  const seen = new Set<string>();
  let duplicateId: string | null = null;
  let illegalChild: string | null = null;
  let tooDeep = false;

  walk(tree, (node, parentId, depth) => {
    if (seen.has(node.id)) duplicateId = node.id;
    seen.add(node.id);
    if (depth > 24) tooDeep = true;

    if (parentId && node.type !== 'page') {
      const parent = findNode(tree, parentId);
      if (parent && !canContain(parent.type, node.type)) illegalChild = node.id;
    }
  });

  if (duplicateId) return `Duplicate block id "${duplicateId}"`;
  if (illegalChild) return `Block "${illegalChild}" is nested inside a block that cannot hold it`;
  if (tooDeep) return 'Block nesting is too deep';
  if (countBlocks(tree) > 600) return 'This page has too many blocks';
  return null;
}

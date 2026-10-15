'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { BlockNode, BlockType, PageTree } from '@/lib/blocks/types';
import { REGISTRY } from '@/lib/blocks/registry';
import { defaultProps } from '@/lib/blocks/controls';
import { duplicateNode, findBlock, insertNode, makeBlockId, moveNode, removeNode, replaceProps, updateNode, type Place } from '@/lib/blocks/tree';
import type { BlockIssue } from '@/lib/types';

/**
 * The editor's mutable state: the tree, an undo stack, the selection and the
 * issues the last autosave reported.
 *
 * Every mutation goes through `commit`, which pushes the previous tree onto the
 * stack. The helpers in `src/lib/blocks/tree.ts` are pure, so a snapshot is a
 * cheap reference and nothing can mutate history out from under undo.
 *
 * The stacks live in refs and are mirrored into state for rendering: React's
 * strict mode runs state updaters twice to prove they are pure, and a push
 * inside an updater would double-book every step.
 */

const HISTORY_LIMIT = 80;

function containerNode(id: string): BlockNode {
  return { id, type: 'container', props: {}, styles: {}, children: [] };
}

/**
 * A block as it enters the canvas. `columns` is the one type that cannot exist
 * empty — the tree rules require exactly `count` containers, so the drop builds
 * them instead of leaving an invalid node behind.
 */
export function instantiate(type: BlockType): BlockNode {
  const def = REGISTRY[type];
  const id = makeBlockId(type);
  const node: BlockNode = { id, type, props: defaultProps(def), styles: {}, children: [] };

  if (type === 'columns') {
    const count = Math.max(2, Math.min(4, Number.parseInt(String(node.props.count ?? '2'), 10) || 2));
    node.children = Array.from({ length: count }, () => containerNode(makeBlockId('container')));
  }

  return node;
}

export interface BuilderApi {
  tree: PageTree;
  selectedId: string | null;
  selected: BlockNode | null;
  issues: Record<string, string>;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  select: (id: string | null) => void;
  addBlock: (type: BlockType, place: Place) => void;
  moveBlock: (id: string, place: Place) => void;
  setProps: (id: string, props: Record<string, unknown>) => void;
  patchProps: (id: string, props: Record<string, unknown>) => void;
  setStyles: (id: string, styles: Partial<PageTree['styles']>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (issues?: BlockIssue[]) => void;
}

export function useBuilder(initial: PageTree): BuilderApi {
  const [tree, setTree] = useState<PageTree>(initial);
  const [history, setHistory] = useState<{ past: PageTree[]; future: PageTree[] }>({ past: [], future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // The refs are what the callbacks read. They are initialised from the state
  // below and every later write happens in `commit`/`restore`, in the same tick
  // as the matching setState, so they cannot drift — and React's rules forbid
  // assigning a ref during render anyway.
  const treeRef = useRef(tree);
  const historyRef = useRef(history);

  // Coalescing keeps one undo step per field instead of one per keystroke.
  const coalesceRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });

  const commit = useCallback((next: PageTree, coalesceKey?: string) => {
    const now = Date.now();
    const merge =
      coalesceKey !== undefined && coalesceRef.current.key === coalesceKey && now - coalesceRef.current.at < 800;
    coalesceRef.current = { key: coalesceKey ?? null, at: now };

    if (!merge) {
      historyRef.current = {
        past: [...historyRef.current.past.slice(-(HISTORY_LIMIT - 1)), treeRef.current],
        future: [],
      };
      setHistory(historyRef.current);
    }

    treeRef.current = next;
    setTree(next);
    setDirty(true);
  }, []);

  const restore = useCallback((target: PageTree, direction: 'back' | 'forward') => {
    const current = historyRef.current;
    historyRef.current =
      direction === 'back'
        ? {
            past: current.past.slice(0, -1),
            future: [treeRef.current, ...current.future].slice(0, HISTORY_LIMIT),
          }
        : {
            past: [...current.past, treeRef.current].slice(-HISTORY_LIMIT),
            future: current.future.slice(1),
          };

    coalesceRef.current = { key: null, at: 0 };
    setHistory(historyRef.current);
    treeRef.current = target;
    setTree(target);
    setDirty(true);
  }, []);

  const addBlock = useCallback(
    (type: BlockType, place: Place) => {
      const node = instantiate(type);
      const next = insertNode(treeRef.current, node, place);
      if (!next) return;
      commit(next);
      setSelectedId(node.id);
    },
    [commit],
  );

  const moveBlock = useCallback(
    (id: string, place: Place) => {
      const next = moveNode(treeRef.current, id, place);
      if (!next || next === treeRef.current) return;
      commit(next);
      setSelectedId(id);
    },
    [commit],
  );

  const setProps = useCallback(
    (id: string, props: Record<string, unknown>) => {
      commit(replaceProps(treeRef.current, id, props), `props:${id}`);
    },
    [commit],
  );

  const patchProps = useCallback(
    (id: string, props: Record<string, unknown>) => {
      const current = findBlock(treeRef.current, id);
      if (!current) return;
      commit(replaceProps(treeRef.current, id, { ...current.props, ...props }), `props:${id}`);
    },
    [commit],
  );

  const setStyles = useCallback(
    (id: string, styles: Partial<PageTree['styles']>) => {
      commit(updateNode(treeRef.current, id, { styles }), `style:${id}`);
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      const { tree: next, node } = removeNode(treeRef.current, id);
      if (!node) return;
      commit(next);
      setSelectedId((current) => (current === id ? null : current));
    },
    [commit],
  );

  const duplicate = useCallback(
    (id: string) => {
      const { tree: next, newId } = duplicateNode(treeRef.current, id);
      if (!newId) return;
      commit(next);
      setSelectedId(newId);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const current = historyRef.current;
    const target = current.past[current.past.length - 1];
    if (target) restore(target, 'back');
  }, [restore]);

  const redo = useCallback(() => {
    const current = historyRef.current;
    const target = current.future[0];
    if (target) restore(target, 'forward');
  }, [restore]);

  const markSaved = useCallback((nextIssues?: BlockIssue[]) => {
    setDirty(false);
    setIssues(Object.fromEntries((nextIssues ?? []).map((issue) => [issue.blockId, issue.message])));
  }, []);

  const selected = useMemo(() => (selectedId ? findBlock(tree, selectedId) : null), [tree, selectedId]);

  return {
    tree,
    selectedId,
    selected,
    issues,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dirty,
    select: setSelectedId,
    addBlock,
    moveBlock,
    setProps,
    patchProps,
    setStyles,
    remove,
    duplicate,
    undo,
    redo,
    markSaved,
  };
}

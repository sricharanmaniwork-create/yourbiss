import type { DragEvent } from 'react';
import type { BlockType } from '@/lib/blocks/types';

/**
 * What is currently in flight.
 *
 * `dataTransfer.getData()` is deliberately unreadable during `dragover` (the
 * spec only exposes it after `drop`), so a caret cannot ask the event what is
 * being dragged in order to decide whether to light up. This module keeps the
 * payload in memory for the duration of the drag; the event copy is what
 * survives into `drop`, including for drags started by another window.
 */
export type DragPayload =
  | { kind: 'new'; type: BlockType }
  | { kind: 'move'; id: string; childType: BlockType };

let live: DragPayload | null = null;

export function setLiveDrag(payload: DragPayload | null): void {
  live = payload;
}

export function getLiveDrag(): DragPayload | null {
  return live;
}

export function startDrag(
  event: DragEvent<Element>,
  payload: DragPayload,
  label: string,
): boolean {
  const dt = event.dataTransfer;
  if (!dt) return false;
  dt.effectAllowed = payload.kind === 'move' ? 'move' : 'copy';
  try {
    dt.setData('application/x-yourbiss-block', JSON.stringify(payload));
    // Some browsers only begin a drag if a recognised flavour is present too.
    dt.setData('text/plain', label);
  } catch {
    /* A private-mode window can refuse setData. The in-memory copy still works. */
  }
  setLiveDrag(payload);
  return true;
}

export function writeDrag(event: DragEvent<Element>, payload: DragPayload): void {
  const dt = event.dataTransfer;
  if (!dt) return;
  dt.effectAllowed = payload.kind === 'move' ? 'move' : 'copy';
  try {
    dt.setData('text/plain', JSON.stringify(payload));
  } catch {
    /* ignored — see startDrag */
  }
  setLiveDrag(payload);
}

/** Parse a payload, rejecting anything that is not a block we know how to place. */
function parse(raw: string): DragPayload | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (o.kind === 'new' && typeof o.type === 'string') {
    return { kind: 'new', type: o.type as BlockType };
  }
  if (o.kind === 'move' && typeof o.id === 'string' && typeof o.childType === 'string') {
    return { kind: 'move', id: o.id, childType: o.childType as BlockType };
  }
  return null;
}

export function readDrag(event: DragEvent<Element>): DragPayload | null {
  let payload: DragPayload | null = null;
  try {
    payload =
      parse(event.dataTransfer?.getData('application/x-yourbiss-block') ?? '') ??
      parse(event.dataTransfer?.getData('text/plain') ?? '');
  } catch {
    payload = null;
  }
  return payload ?? live;
}

/** Readable inside `dragover`, where the event itself cannot be. */
export function peekDrag(event: DragEvent<Element>): DragPayload | null {
  if (live) return live;
  const types = event.dataTransfer?.types;
  if (!types) return null;
  return Array.from(types).some(
    (t) => t === 'application/x-yourbiss-block' || t === 'text/plain',
  )
    ? live
    : null;
}

export function endDrag(): void {
  live = null;
}

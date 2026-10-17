'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership } from '@/lib/supabase/admin';
import { endOfDayInZone } from '@/lib/utils';
import type { ActionState, BoardProjectStatus } from '@/lib/types';

/**
 * Every write Projects makes.
 *
 * Two things here are deliberately not done the way the other apps do them.
 *
 * The first is the audit line. `board_task_guard` and `board_create_project` in 0014
 * write into `activity_log` themselves, so a card that reaches the done lane is recorded
 * by the same statement that moved it — and these actions must not log a second time,
 * which would give Automations two events for one drag.
 *
 * The second is what "finished" means. No action here sets `completed_at`: the lane the
 * card is standing in decides it, in the trigger, because a screen that forgets the flag
 * would leave a card marked done in a lane called To do. What a caller can say is which
 * lane, and nothing else.
 *
 * Everything else is the usual three checks: is this row in this workspace, is this
 * person a member of it, and is the shape of what was typed what the table can hold.
 */

const uuid = z.string().uuid();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const projectSchema = z.object({
  name: z.string().trim().min(1, 'Give the board a name').max(80, 'A board name is at most 80 characters'),
  summary: z.string().trim().max(500, 'One sentence is enough').default(''),
  status: z.enum(['active', 'paused', 'completed']).default('active'),
});

const laneSchema = z.object({
  name: z.string().trim().min(1, 'Give the lane a name').max(40, 'A lane name is at most 40 characters'),
  is_done: z.boolean().default(false),
});

const cardSchema = z.object({
  title: z.string().trim().min(1, 'Say what has to be done').max(200, 'A card title is at most 200 characters'),
  details: z.string().trim().max(4000, 'That is longer than one card holds').default(''),
  assignee_id: z.string().trim().default(''),
  due_day: z
    .string()
    .trim()
    .refine((value) => value === '' || DAY.test(value), 'Pick a day, not a moment'),
});

function boardError(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '23505') return 'This board already has something with that name';
  if (error.code === '42501') return 'Only a member of this workspace can change its boards';
  // 23503 is the lane that still holds cards, 23514 and 42809 the guards above. All of
  // them are written as sentences for the person standing at the screen, so the
  // database gets the last word rather than a generic "something went wrong".
  return error.message || fallback;
}

function revalidateBoard(projectId?: string) {
  revalidatePath('/app/board');
  revalidatePath('/app/board/tasks');
  if (projectId) revalidatePath(`/app/board/${projectId}`);
}

/** The workspace's own clock, because a due day means the end of a day somewhere. */
async function zoneOf(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<string> {
  const { data, error } = await supabase.from('orgs').select('timezone').eq('id', orgId).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { timezone: string } | null;
  return row?.timezone ?? 'UTC';
}

/**
 * Whose workspace a row lives in, read through the caller's own session.
 *
 * RLS decides whether the row is visible at all, so a id from a browser cannot name
 * another workspace's board — it simply is not here.
 */
async function scope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: 'board_projects' | 'board_columns' | 'board_tasks',
  id: string,
): Promise<{ org_id: string; project_id?: string; column_id?: string } | null> {
  if (!uuid.safeParse(id).success) return null;
  const wanted = table === 'board_projects' ? 'id, org_id' : 'id, org_id, project_id, column_id';
  const { data, error } = await supabase.from(table).select(wanted).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { org_id: string; project_id?: string; column_id?: string } | null) ?? null;
}

/**
 * The assignee has to be somebody in this workspace.
 *
 * `board_tasks.assignee_id` points at `auth.users`, which holds every person on the
 * platform, so the foreign key alone would accept a stranger's id and print an empty
 * name on the card. A member choosing from a list cannot get it wrong; a request can.
 */
async function assignee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  value: string,
): Promise<string | null | { error: string }> {
  if (value === '') return null;
  if (!uuid.safeParse(value).success) return { error: 'That person is not in this workspace' };

  const { data, error } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? value : { error: 'That person is not in this workspace' };
}

// --- boards -----------------------------------------------------------------

export async function createBoard(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can start a board' };

  const { data, error } = await supabase.rpc('board_create_project', {
    p_org_id: orgId,
    p_name: parsed.data.name,
    p_summary: parsed.data.summary === '' ? null : parsed.data.summary,
  });
  if (error) return { ok: false, error: boardError(error, 'That board could not be started') };

  const id = (data as { project_id?: string } | null)?.project_id;
  revalidateBoard(id);
  return { ok: true, id };
}

export async function updateBoard(boardId: string, input: unknown): Promise<ActionState> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const board = await scope(supabase, 'board_projects', boardId);
  if (!board) return { ok: false, error: 'That board is not in this workspace' };

  const actor = await assertMembership(supabase, board.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change its boards' };

  const { error } = await supabase
    .from('board_projects')
    .update({
      name: parsed.data.name,
      summary: parsed.data.summary === '' ? null : parsed.data.summary,
      status: parsed.data.status as BoardProjectStatus,
    })
    .eq('id', boardId);
  if (error) return { ok: false, error: boardError(error, 'That board could not be saved') };

  revalidateBoard(boardId);
  return { ok: true };
}

export async function deleteBoard(boardId: string): Promise<ActionState> {
  const supabase = await createClient();
  const board = await scope(supabase, 'board_projects', boardId);
  if (!board) return { ok: false, error: 'That board is not in this workspace' };

  const actor = await assertAdmin(supabase, board.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only the owner or an admin can delete a board' };

  const { error } = await supabase.from('board_projects').delete().eq('id', boardId);
  if (error) return { ok: false, error: boardError(error, 'That board could not be deleted') };

  revalidateBoard();
  return { ok: true };
}

// --- lanes ------------------------------------------------------------------

export async function addLane(boardId: string, input: unknown): Promise<ActionState> {
  const parsed = laneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const board = await scope(supabase, 'board_projects', boardId);
  if (!board) return { ok: false, error: 'That board is not in this workspace' };

  const actor = await assertMembership(supabase, board.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change its boards' };

  // No position: 0014's guard puts a new lane at the right end of the board.
  const { error } = await supabase
    .from('board_columns')
    .insert({
      org_id: board.org_id,
      project_id: boardId,
      name: parsed.data.name,
      is_done: parsed.data.is_done,
    });
  if (error) return { ok: false, error: boardError(error, 'That lane could not be added') };

  revalidateBoard(boardId);
  return { ok: true };
}

export async function updateLane(laneId: string, input: unknown): Promise<ActionState> {
  const parsed = laneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const lane = await scope(supabase, 'board_columns', laneId);
  if (!lane?.project_id) return { ok: false, error: 'That lane is not in this workspace' };

  const actor = await assertMembership(supabase, lane.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change its boards' };

  const { error } = await supabase
    .from('board_columns')
    .update({ name: parsed.data.name, is_done: parsed.data.is_done })
    .eq('id', laneId);
  if (error) return { ok: false, error: boardError(error, 'That lane could not be saved') };

  revalidateBoard(lane.project_id);
  return { ok: true };
}

/**
 * Slide a lane one place left or right.
 *
 * Two reads and two writes, both of them a single integer, and no transaction around
 * them: if a second person moves the same lane at the same moment the worst case is two
 * lanes with the same number, and every read falls back to the moment they were made.
 */
export async function moveLane(laneId: string, direction: 'left' | 'right'): Promise<ActionState> {
  const supabase = await createClient();
  const lane = await scope(supabase, 'board_columns', laneId);
  if (!lane?.project_id) return { ok: false, error: 'That lane is not in this workspace' };

  const actor = await assertMembership(supabase, lane.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change its boards' };

  const { data, error } = await supabase
    .from('board_columns')
    .select('id, position')
    .eq('project_id', lane.project_id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: boardError(error, 'The board could not be read') };

  const lanes = (data ?? []) as unknown as { id: string; position: number }[];
  const index = lanes.findIndex((row) => row.id === laneId);
  const target = direction === 'left' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= lanes.length) return { ok: true };

  const neighbour = lanes[target]!;
  const mine = lanes[index]!;

  const swapped = await supabase
    .from('board_columns')
    .update({ position: mine.position })
    .eq('id', neighbour.id);
  if (swapped.error) return { ok: false, error: boardError(swapped.error, 'That lane could not be moved') };

  const settled = await supabase
    .from('board_columns')
    .update({ position: neighbour.position })
    .eq('id', laneId);
  if (settled.error) return { ok: false, error: boardError(settled.error, 'That lane could not be moved') };

  revalidateBoard(lane.project_id);
  return { ok: true };
}

export async function deleteLane(laneId: string): Promise<ActionState> {
  const supabase = await createClient();
  const lane = await scope(supabase, 'board_columns', laneId);
  if (!lane?.project_id) return { ok: false, error: 'That lane is not in this workspace' };

  const actor = await assertMembership(supabase, lane.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change its boards' };

  const { error } = await supabase.from('board_columns').delete().eq('id', laneId);
  // The guard refuses a lane that still holds cards, and its sentence is the answer the
  // person at the screen needs: where to move them, not that a constraint failed.
  if (error) return { ok: false, error: boardError(error, 'That lane could not be removed') };

  revalidateBoard(lane.project_id);
  return { ok: true };
}

// --- cards ------------------------------------------------------------------

export async function addCard(laneId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const lane = await scope(supabase, 'board_columns', laneId);
  if (!lane?.project_id) return { ok: false, error: 'That lane is not in this workspace' };

  const actor = await assertMembership(supabase, lane.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can add work to it' };

  const who = await assignee(supabase, lane.org_id, parsed.data.assignee_id);
  // `null` here means "nobody yet", so the error object is checked for rather than assumed
  // from the type — `typeof null` is 'object' too.
  if (who !== null && typeof who === 'object') return { ok: false, error: who.error, fields: { assignee_id: who.error } };

  const zone = await zoneOf(supabase, lane.org_id);
  const dueAt = parsed.data.due_day === '' ? null : endOfDayInZone(parsed.data.due_day, zone);

  const { data, error } = await supabase
    .from('board_tasks')
    .insert({
      org_id: lane.org_id,
      project_id: lane.project_id,
      column_id: laneId,
      title: parsed.data.title,
      details: parsed.data.details === '' ? null : parsed.data.details,
      assignee_id: who,
      due_at: dueAt,
      created_by: actor.userId,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: boardError(error, 'That card could not be added') };

  revalidateBoard(lane.project_id);
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateCard(cardId: string, input: unknown): Promise<ActionState> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const card = await scope(supabase, 'board_tasks', cardId);
  if (!card?.project_id) return { ok: false, error: 'That card is not in this workspace' };

  const actor = await assertMembership(supabase, card.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can change its boards' };

  const who = await assignee(supabase, card.org_id, parsed.data.assignee_id);
  if (who !== null && typeof who === 'object') return { ok: false, error: who.error, fields: { assignee_id: who.error } };

  // The editor sends the day it is showing, so an empty picker here really does mean "no
  // longer due", and there is no third state to guess at.
  const zone = await zoneOf(supabase, card.org_id);
  const dueAt = parsed.data.due_day === '' ? null : endOfDayInZone(parsed.data.due_day, zone);

  const { error } = await supabase
    .from('board_tasks')
    .update({
      title: parsed.data.title,
      details: parsed.data.details === '' ? null : parsed.data.details,
      assignee_id: who,
      due_at: dueAt,
    })
    .eq('id', cardId);
  if (error) return { ok: false, error: boardError(error, 'That card could not be saved') };

  revalidateBoard(card.project_id);
  return { ok: true };
}

/**
 * Put a card in another lane.
 *
 * This is the only write that changes what "finished" means, and it changes it by moving
 * the card rather than by setting a date: 0014's guard stamps or clears `completed_at`
 * and writes the line in the timeline that tells Automations it happened.
 */
export async function moveCard(cardId: string, laneId: string): Promise<ActionState> {
  if (!uuid.safeParse(laneId).success) return { ok: false, error: 'That lane is not one of this board’s' };

  const supabase = await createClient();
  const card = await scope(supabase, 'board_tasks', cardId);
  if (!card?.project_id) return { ok: false, error: 'That card is not in this workspace' };

  const lane = await scope(supabase, 'board_columns', laneId);
  if (!lane?.project_id || lane.project_id !== card.project_id) {
    return { ok: false, error: 'A card can only move to a lane on its own board' };
  }

  const actor = await assertMembership(supabase, card.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can move its cards' };

  if (card.column_id === laneId) return { ok: true };

  const { error } = await supabase.from('board_tasks').update({ column_id: laneId }).eq('id', cardId);
  if (error) return { ok: false, error: boardError(error, 'That card could not be moved') };

  revalidateBoard(card.project_id);
  return { ok: true };
}

export async function deleteCard(cardId: string): Promise<ActionState> {
  const supabase = await createClient();
  const card = await scope(supabase, 'board_tasks', cardId);
  if (!card?.project_id) return { ok: false, error: 'That card is not in this workspace' };

  const actor = await assertMembership(supabase, card.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can delete its cards' };

  const { error } = await supabase.from('board_tasks').delete().eq('id', cardId);
  if (error) return { ok: false, error: boardError(error, 'That card could not be deleted') };

  revalidateBoard(card.project_id);
  return { ok: true };
}

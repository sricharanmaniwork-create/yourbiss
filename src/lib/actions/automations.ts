'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertAdmin, assertMembership } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/actions/activity';
import { runWorkspaceAutomations } from '@/lib/automations/engine';
import { sendsToRecord, writesToCrm } from '@/lib/automations/capabilities';
import type {
  ActionState,
  AutomationAction,
  AutomationCondition,
  AutomationEvent,
} from '@/lib/types';

/**
 * Every write Automations makes.
 *
 * This file validates a rule twice over. Once here, so a mistake comes back as a
 * sentence beside the input that caused it, and once again inside the database, by
 * `youbiss.automation_rule_guard` — because a rule is the one record in the product
 * that something other than a person reads afterwards. The runner sits in front of a
 * mailbox and a CRM timeline, and a rule that saved with a half-written action would
 * discover that at three in the morning, on an event nobody is watching.
 *
 * So the two validations say the same thing, and the database gets the last word:
 * a condition names a field that record really has, an operator is one of the seven
 * the runner implements, an action is a CRM activity or a letter — never a third thing
 * the runner would silently skip — and the action is one that record can carry out,
 * because a letter addressed to an email a row does not have only ever fails at run time.
 */

const uuid = z.string().uuid();

function fieldErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** `''` in a number box means "not asked", which is a missing key rather than a zero. */
const optionalDays = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.union([z.null(), z.coerce.number().int().min(0, 'A due date cannot be in the past').max(365, 'A task is due within a year')]),
);

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

const conditionSchema = z.object({
  field: z.string().trim().min(1, 'Choose which part of the record to look at').max(40),
  op: z.enum(['equals', 'not_equals', 'contains', 'greater', 'less', 'is_empty', 'is_not_empty']),
  value: z.string().trim().max(200, 'A condition value is at most 200 characters').default(''),
});

const activitySchema = z.object({
  type: z.literal('crm_activity'),
  kind: z.enum(['note', 'call', 'task']),
  subject: z.string().trim().min(1, 'Give the activity a subject').max(200),
  body: z.string().trim().max(4000, 'That is longer than one activity holds').default(''),
  due_days: optionalDays.nullable().default(null),
});

const letterSchema = z.object({
  type: z.literal('letter'),
  to: z.enum(['record', 'owner', 'address']),
  subject: z.string().trim().min(1, 'A letter needs a subject').max(200),
  body: z.string().trim().min(1, 'A letter needs something to say').max(4000, 'That is longer than one letter holds'),
  address: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value === '' || EMAIL.test(value), 'Enter a real email address')
    .default(''),
});

const actionSchema = z.discriminatedUnion('type', [activitySchema, letterSchema]);

const ruleSchema = z.object({
  name: z.string().trim().min(1, 'Give the rule a name').max(120),
  /** `app|entity_type|action`, the three columns of the event's row in the catalogue. */
  event: z.string().trim().min(1, 'Choose what the rule watches for'),
  conditions: z.array(conditionSchema).max(6, 'Six questions is as many as one rule asks'),
  actions: z.array(actionSchema).min(1, 'A rule has to do something').max(4, 'Four actions is as many as one rule takes'),
  enabled: z.boolean().default(false),
});

/**
 * The catalogue, read through the caller's own session.
 *
 * It is a table rather than a list here on purpose: this is the same set of rows the
 * rules' foreign key points at, so a screen that offers an event and a database that
 * accepts one can never be two different answers.
 */
async function catalogue(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AutomationEvent[]> {
  const { data, error } = await supabase.rpc('automation_triggers');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AutomationEvent[];
}

interface Shape {
  app: AutomationEvent['app'];
  entity_type: string;
  action: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

/**
 * Turn the form into the columns, or say which line of the form is wrong.
 *
 * `is_empty` and `is_not_empty` carry no value at all — the guard refuses the key as
 * well as an empty string, so the value is dropped here instead of sent as `''`.
 */
function shape(input: z.infer<typeof ruleSchema>, events: AutomationEvent[]): Shape | { fields: Record<string, string>; error: string } {
  const [app, entityType, action] = input.event.split('|');
  const event = events.find((e) => e.app === app && e.entity_type === entityType && e.action === action);
  if (!event || !app) return { error: 'That event is not one the suite writes', fields: { event: 'Choose an event the suite really writes' } };

  const known = new Map(event.fields.map((f) => [f.name, f.kind]));
  const fields: Record<string, string> = {};
  const conditions: AutomationCondition[] = [];

  input.conditions.forEach((condition, index) => {
    const kind = known.get(condition.field);
    if (!kind) {
      fields[`conditions.${index}.field`] = `A ${event.entity_type} row has no “${condition.field}”`;
      return;
    }
    if (condition.op === 'is_empty' || condition.op === 'is_not_empty') {
      conditions.push({ field: condition.field, op: condition.op });
      return;
    }
    if (condition.value === '') {
      fields[`conditions.${index}.value`] = 'Say what to compare it against';
      return;
    }
    if (kind === 'money' && !/^-?\d+(\.\d+)?$/.test(condition.value)) {
      fields[`conditions.${index}.value`] = 'Compare an amount against a number, like 5000';
      return;
    }
    conditions.push({ field: condition.field, op: condition.op, value: condition.value });
  });

  const built: AutomationAction[] = [];
  const record = event.entity_type.replace(/_/g, ' ');
  input.actions.forEach((item, index) => {
    if (item.type === 'crm_activity') {
      if (!writesToCrm(event.entity_type)) {
        fields[`actions.${index}.type`] = `A ${record} row is not somebody in CRM and has no email to match one with, so this event can only send a letter`;
        return;
      }
      if (item.kind !== 'task' && item.due_days !== null) {
        fields[`actions.${index}.due_days`] = 'Only a task can be due';
        return;
      }
      built.push({
        type: 'crm_activity',
        kind: item.kind,
        subject: item.subject,
        ...(item.body === '' ? {} : { body: item.body }),
        ...(item.kind === 'task' && item.due_days !== null ? { due_days: item.due_days } : {}),
      });
      return;
    }

    if (item.to === 'record' && !sendsToRecord(event.entity_type)) {
      fields[`actions.${index}.to`] = `A ${record} row has no email address of its own, so this letter has to go to the owner or one fixed address`;
      return;
    }
    if (item.to === 'address' && !EMAIL.test(item.address)) {
      fields[`actions.${index}.address`] = 'A letter to one fixed address needs a real address';
      return;
    }
    built.push({
      type: 'letter',
      to: item.to,
      subject: item.subject,
      body: item.body,
      ...(item.to === 'address' ? { address: item.address } : {}),
    });
  });

  if (Object.keys(fields).length > 0) return { error: 'Check the highlighted lines', fields };
  if (built.length === 0) return { error: 'A rule has to do something', fields: { actions: 'Add something for the rule to do' } };

  return {
    app: event.app,
    entity_type: event.entity_type,
    action: event.action,
    conditions,
    actions: built,
  };
}

function automationsError(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '23505') return 'This workspace already has a rule with that name';
  if (error.code === '42501') return 'Only a member of this workspace can change its automations';
  if (error.code === '23503') return 'Another app still refers to this rule';
  // 23514 and 42703 come from the shape guard, whose sentences are written for the
  // person who just typed the rule, so the database gets the last word.
  return error.message || fallback;
}

function revalidateAutomations(ruleId?: string) {
  revalidatePath('/app/automations');
  revalidatePath('/app/automations/rules');
  revalidatePath('/app/automations/runs');
  if (ruleId) revalidatePath(`/app/automations/rules/${ruleId}`);
}

interface RuleRef {
  id: string;
  name: string;
  enabled: boolean;
  org_id: string;
}

/**
 * One read for the four checks every write needs: that the rule exists at all, whose
 * workspace it is, and whether it is switched on.
 *
 * Reading through the caller's session is what makes the first answer trustworthy —
 * RLS decides whether this person sees the row, so a rule from another workspace is
 * simply not here, and no id handed in by a browser gets to name one.
 */
async function loadRule(supabase: Awaited<ReturnType<typeof createClient>>, ruleId: string): Promise<RuleRef | null> {
  if (!uuid.safeParse(ruleId).success) return null;
  const { data, error } = await supabase
    .from('automation_rules')
    .select('id, name, enabled, org_id')
    .eq('id', ruleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as RuleRef | null) ?? null;
}

// --- rules -------------------------------------------------------------------

export async function createAutomationRule(orgId: string, input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can write an automation' };

  const built = await shape(parsed.data, await catalogue(supabase));
  if ('error' in built) return { ok: false, error: built.error, fields: built.fields };

  const { data, error } = await supabase
    .from('automation_rules')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      app: built.app,
      entity_type: built.entity_type,
      action: built.action,
      conditions: built.conditions,
      actions: built.actions,
      created_by: actor.userId,
    })
    .select('id, name')
    .single();
  if (error) return { ok: false, error: automationsError(error, 'That rule could not be saved') };

  const rule = data as unknown as { id: string; name: string };
  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'automations',
    entityType: 'automation_rule',
    entityId: rule.id,
    action: 'created',
    summary: `Wrote the rule “${rule.name}”${rule.name === parsed.data.name && parsed.data.enabled ? ', and switched it on' : ', switched off'}`,
  });

  revalidateAutomations(rule.id);
  return { ok: true, id: rule.id };
}

export async function updateAutomationRule(ruleId: string, input: unknown): Promise<ActionState> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check the highlighted fields', fields: fieldErrors(parsed.error.issues) };

  const supabase = await createClient();
  const before = await loadRule(supabase, ruleId);
  if (!before) return { ok: false, error: 'That rule is not in a workspace you can change' };

  const built = await shape(parsed.data, await catalogue(supabase));
  if ('error' in built) return { ok: false, error: built.error, fields: built.fields };

  const { error } = await supabase
    .from('automation_rules')
    .update({
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      app: built.app,
      entity_type: built.entity_type,
      action: built.action,
      conditions: built.conditions,
      actions: built.actions,
    })
    .eq('id', ruleId);
  if (error) return { ok: false, error: automationsError(error, 'That rule could not be saved') };

  const actor = await assertMembership(supabase, before.org_id).catch(() => null);
  if (actor) {
    await logActivity(supabase, {
      orgId: before.org_id,
      actorId: actor.userId,
      appKey: 'automations',
      entityType: 'automation_rule',
      entityId: ruleId,
      action: 'updated',
      summary: `Rewrote the rule “${parsed.data.name}”`,
    });
  }

  revalidateAutomations(ruleId);
  return { ok: true };
}

/**
 * The switch on its own, because it is the only thing a person flips twice a week.
 *
 * Writing an activity row here is what makes "why did the letters start Tuesday"
 * answerable, so the change is recorded as `enabled` or `disabled` rather than the
 * generic `updated` the rest of the product uses for a form field.
 */
export async function setAutomationRuleEnabled(ruleId: string, enabled: boolean): Promise<ActionState> {
  const supabase = await createClient();
  const rule = await loadRule(supabase, ruleId);
  if (!rule) return { ok: false, error: 'That rule is not in a workspace you can change' };
  if (rule.enabled === enabled) return { ok: true };

  const actor = await assertMembership(supabase, rule.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can switch a rule' };

  const { error } = await supabase.from('automation_rules').update({ enabled }).eq('id', ruleId);
  if (error) return { ok: false, error: automationsError(error, 'That switch did not take') };

  await logActivity(supabase, {
    orgId: rule.org_id,
    actorId: actor.userId,
    appKey: 'automations',
    entityType: 'automation_rule',
    entityId: ruleId,
    action: enabled ? 'enabled' : 'disabled',
    summary: `${enabled ? 'Switched on' : 'Switched off'} the rule “${rule.name}”`,
  });

  revalidateAutomations(ruleId);
  return { ok: true };
}

/** Off is required first, so a click cannot erase a rule that is still firing. */
export async function deleteAutomationRule(ruleId: string): Promise<ActionState> {
  const supabase = await createClient();
  const rule = await loadRule(supabase, ruleId);
  if (!rule) return { ok: false, error: 'That rule is not in a workspace you can change' };

  const actor = await assertAdmin(supabase, rule.org_id).catch(() => null);
  if (!actor) return { ok: false, error: 'Only an owner or admin can remove a rule' };
  if (rule.enabled) return { ok: false, error: 'Switch the rule off before removing it, so nothing is mid-run' };

  const { error } = await supabase.from('automation_rules').delete().eq('id', ruleId);
  if (error) return { ok: false, error: automationsError(error, 'That rule could not be removed') };

  await logActivity(supabase, {
    orgId: rule.org_id,
    actorId: actor.userId,
    appKey: 'automations',
    entityType: 'automation_rule',
    entityId: ruleId,
    action: 'deleted',
    // The rule's own runs go with it — the cascade is what keeps a run from pointing
    // at a rule that no longer exists — so this sentence is the only record left.
    summary: `Removed the rule “${rule.name}” and its run history`,
  });

  revalidateAutomations();
  return { ok: true };
}

// --- running -----------------------------------------------------------------

/**
 * Run this workspace's switched-on rules against everything they have not seen.
 *
 * The same entry point the cron door uses, which is the point: a person standing at
 * the screen and a scheduler arriving at three in the morning ask the same question of
 * the same runner, so a rule tested with "Run now" behaves the way it will tomorrow.
 */
export async function runAutomationsNow(
  orgId: string,
): Promise<ActionState & { scanned?: number; done?: number; skipped?: number; failed?: number }> {
  const supabase = await createClient();
  const actor = await assertMembership(supabase, orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'Only a member of this workspace can run its automations' };

  const tally = await runWorkspaceAutomations(orgId);

  await logActivity(supabase, {
    orgId,
    actorId: actor.userId,
    appKey: 'automations',
    entityType: 'automation_run',
    entityId: orgId,
    action: 'ran',
    summary: `Ran the automations by hand: ${tally.scanned} event(s) looked at, ${tally.done} done, ${tally.failed} failed`,
  });

  revalidateAutomations();
  return { ok: true, scanned: tally.scanned, done: tally.done, skipped: tally.skipped, failed: tally.failed };
}

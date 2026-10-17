import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/mail';
import { emailColumn } from '@/lib/automations/capabilities';
import { automationLetter, mailBase } from '@/lib/mail/templates';
import { formatAmount, formatDateInZone } from '@/lib/utils';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationEvent,
  AutomationRule,
} from '@/lib/types';

/**
 * The runner.
 *
 * It reads the timeline the other apps already write — `activity_log`, created in 0002
 * — and asks each switched-on rule whether the event is one it watches and whether the
 * record it happened to passes the conditions. Everything else about Automations is
 * paperwork around those two questions.
 *
 * Three things shape how it is written:
 *
 * * It runs as `service_role`, so every read carries the workspace's own id. A rule's
 *   `org_id` is the only tenant it will ever look at, and a record whose row belongs to
 *   another workspace is not found rather than discussed.
 * * One event runs one rule once. `automation_runs` is unique on (rule_id, log_id), so a
 *   second runner, a retried cron tick or a double-clicked "run now" all lose the race
 *   quietly instead of sending the customer a second letter.
 * * A failure is written down, not swallowed. If a letter cannot be sent because nothing
 *   is configured, the run says `failed` and the hub shows the reason — which is the only
 *   way a rule that never fires can be found at all.
 */

export interface AutomationRunTally {
  scanned: number;
  matched: number;
  done: number;
  skipped: number;
  failed: number;
}

/**
 * How far one pass reaches, per rule. A runner that reads the whole history would be a
 * runner that never finishes; twenty is more than a workspace's quietest day and less
 * than a bus rush can hide behind, and the next tick takes the rest.
 */
const BATCH = 20;

/**
 * Where the record behind an event lives, and which of its columns may be read.
 *
 * The list is deliberately narrower than the table: these are the columns the catalogue
 * in `automation_events` names, plus `contact_id` on an order, which checkout already
 * decided. Which column holds a person's email address is not here — it is
 * `emailColumn()` in `capabilities.ts`, because the builder has to ask the same question
 * before it offers an action. Anything else a rule might ask about is refused before this,
 * by the foreign key and the shape guard 0013 installs.
 */
const RECORDS: Record<string, { table: string; columns: string[] }> = {
  form_submission: {
    table: 'form_submissions',
    columns: ['id', 'org_id', 'form_id', 'state', 'submitter_email', 'created_at'],
  },
  booking: {
    table: 'bookings',
    columns: [
      'id',
      'org_id',
      'state',
      'source',
      'service_id',
      'staff_id',
      'customer_name',
      'customer_email',
      'cancel_reason',
      'starts_at',
      'timezone',
    ],
  },
  crm_lead: {
    table: 'crm_leads',
    columns: [
      'id',
      'org_id',
      'status',
      'source',
      'name',
      'email',
      'company',
      'owner_id',
      'converted_contact_id',
      'converted_deal_id',
    ],
  },
  inv_purchase: {
    table: 'inv_purchases',
    columns: ['id', 'org_id', 'status', 'supplier_id', 'number', 'order_date', 'expected_date'],
  },
  store_order: {
    table: 'store_orders',
    columns: [
      'id',
      'org_id',
      'status',
      'number',
      'buyer_name',
      'buyer_email',
      'subtotal',
      'shipping',
      'tax_total',
      'total',
      'paid_at',
      'contact_id',
    ],
  },
  site: {
    table: 'sites',
    columns: ['id', 'org_id', 'name', 'slug', 'status'],
  },
  board_project: {
    table: 'board_projects',
    columns: ['id', 'org_id', 'name', 'summary', 'status'],
  },
  board_task: {
    table: 'board_tasks',
    columns: [
      'id',
      'org_id',
      'project_id',
      'column_id',
      'title',
      'details',
      'assignee_id',
      'due_at',
      'position',
      'completed_at',
    ],
  },
};

const MONEY = new Set(['total', 'subtotal', 'shipping', 'tax_total', 'price', 'cost', 'value', 'amount']);

function tally(): AutomationRunTally {
  return { scanned: 0, matched: 0, done: 0, skipped: 0, failed: 0 };
}

/** Text compares without regard to case or padding; a missing value is the empty string. */
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * One condition against one record.
 *
 * `greater` and `less` are the only two that need a decision about type, so the answer
 * comes from the catalogue's own `kind` rather than from guessing at the shape of the
 * string: money compares as numbers, a moment compares as a date, and anything else that
 * is not a number is a condition that cannot be true — which it reports as false instead
 * of throwing, because a broken comparison should not fire a rule either.
 */
function passes(
  condition: AutomationCondition,
  record: Record<string, unknown>,
  kindOf: (field: string) => string,
): boolean {
  const raw = record[condition.field];
  const actual = text(raw);
  const wanted = text(condition.value);

  switch (condition.op) {
    case 'is_empty':
      return actual === '';
    case 'is_not_empty':
      return actual !== '';
    case 'equals':
      return actual.toLowerCase() === wanted.toLowerCase();
    case 'not_equals':
      return actual.toLowerCase() !== wanted.toLowerCase();
    case 'contains':
      return actual.toLowerCase().includes(wanted.toLowerCase());
    case 'greater':
    case 'less': {
      const kind = kindOf(condition.field);

      if (kind === 'time' || kind === 'date') {
        // A moment question, answered in the record's own timeline: `starts_at` after
        // the date somebody typed. Anything unparseable is not greater than anything.
        const when = Date.parse(actual);
        const until = Date.parse(wanted);
        if (Number.isNaN(when) || Number.isNaN(until)) return false;
        return condition.op === 'greater' ? when > until : when < until;
      }

      const amount = Number(actual);
      const compared = Number(wanted);
      if (!Number.isFinite(amount) || !Number.isFinite(compared)) return false;
      return condition.op === 'greater' ? amount > compared : amount < compared;
    }
    default:
      return false;
  }
}

/**
 * `{{field}}` in the workspace's own words, filled from the record.
 *
 * Money is formatted in the workspace's currency and a moment in its zone, so a letter
 * written by a print shop in Chennai reads in rupees and local time without the writer
 * saying so. An unknown token is left exactly as written: a rule that shows
 * `{{colour}}` in a letter is a rule somebody can go and fix, which beats a blank.
 */
function fill(
  template: string,
  record: Record<string, unknown>,
  extra: Record<string, string>,
  kindOf: (field: string) => string,
  org: { currency: string; locale: string; timezone: string },
): string {
  return template.replace(/\{\{\s*([a-z_][a-z_0-9]*)\s*\}\}/gi, (token, field: string) => {
    const known = extra[field];
    if (known !== undefined) return known;
    if (!(field in record)) return token;

    const value = record[field];
    if (value === null || value === undefined || text(value) === '') return '';
    const kind = kindOf(field);
    if (kind === 'money' || (MONEY.has(field) && Number.isFinite(Number(value)))) {
      return formatAmount(Number(value), org.currency, org.locale);
    }
    if (kind === 'time') return formatDateInZone(String(value), String(record['timezone'] ?? org.timezone));
    if (kind === 'date') return formatDateInZone(String(value), org.timezone);
    return text(value);
  });
}

/** The CRM row an activity belongs to, found the only two honest ways. */
async function crmTarget(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  rule: AutomationRule,
  record: Record<string, unknown>,
): Promise<{ column: 'lead_id' | 'contact_id' | 'deal_id'; id: string } | { error: string }> {
  if (rule.entity_type === 'crm_lead') {
    const contact = text(record['converted_contact_id']);
    if (contact) return { column: 'contact_id', id: contact };
    const deal = text(record['converted_deal_id']);
    if (deal) return { column: 'deal_id', id: deal };
    return { column: 'lead_id', id: text(record['id']) };
  }

  // An order, a booking or a response is somebody's name and address before it is a row
  // in CRM, so the match is on the email the record carries. `store_orders.contact_id`
  // is already decided by checkout for the same reason, and is used when it is set.
  const attached = text(record['contact_id']);
  if (attached) return { column: 'contact_id', id: attached };

  const column = emailColumn(rule.entity_type);
  const email = column ? text(record[column]) : '';
  if (!email) {
    return { error: 'there is no CRM record for this event, because the record has no email to match on' };
  }

  const { data, error } = await admin
    .from('crm_contacts')
    .select('id')
    .eq('org_id', orgId)
    .ilike('email', email)
    .limit(1);
  if (error) return { error: error.message };

  const id = (data ?? [])[0]?.id;
  if (!id) return { error: `no contact called ${email} is in CRM yet` };
  return { column: 'contact_id', id };
}

/**
 * The address a letter goes to.
 *
 * `record` is the email on the row the event named, `owner` is the person who owns the
 * workspace, `address` is one fixed address written into the rule. There is no fourth
 * option, and no "every member" — a rule that can mail a whole workspace is a rule that
 * can mail a whole workspace twice.
 */
async function recipient(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  action: Extract<AutomationAction, { type: 'letter' }>,
  record: Record<string, unknown>,
  entityEmail: string | null,
): Promise<{ to: string } | { error: string }> {
  if (action.to === 'address') {
    const address = (action.address ?? '').trim();
    return address ? { to: address } : { error: 'the letter has no address to send to' };
  }

  if (action.to === 'record') {
    const to = entityEmail ? text(record[entityEmail]) : '';
    return to ? { to } : { error: 'the record this event named has no email address on it' };
  }

  const org = (await admin.from('orgs').select('owner_id').eq('id', orgId).maybeSingle()).data;
  if (!org) return { error: 'this workspace no longer exists' };

  const profile = (
    await admin.from('user_profiles').select('email').eq('user_id', org.owner_id).maybeSingle()
  ).data;
  const email = text(profile?.email);
  return email ? { to: email } : { error: 'the workspace owner has no email address on file' };
}

async function carryOut(
  admin: ReturnType<typeof createAdminClient>,
  org: { id: string; name: string; currency: string; locale: string; timezone: string },
  rule: AutomationRule,
  record: Record<string, unknown>,
  event: { id: number; summary: string | null; action: string },
  kindOf: (field: string) => string,
): Promise<string[]> {
  const extras: Record<string, string> = {
    event: event.summary ?? rule.name,
    rule: rule.name,
    workspace: org.name,
    number: text(record['number']) || text(record['id']),
  };

  const failures: string[] = [];

  for (const action of rule.actions) {
    try {
      if (action.type === 'crm_activity') {
        const target = await crmTarget(admin, org.id, rule, record);
        if ('error' in target) {
          failures.push(target.error);
          continue;
        }

        const subject = fill(action.subject, record, extras, kindOf, org).slice(0, 200);
        const body = action.body ? fill(action.body, record, extras, kindOf, org).slice(0, 4000) : null;
        const dueAt =
          action.kind === 'task' && typeof action.due_days === 'number'
            ? new Date(Date.now() + action.due_days * 86400000).toISOString()
            : null;

        const { error } = await admin.from('crm_activities').insert({
          org_id: org.id,
          kind: action.kind,
          subject: subject || rule.name,
          body: body || (subject ? null : `Written by the rule “${rule.name}.”`),
          [target.column]: target.id,
          due_at: dueAt,
        });
        if (error) failures.push(error.message);
        continue;
      }

      const who = await recipient(admin, org.id, action, record, emailColumn(rule.entity_type));
      if ('error' in who) {
        failures.push(who.error);
        continue;
      }

      const subject = fill(action.subject, record, extras, kindOf, org).slice(0, 200);
      const body = fill(action.body, record, extras, kindOf, org).slice(0, 4000);
      const outcome = await sendMail({
        orgId: org.id,
        to: who.to,
        template: 'automation',
        relatedType: rule.entity_type,
        relatedId: text(record['id']) || undefined,
        mail: automationLetter(mailBase(org.name), {
          subject,
          body: body || `The rule “${rule.name}” fired.`,
          event: event.summary ?? `${rule.entity_type} ${event.action}`,
        }),
      });

      // `delivered` is false when the workspace has no transport at all, and the door
      // still returns success because a booking must not roll back over a mail host.
      // A rule has no transaction to protect, so the only useful answer here is a run
      // that says failed and why — otherwise the hub would report a rule that works.
      if (!outcome.delivered) {
        failures.push(outcome.error ?? 'nothing is set up to send mail for this workspace');
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'an action could not be carried out');
    }
  }

  return failures;
}

/**
 * Run every enabled rule of one workspace against everything it has not been shown yet.
 *
 * Returns the tally rather than throwing: a cron sweep over forty workspaces must keep
 * going when one of them has a rule with a bad address in it, and the screen that asked
 * for the run shows the count that came back.
 */
export async function runWorkspaceAutomations(orgId: string): Promise<AutomationRunTally> {
  const admin = createAdminClient();
  const out = tally();

  const [rulesResult, eventsResult, orgResult] = await Promise.all([
    admin
      .from('automation_rules')
      .select('*')
      .eq('org_id', orgId)
      .eq('enabled', true)
      .order('created_at', { ascending: true }),
    admin.from('automation_events').select('app, entity_type, action, fields').order('app'),
    admin.from('orgs').select('id, name, currency, locale, timezone').eq('id', orgId).maybeSingle(),
  ]);

  if (rulesResult.error) throw new Error(rulesResult.error.message);
  if (eventsResult.error) throw new Error(eventsResult.error.message);

  const org = orgResult.data;
  if (!org || orgResult.error) return out;

  const events = (eventsResult.data ?? []) as unknown as AutomationEvent[];
  const rules = (rulesResult.data ?? []) as unknown as AutomationRule[];
  if (rules.length === 0) return out;

  for (const rule of rules) {
    const spec = RECORDS[rule.entity_type];
    const event = events.find((e) => e.app === rule.app && e.entity_type === rule.entity_type && e.action === rule.action);
    if (!spec || !event) {
      // The foreign key makes this unreachable for a rule that saved; it stays because a
      // catalogue row cannot be edited by a browser, and the runner must not invent one.
      continue;
    }

    const kinds = new Map(event.fields.map((field) => [field.name, field.kind]));
    const kindOf = (field: string) => kinds.get(field) ?? 'text';

    // Where this rule got to. The unique key on the run is the guarantee; the cursor is
    // only what stops the runner reading the same thousand events on every tick.
    //
    // `watched_from` is the other half, and it is the reason a rule switched on tonight
    // does not spend the night writing letters about yesterday's orders: the database
    // moves that line whenever a rule is switched on or re-pointed at another event.
    const seen = await admin
      .from('automation_runs')
      .select('log_id')
      .eq('rule_id', rule.id)
      .order('log_id', { ascending: false })
      .limit(1);
    if (seen.error) throw new Error(seen.error.message);
    const cursor = Number((seen.data ?? [])[0]?.log_id ?? 0);

    const logs = await admin
      .from('activity_log')
      .select('id, entity_id, action, summary, created_at')
      .eq('org_id', orgId)
      .eq('app_key', rule.app)
      .eq('entity_type', rule.entity_type)
      .eq('action', rule.action)
      .gte('created_at', rule.watched_from)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (logs.error) throw new Error(logs.error.message);

    for (const entry of (logs.data ?? []) as unknown as {
      id: number;
      entity_id: string | null;
      action: string;
      summary: string | null;
    }[]) {
      out.scanned += 1;

      // The table name only becomes known at run time, so the builder cannot type this
      // read; it is laundered here once rather than argued with at every field.
      const found = entry.entity_id
        ? ((await admin
            .from(spec.table)
            .select(spec.columns.join(','))
            .eq('org_id', orgId)
            .eq('id', entry.entity_id)
            .maybeSingle()) as unknown as { data: Record<string, unknown> | null; error: { message: string } | null })
        : { data: null, error: null };

      if (found.error) {
        await write(admin, rule, entry.id, 'failed', found.error.message.slice(0, 500));
        out.failed += 1;
        continue;
      }

      if (!found.data) {
        await write(admin, rule, entry.id, 'failed', 'the record this event named is no longer here');
        out.failed += 1;
        continue;
      }

      const row = found.data;
      const matched = rule.conditions.every((condition) => passes(condition, row, kindOf));

      if (!matched) {
        // Recorded rather than dropped, so the event is never asked about twice and the
        // hub can say "24 events looked at, 20 of them not what you asked for".
        await write(admin, rule, entry.id, 'skipped', null);
        out.skipped += 1;
        continue;
      }

      out.matched += 1;
      const failures = await carryOut(admin, org, rule, row, entry, kindOf);

      if (failures.length === 0) {
        await write(admin, rule, entry.id, 'done', `${rule.actions.length} action(s) carried out`);
        out.done += 1;
      } else {
        await write(admin, rule, entry.id, 'failed', failures.join('; ').slice(0, 500));
        out.failed += 1;
      }
    }
  }

  return out;
}

/**
 * Record the decision, or keep quiet if another runner wrote it first.
 *
 * A lost unique-key insert is not a fault: it means the same event was reached twice,
 * which is precisely what the key exists to make harmless.
 */
async function write(
  admin: ReturnType<typeof createAdminClient>,
  rule: AutomationRule,
  logId: number,
  outcome: 'done' | 'skipped' | 'failed',
  detail: string | null,
): Promise<void> {
  const { error } = await admin.from('automation_runs').insert({
    org_id: rule.org_id,
    rule_id: rule.id,
    log_id: logId,
    outcome,
    detail,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}

/** Every workspace that switched Automations on. The cron door's list. */
export async function runAllAutomations(): Promise<{ workspaces: number; tally: AutomationRunTally }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('org_apps')
    .select('org_id')
    .eq('app_key', 'automations')
    .eq('status', 'enabled');
  if (error) throw new Error(error.message);

  const total = tally();
  let workspaces = 0;

  for (const row of (data ?? []) as unknown as { org_id: string }[]) {
    try {
      const one = await runWorkspaceAutomations(row.org_id);
      total.scanned += one.scanned;
      total.matched += one.matched;
      total.done += one.done;
      total.skipped += one.skipped;
      total.failed += one.failed;
      workspaces += 1;
    } catch (cause) {
      // One workspace's broken rule must not stop the other thirty-nine.
      console.error('[yourbiss] automation pass failed for one workspace', {
        orgId: row.org_id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return { workspaces, tally: total };
}

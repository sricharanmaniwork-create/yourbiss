import type { AutomationAction, AutomationCondition, AutomationEvent, AutomationRule } from '@/lib/types';

/**
 * The one copy of how a rule is described in words.
 *
 * The hub, the list, the rule&rsquo;s own screen and the run log all show the same rule, and
 * each of them used the field labels out of `public.automation_events` to do it — so a
 * rule reads the same in four places, and an event renamed in the catalogue changes here
 * rather than in four screens that can fall out of step.
 *
 * Nothing here decides what a rule means; the runner in `engine.ts` does. This only says
 * in English what the runner will do with the same JSON.
 */

export function eventOf(events: AutomationEvent[], rule: Pick<AutomationRule, 'app' | 'entity_type' | 'action'>): AutomationEvent | undefined {
  return events.find((e) => e.app === rule.app && e.entity_type === rule.entity_type && e.action === rule.action);
}

export function eventLabel(events: AutomationEvent[], rule: Pick<AutomationRule, 'app' | 'entity_type' | 'action'>): string {
  return eventOf(events, rule)?.label ?? `${rule.entity_type} ${rule.action}`;
}

const OP_WORDS: Record<AutomationCondition['op'], string> = {
  equals: 'is exactly',
  not_equals: 'is not',
  contains: 'contains',
  greater: 'is more than',
  less: 'is less than',
  is_empty: 'has nothing in it',
  is_not_empty: 'has something in it',
};

export function describeCondition(condition: AutomationCondition, event?: AutomationEvent): string {
  const field = event?.fields.find((f) => f.name === condition.field);
  const name = field?.label ?? condition.field;
  const moment = field?.kind === 'time' || field?.kind === 'date';
  const op =
    condition.op === 'greater' ? (moment ? 'is after' : OP_WORDS.greater) : condition.op === 'less' ? (moment ? 'is before' : OP_WORDS.less) : OP_WORDS[condition.op];

  const noValue = condition.op === 'is_empty' || condition.op === 'is_not_empty';
  return `${name} ${op}${noValue || condition.value === undefined ? '' : ` ${condition.value}`}`;
}

export function describeAction(action: AutomationAction): string {
  if (action.type === 'letter') {
    const to = action.to === 'record' ? 'the email on the record' : action.to === 'owner' ? 'the workspace owner' : action.address;
    return `Send a letter to ${to}`;
  }
  const what = action.kind === 'note' ? 'a note' : action.kind === 'call' ? 'a call to make' : 'a task';
  const due = action.kind === 'task' && typeof action.due_days === 'number' ? `, due in ${action.due_days} day${action.due_days === 1 ? '' : 's'}` : '';
  return `Write ${what} in CRM${due}`;
}

/** The whole rule as the sentence a person would say to a colleague. */
export function describeRule(rule: AutomationRule, events: AutomationEvent[]): string {
  const event = eventOf(events, rule);
  const only = rule.conditions.length > 0 ? ` only if ${rule.conditions.map((c) => describeCondition(c, event)).join(', and ')}` : '';
  const doings = rule.actions.map(describeAction).join(', then ');
  return `When ${event?.label.toLowerCase() ?? `${rule.entity_type} ${rule.action}`}${only}, ${doings.toLowerCase()}.`;
}

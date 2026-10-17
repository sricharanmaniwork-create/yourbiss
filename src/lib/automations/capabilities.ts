/**
 * What the record behind an event can actually carry.
 *
 * Two of the four things a rule can ask for depend on the row, not on the event's name:
 * a letter addressed to "the email on the record" needs a record that has one, and a CRM
 * activity needs a CRM row the runner can reach — either because the record *is* one, or
 * because it carries an email to match on. A board card and a purchase order have neither,
 * so a rule that promises them either is a rule that saves and then fails on every event
 * forever, with a reason nobody sees until they go looking in the run log.
 *
 * `EMAIL_COLUMN` is the single answer to "where does this record keep its address", and
 * both doors read it: the runner, so it looks in the right column, and the builder plus
 * the save-time check, so an option that cannot run is never offered and never accepted.
 */

/** The column each record's email address lives in — `null` when the record has none. */
const EMAIL_COLUMN: Record<string, string | null> = {
  form_submission: 'submitter_email',
  booking: 'customer_email',
  crm_lead: 'email',
  store_order: 'buyer_email',
  inv_purchase: null,
  site: null,
  board_project: null,
  board_task: null,
};

export function emailColumn(entityType: string): string | null {
  return EMAIL_COLUMN[entityType] ?? null;
}

/** May a letter go to the person on the record rather than to the owner or a fixed address? */
export function sendsToRecord(entityType: string): boolean {
  return emailColumn(entityType) !== null;
}

/** Can the runner find a CRM row for this event — as a lead itself, or by matching its email? */
export function writesToCrm(entityType: string): boolean {
  return entityType === 'crm_lead' || emailColumn(entityType) !== null;
}

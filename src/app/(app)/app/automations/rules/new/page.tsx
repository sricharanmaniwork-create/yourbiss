import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { automationEvents } from '@/lib/repo';
import { RuleForm } from '@/components/automations/rule-form';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New rule' };

/**
 * A new rule, offered only for events the suite really writes.
 *
 * There is no "custom event", no webhook and no schedule of its own: a rule watches
 * something Forms, Bookings, CRM, Inventory, Store or Websites already records in its
 * timeline. That limit is what makes the list above the form trustworthy — it is read
 * from `public.automation_events`, the same table the saved rule is checked against.
 */
export default async function NewAutomationRulePage() {
  const workspace = await requireWorkspace();
  const events = await automationEvents();

  return (
    <>
      <PageHeader
        title="New rule"
        description="Three questions, in the order the runner asks them: what happened, what the record looks like, what to do about it."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <RuleForm orgId={workspace.org.id} events={events} />

        <div className="grid content-start gap-3">
          <Card>
            <CardHeader title="What a rule can and cannot do" />
            <CardBody>
              <ul className="grid gap-2.5 text-[12.5px] leading-relaxed text-ink-soft">
                <li>
                  It fires on an event another app already recorded. Nothing here creates an event, and a rule written
                  for one that never happens is refused before it saves.
                </li>
                <li>It answers with a letter, or with a note, call or task in CRM. Those are the two it can do.</li>
                <li>
                  It runs once per event. The run log is keyed on the rule and the event together, so a double-clicked
                  &ldquo;Run now&rdquo; and a retried schedule cannot send the same customer the same letter twice.
                </li>
                <li>
                  It starts switched off, and it becomes responsible from the moment it is switched on. Events that
                  happened before that are not replayed — not by the scheduler, not by &ldquo;Run now&rdquo;, and not by
                  editing the rule.
                </li>
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Letters go out the door the workspace set up" />
            <CardBody>
              <p className="text-[12.5px] leading-relaxed text-ink-soft">
                A letter from an automation uses the same sender as every other message in this workspace — its own SMTP
                settings if it has them, otherwise the provider row it was given. If nothing is configured, the run is
                recorded as failed with that reason, rather than the rule looking like it worked.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

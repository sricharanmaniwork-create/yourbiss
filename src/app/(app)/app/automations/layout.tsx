import Link from 'next/link';
import { requireWorkspace } from '@/lib/workspace';
import { AutomationsTabs } from '@/components/automations/automations-tabs';
import { ButtonLink } from '@/components/ui';

/**
 * Members see the rules; nothing here decides who may change them.
 *
 * That is the RLS policies in 0013 — a member writes a rule, only an owner or admin
 * deletes one, and the run log is read-only for everybody, including the browser. This
 * layout only answers the two questions a page cannot answer from its own query: is this
 * person in the workspace, and is Automations switched on for it.
 */
export default async function AutomationsLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();

  if (workspace.apps.automations !== true) {
    return (
      <>
        <div className="ui-card max-w-[720px] px-5 py-5">
          <h2 className="text-[15px] font-semibold text-ink">Automations is switched off for this workspace</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            Nothing has been deleted and no rule has been touched — a rule that is switched off simply is not read, so
            the events keep landing in the timeline the other apps write them to. Switch Automations back on and the
            next pass picks up from where the last one stopped, including everything that happened in between.
          </p>
          <ButtonLink href="/app/settings/apps" variant="primary" className="mt-4">
            Open the app list
          </ButtonLink>
          <p className="mt-3 text-[12px] text-muted">
            Or go back to the{' '}
            <Link href="/app" className="text-brand hover:text-brand-dark">
              dashboard
            </Link>
            .
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <AutomationsTabs />
      {children}
    </>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { runAutomationsNow } from '@/lib/actions/automations';
import { Button, FormStatus, toast, useAction } from '@/components/ui';

/**
 * The same pass the scheduler makes, on demand.
 *
 * It is worth having a button for it because a rule cannot be tested any other way: the
 * events come from the timeline the other apps already write, so the only way to see what
 * a rule would have done is to run the real runner over what really happened. The counts
 * in the toast are the runner's own tally, which is the difference between "Run now"
 * meaning something and a screen claiming a rule works.
 */
export function RunNow({ orgId }: { orgId: string }) {
  const router = useRouter();
  const { state, pending, run } = useAction();

  const start = () => {
    void run(async () => {
      const result = await runAutomationsNow(orgId);
      if (result.ok) {
        router.refresh();
        toast.success(
          result.scanned === 0
            ? 'Nothing has happened since the last pass, so there was nothing to look at.'
            : `Looked at ${result.scanned} event(s) — ${result.done} carried out, ${result.skipped} not what you asked for, ${result.failed} that could not be`,
        );
      }
      return result;
    });
  };

  return (
    <div className="grid gap-2">
      <Button variant="secondary" loading={pending} onClick={start}>
        <Play size={14} aria-hidden="true" />
        Run now
      </Button>
      <FormStatus state={state?.ok ? null : state} />
    </div>
  );
}

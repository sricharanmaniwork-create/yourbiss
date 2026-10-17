'use client';

import { useRouter } from 'next/navigation';
import { seedCrmPipeline } from '@/lib/actions/crm';
import { Button, FormStatus, useAction } from '@/components/ui';

/**
 * The first visit to an empty funnel.
 *
 * Six names that any sales day already uses — qualify, set a meeting, send a
 * proposal, negotiate, won, lost — written into the workspace's own rows, which the
 * pipeline screen then renames. Nothing is seeded silently: a person presses the
 * button, because the stage list is the shape of their business and not ours.
 */
export function SeedPipelineButton({ orgId, label = 'Create the default pipeline' }: { orgId: string; label?: string }) {
  const router = useRouter();
  const { state, pending, run } = useAction();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="primary"
        loading={pending}
        onClick={() =>
          void run(async () => {
            const result = await seedCrmPipeline(orgId);
            if (result.ok) router.refresh();
            return result;
          })
        }
      >
        {label}
      </Button>
      <FormStatus state={state} />
    </div>
  );
}

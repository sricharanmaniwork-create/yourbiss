'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { leaveWorkspace } from '@/lib/actions/settings';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toaster';

export function LeaveWorkspaceButton({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const leave = async () => {
    setBusy(true);
    const result = await leaveWorkspace(orgId);
    setBusy(false);
    setOpen(false);
    if (result.ok) {
      toast.success(`You have left ${orgName}`);
      router.replace('/app');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Could not leave the workspace');
    }
  };

  return (
    <>
      <Button variant="outlineDanger" onClick={() => setOpen(true)}>
        Leave {orgName}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Leave ${orgName}?`}
        description="You will lose access to its pages, forms and bookings immediately."
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Stay
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void leave()}>
              Leave workspace
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          An owner or admin has to invite you back. Anything you drafted stays in {orgName}.
        </p>
      </Modal>
    </>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { toast } from '@/components/ui/toaster';
import { createWorkspace } from '@/lib/actions/workspace';

export function NewWorkspaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const router = useRouter();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await createWorkspace({ name });
      toast.success('Workspace created');
      onClose();
      setName('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the workspace');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New workspace"
      description="A separate business, brand or client gets its own site, forms and bookings."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={name.trim().length < 2}>
            Create workspace
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Business name" htmlFor="ws-name" error={error} required>
          <Input
            id="ws-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder="Northside Dental"
            autoFocus
          />
        </Field>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          You will be the owner. Invite the rest of the team from Settings once it exists.
        </p>
      </form>
    </Modal>
  );
}

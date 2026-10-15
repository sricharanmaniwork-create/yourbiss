'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Trash } from 'lucide-react';
import { changeMemberRole, inviteMember, removeMember, revokeInvite } from '@/lib/actions/settings';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { FormStatus } from '@/components/ui/form-status';
import { useAction } from '@/components/ui/use-action';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toaster';
import type { OrgRole } from '@/lib/types';

export function InviteForm({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const { state, pending, run, fieldError } = useAction();
  const router = useRouter();

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => inviteMember(orgId, { email, role }),
          () => {
            setEmail('');
            toast.success('Invite created and emailed');
            router.refresh();
          },
        );
      }}
    >
      <Field label="Email address" htmlFor="invite-email" error={fieldError('email')} className="min-w-[240px] flex-1">
        <Input
          id="invite-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          maxLength={200}
          required
        />
      </Field>

      <Field label="Role" htmlFor="invite-role" className="w-[150px]">
        <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
          <option value="member">Member</option>
          {isOwner && <option value="admin">Admin</option>}
        </Select>
      </Field>

      <Button type="submit" variant="primary" loading={pending} disabled={email.trim().length < 4}>
        Send invite
      </Button>

      <div className="w-full">
        <FormStatus state={state} />
      </div>

      {!isOwner && (
        <p className="w-full text-[12px] text-muted">
          Only the owner can grant admin. Members can still build pages, forms and bookings.
        </p>
      )}
    </form>
  );
}

export function MemberRowActions({
  orgId,
  userId,
  role,
  isSelf,
  canManage,
}: {
  orgId: string;
  userId: string;
  role: OrgRole;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (role === 'owner') {
    return <span className="text-[12.5px] text-muted">Owner — cannot be changed</span>;
  }

  const applyRole = async (next: 'admin' | 'member') => {
    setBusy(true);
    const result = await changeMemberRole(orgId, userId, next);
    setBusy(false);
    if (result.ok) {
      toast.success(`Role set to ${next}`);
      router.refresh();
    } else {
      toast.error(result.error ?? 'Could not change the role');
    }
  };

  const remove = async () => {
    setBusy(true);
    const result = await removeMember(orgId, userId);
    setBusy(false);
    setConfirming(false);
    if (result.ok) {
      toast.success('Member removed');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Could not remove the member');
    }
  };

  if (isSelf || !canManage) {
    return (
      <span className="text-[12.5px] text-muted">{isSelf ? 'That is you' : 'Owner or admin only'}</span>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Select
        aria-label={`Role for this member`}
        value={role}
        disabled={busy}
        onChange={(e) => void applyRole(e.target.value as 'admin' | 'member')}
        className="h-8 w-[110px] text-[12.5px]"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </Select>
      <Button size="iconSm" variant="outlineDanger" onClick={() => setConfirming(true)} aria-label="Remove member">
        <Trash size={13} />
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remove this member?"
        description="They lose access to every page, form and booking in this workspace at once."
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={busy}>
              Keep them
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={busy}>
              Remove member
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Their records stay in the activity log, so you can see what they published. Anything they drafted stays too —
          hand it to someone else afterwards.
        </p>
      </Modal>
    </div>
  );
}

export function InviteRowActions({ orgId, inviteId, token }: { orgId: string; inviteId: string; token: string }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Your browser blocked the clipboard — select the link and copy it manually');
    }
  };

  const revoke = async () => {
    setBusy(true);
    const result = await revokeInvite(orgId, inviteId);
    setBusy(false);
    if (result.ok) {
      toast.success('Invite revoked');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Could not revoke the invite');
    }
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button size="sm" variant="ghost" onClick={copy} disabled={busy}>
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
      <Button size="sm" variant="outlineDanger" onClick={() => void revoke()} disabled={busy}>
        Revoke
      </Button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { YourbissMark } from '@/components/brand/mark';
import { NewWorkspaceModal } from '@/components/shell/new-workspace-modal';
import { Button } from '@/components/ui/button';

/**
 * Reached when an account exists but belongs to no workspace: the onboarding
 * trigger did not fire (a user created before migration 0002, or an account
 * added only as an invite recipient). Offering a workspace here is the fix; a
 * blank dashboard would look like a crash.
 */
export function NoWorkspaceScreen({ name }: { name: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-10">
      <YourbissMark className="mb-8" />
      <div className="ui-card w-full max-w-[440px] px-7 py-8 text-center">
        <h1 className="text-[18px] font-semibold text-ink">
          {name ? `Welcome, ${name.split(' ')[0]}` : 'Welcome to Yourbiss'}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Your account is not attached to a workspace yet. A workspace holds your website, forms, bookings and team —
          create one to continue.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
            Create my workspace
          </Button>
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="ghost" size="md">
              Sign in as someone else
            </Button>
          </form>
        </div>
        <p className="mt-6 border-t border-line pt-4 text-[12px] text-muted">
          Waiting on an invitation?{' '}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Open the invite link
          </Link>
        </p>
      </div>
      <NewWorkspaceModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

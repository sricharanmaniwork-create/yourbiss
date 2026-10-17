import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { YourbissMark } from '@/components/brand/mark';
import { Button, ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Invitation' };

type AcceptResult = { org_id: string; org_slug: string; member_role: string };

/**
 * Accepting an invite is the one place a member row is created, and it happens
 * inside `youbiss.accept_invite()` — a SECURITY DEFINER function that re-checks
 * the token, the expiry and the caller's own email address. Nothing here trusts
 * the link beyond handing the token over.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inviteId = /^[0-9a-fA-F-]{36}$/.test(token) ? token : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Remember where they were heading, then send them through the normal
    // sign-in. The invite token is not a session and must not become one.
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  if (!inviteId) {
    return <Outcome ok={false} title="That link is not valid" body="It is missing part of its address. Ask your inviter to send a fresh one." />;
  }

  const { data, error } = await supabase.rpc('accept_invite', { p_token: inviteId });
  if (error) {
    return (
      <Outcome
        ok={false}
        title="We could not open that invitation"
        body={
          /expired/i.test(error.message)
            ? 'The invitation passed its seven-day limit. Ask for a new one.'
            : /email|address/i.test(error.message)
              ? `You are signed in as ${user.email ?? 'an unknown address'}, which is not who the invitation was sent to. Sign in with that address, or ask for a new invite.`
              : error.message
        }
      />
    );
  }

  const accepted = (Array.isArray(data) ? data[0] : data) as AcceptResult | undefined;
  if (!accepted) {
    return <Outcome ok={false} title="That invitation is no longer open" body="It has already been accepted or was withdrawn." />;
  }

  // The slug, not `1`: the dashboard names the workspace they joined, and a person who has
  // three of them needs to know which one to look for in the switcher.
  redirect(`/app?invited=${encodeURIComponent(accepted.org_slug)}`);
}

function Outcome({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-5 py-10">
      <YourbissMark className="mb-8" />
      <div className="ui-card w-full max-w-[440px] px-7 py-8 text-center">
        <div
          className={`mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full ${
            ok ? 'bg-[#e6f4ea] text-success' : 'bg-[#fcebea] text-danger'
          }`}
        >
          {ok ? <CircleCheck size={20} /> : <CircleAlert size={20} />}
        </div>
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink href="/app" variant="primary">
            Go to my workspaces
          </ButtonLink>
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="secondary">
              Switch account
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

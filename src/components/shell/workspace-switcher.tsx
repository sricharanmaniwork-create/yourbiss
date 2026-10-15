'use client';

import { useTransition, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { switchWorkspace } from '@/lib/actions/workspace';
import { NewWorkspaceModal } from '@/components/shell/new-workspace-modal';
import { toast } from '@/components/ui/toaster';
import { cn, initials } from '@/lib/utils';
import type { WorkspaceSummary } from '@/lib/workspace';

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: WorkspaceSummary[];
  current: { id: string; name: string; slug: string; logo_url: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const pick = (orgId: string) => {
    setOpen(false);
    startTransition(async () => {
      try {
        await switchWorkspace(orgId);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not switch workspace');
      }
    });
  };

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            'flex h-9 max-w-[280px] items-center gap-2 rounded-md border border-transparent px-2 text-left hover:bg-black/[0.05]',
            open && 'bg-black/[0.05]',
          )}
        >
          <WorkspaceBadge workspace={workspaces.find((w) => w.id === current.id) ?? null} name={current.name} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{current.name}</span>
            <span className="block truncate text-[11px] leading-tight text-muted">/{current.slug}</span>
          </span>
          <ChevronsUpDown size={13} className="flex-none text-muted" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="menu"
              className="absolute left-0 top-[42px] z-20 w-[290px] rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#98a1ad]">
                Your workspaces
              </p>
              <ul className="max-h-[260px] overflow-y-auto">
                {workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => pick(workspace.id)}
                      disabled={pending}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-brand-soft disabled:opacity-60"
                    >
                      <WorkspaceBadge workspace={workspace} name={workspace.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{workspace.name}</span>
                        <span className="block truncate text-[11.5px] text-muted">/{workspace.slug}</span>
                      </span>
                      {workspace.id === current.id && <Check size={14} className="flex-none text-brand" />}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setCreating(true);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink-soft hover:bg-brand-soft hover:text-brand-dark"
                >
                  <Plus size={14} />
                  New workspace
                </button>
                <Link
                  href="/app/settings/members"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink-soft hover:bg-brand-soft hover:text-brand-dark"
                >
                  <Building size={14} />
                  Members &amp; roles
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      <NewWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function WorkspaceBadge({ workspace, name }: { workspace: WorkspaceSummary | null; name: string }) {
  if (workspace?.logo_url) {
    return (
      <img
        src={workspace.logo_url}
        alt=""
        className="h-7 w-7 flex-none rounded-[6px] border border-line object-cover"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[6px] bg-[#0f2b57] text-[11px] font-semibold text-white">
      {initials(name) || 'WB'}
    </span>
  );
}

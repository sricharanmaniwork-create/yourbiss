import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { NoWorkspaceScreen } from '@/components/shell/no-workspace-screen';
import { getWorkspace, getSession } from '@/lib/workspace';

/**
 * The only place the workspace area decides who gets in. Pages call
 * `requireWorkspace()` for their own data, but the shell needs the identity
 * before it can draw a single pixel of chrome.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const workspace = await getWorkspace();
  if (!workspace) return <NoWorkspaceScreen name={session.profile?.display_name ?? session.user.email} />;

  return (
    <AppShell
      workspaces={session.workspaces}
      org={{ id: workspace.org.id, name: workspace.org.name, slug: workspace.org.slug, logo_url: workspace.org.logo_url }}
      role={workspace.role}
      apps={workspace.apps}
      user={{ name: session.profile?.display_name ?? session.user.email, email: session.user.email }}
    >
      {children}
    </AppShell>
  );
}

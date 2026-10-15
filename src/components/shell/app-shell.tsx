'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Settings, User } from 'lucide-react';
import { MODULES, moduleByPathname, type ModuleDef } from '@/lib/modules';
import { YourbissMark } from '@/components/brand/mark';
import { cn, initials } from '@/lib/utils';
import { WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import type { WorkspaceSummary } from '@/lib/workspace';
import type { AppKey, OrgRole } from '@/lib/types';

export interface ShellProps {
  workspaces: WorkspaceSummary[];
  org: { id: string; name: string; slug: string; logo_url: string | null };
  role: OrgRole;
  apps: Record<AppKey, boolean>;
  user: { name: string; email: string };
}

const RAIL_COLLAPSE_KEY = 'youbiss.rail-collapsed';
const RAIL_EVENT = 'youbiss:rail-collapsed';

/**
 * The rail width is stored in localStorage, which the server cannot read. Going
 * through useSyncExternalStore keeps the first client render identical to the
 * server's (the empty snapshot) and swaps in the saved value right after
 * hydration — no mismatch warning, and no setState-in-effect cascade.
 */
function readRail(): boolean {
  return window.localStorage.getItem(RAIL_COLLAPSE_KEY) === '1';
}

function writeRail(next: boolean): void {
  window.localStorage.setItem(RAIL_COLLAPSE_KEY, next ? '1' : '0');
  window.dispatchEvent(new Event(RAIL_EVENT));
}

const RAIL_SERVER_SNAPSHOT = () => false;

function subscribeRail(onChange: () => void): () => void {
  window.addEventListener(RAIL_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(RAIL_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function AppShell({ workspaces, org, role, apps, user, children }: ShellProps & { children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeRail, readRail, RAIL_SERVER_SNAPSHOT);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const activeKey = moduleByPathname(pathname)?.key ?? 'dashboard';

  return (
    <div className="min-h-screen bg-canvas">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col border-r border-line bg-surface transition-[width] duration-150',
          collapsed ? 'w-[60px]' : 'w-[224px]',
        )}
        aria-label="Workspace navigation"
      >
        <div className={cn('flex h-[52px] items-center border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')}>
          {collapsed ? (
            <Link href="/app" aria-label="Yourbiss dashboard" className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-brand text-white">
              <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
                <path d="M9 11.5h14M9 16h14M9 20.5h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
              </svg>
            </Link>
          ) : (
            <Link href="/app" className="rounded-md">
              <YourbissMark />
            </Link>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {collapsed ? (
            <ul className="space-y-0.5 px-2">
              {MODULES.map((module) => (
                <li key={module.key}>
                  <RailIcon
                    module={module}
                    active={activeKey === module.key}
                    label={`${module.label}${module.state === 'planned' ? ' (not yet available)' : ''}`}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <>
              <RailGroup title="Workspace">
                {MODULES.filter((m) => ['dashboard', 'website', 'forms', 'bookings'].includes(m.key)).map((module) => (
                  <li key={module.key}>
                    <RailLink module={module} active={activeKey === module.key} apps={apps} />
                  </li>
                ))}
              </RailGroup>
              <RailGroup title="More apps">
                {MODULES.filter((m) => ['store', 'crm', 'inventory', 'automations', 'board'].includes(m.key)).map((module) => (
                  <li key={module.key}>
                    <RailLink module={module} active={activeKey === module.key} apps={apps} />
                  </li>
                ))}
              </RailGroup>
              <RailGroup title="Account">
                <li>
                  <RailLink module={MODULES.find((m) => m.key === 'settings')!} active={activeKey === 'settings'} apps={apps} />
                </li>
              </RailGroup>
            </>
          )}
        </nav>

        <div className={cn('border-t border-line p-2', collapsed && 'flex justify-center')}>
          <button
            type="button"
            onClick={() => writeRail(!collapsed)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-muted hover:bg-black/[0.05] hover:text-ink',
              collapsed ? 'justify-center' : 'w-full',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className={cn('transition-[padding] duration-150', collapsed ? 'pl-[60px]' : 'pl-[224px]')}>
        <header className="sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-line bg-surface px-4">
          <WorkspaceSwitcher workspaces={workspaces} current={org} />

          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-black/[0.05]',
                  menuOpen && 'bg-black/[0.05]',
                )}
              >
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#0f2b57] text-[10.5px] font-semibold text-white">
                  {initials(user.name || user.email) || 'YB'}
                </span>
                <ChevronDown size={13} className="text-muted" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[38px] w-[248px] rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
                >
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="truncate text-[13px] font-medium text-ink">{user.name || user.email}</p>
                    <p className="truncate text-[12px] text-muted">{user.email}</p>
                    <p className="mt-1 text-[11.5px] capitalize text-muted">
                      {role} of {org.name}
                    </p>
                  </div>
                  <MenuLink href="/app/settings/profile" icon={<User size={14} />} label="Your profile" onSelect={close(setMenuOpen)} />
                  <MenuLink href="/app/settings" icon={<Settings size={14} />} label="Workspace settings" onSelect={close(setMenuOpen)} />
                  <form action="/auth/sign-out" method="post" className="mt-1 border-t border-line pt-1">
                    <button
                      type="submit"
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-[#fcebea] hover:text-[#a50f0f]"
                    >
                      <LogOut size={14} />
                      Sign out
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}

function close(setter: (value: boolean) => void) {
  return () => setter(false);
}

function MenuLink({ href, icon, label, onSelect }: { href: string; icon: React.ReactNode; label: string; onSelect: () => void }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-ink-soft hover:bg-brand-soft hover:text-brand-dark"
    >
      {icon}
      {label}
    </Link>
  );
}

function RailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <p className="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#98a1ad]">{title}</p>
      <ul className="space-y-[2px] px-2">{children}</ul>
    </div>
  );
}

function RailLink({
  module,
  active,
  apps,
}: {
  module: ModuleDef;
  active: boolean;
  apps: Record<AppKey, boolean>;
}) {
  const Icon = module.icon;
  const planned = module.appKey !== null && module.state === 'planned';
  const off = module.appKey !== null && !apps[module.appKey];

  return (
    <Link
      href={module.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors',
        active ? 'bg-brand-soft text-brand-dark' : 'text-ink-soft hover:bg-black/[0.04] hover:text-ink',
      )}
    >
      <Icon size={15} className={cn('flex-none', active ? 'text-brand' : 'text-[#8b95a3] group-hover:text-ink-soft')} />
      <span className="truncate">{module.label}</span>
      {planned && <span className="ml-auto rounded bg-[#eef0f3] px-1.5 py-[1px] text-[10px] text-[#7a848f]">soon</span>}
      {!planned && off && <span className="ml-auto rounded bg-[#eef0f3] px-1.5 py-[1px] text-[10px] text-[#7a848f]">off</span>}
    </Link>
  );
}

function RailIcon({ module, active, label }: { module: ModuleDef; active: boolean; label: string }) {
  const Icon = module.icon;
  return (
    <Link
      href={module.href}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center justify-center rounded-md transition-colors',
        active ? 'bg-brand-soft text-brand-dark' : 'text-[#8b95a3] hover:bg-black/[0.05] hover:text-ink',
      )}
    >
      <Icon size={16} />
    </Link>
  );
}

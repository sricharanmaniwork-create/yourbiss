import {
  CalendarDays,
  ChartColumn,
  Globe,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  FileText,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { AppKey } from '@/lib/types';

export interface ModuleDef {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  tagline: string;
  /**
   * `live` modules have screens in this build. `planned` ones still appear in
   * the rail, but their route renders an honest "not in this build yet" screen
   * instead of a table of demo rows — a mock that looks real is worse than an
   * empty state.
   */
  state: 'live' | 'planned';
  /** Null for Dashboard and Settings, which every workspace has. */
  appKey: AppKey | null;
}

export const MODULES: ModuleDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/app',
    icon: LayoutDashboard,
    tagline: 'Everything happening across your workspace today.',
    state: 'live',
    appKey: null,
  },
  {
    key: 'website',
    label: 'Websites',
    href: '/app/websites',
    icon: Globe,
    tagline: 'Drag blocks onto a canvas and publish a real site.',
    state: 'live',
    appKey: 'website',
  },
  {
    key: 'forms',
    label: 'Forms',
    href: '/app/forms',
    icon: FileText,
    tagline: 'Build forms with conditional logic and read responses.',
    state: 'planned',
    appKey: 'forms',
  },
  {
    key: 'bookings',
    label: 'Bookings',
    href: '/app/bookings',
    icon: CalendarDays,
    tagline: 'Services, staff calendars and a page customers book from.',
    state: 'planned',
    appKey: 'bookings',
  },
  {
    key: 'store',
    label: 'Store',
    href: '/app/store',
    icon: ShoppingCart,
    tagline: 'Product pages and carts built from the same canvas.',
    state: 'planned',
    appKey: 'store',
  },
  {
    key: 'crm',
    label: 'CRM',
    href: '/app/crm',
    icon: Users,
    tagline: 'Leads from your forms and bookings, followed through to a sale.',
    state: 'planned',
    appKey: 'crm',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    href: '/app/inventory',
    icon: Package,
    tagline: 'Stock, pricing, offers and suppliers in one list.',
    state: 'planned',
    appKey: 'inventory',
  },
  {
    key: 'automations',
    label: 'Automations',
    href: '/app/automations',
    icon: Workflow,
    tagline: 'When something happens here, do something over there.',
    state: 'planned',
    appKey: 'automations',
  },
  {
    key: 'board',
    label: 'Projects',
    href: '/app/board',
    icon: ChartColumn,
    tagline: 'Boards and tasks that share records with the other apps.',
    state: 'planned',
    appKey: 'board',
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/app/settings',
    icon: Settings,
    tagline: 'Workspace, members, apps, email and domain settings.',
    state: 'live',
    appKey: null,
  },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/**
 * The URL segment each module owns. Key and segment are not the same thing —
 * `website` is served at `/app/websites` — so anything that asks "which module
 * is this path" has to read the href, or it silently answers "dashboard".
 */
const BY_SEGMENT = new Map<string, ModuleDef>(
  MODULES.map((m): [string, ModuleDef] => [m.href.split('/')[2] ?? '', m]).filter(([segment]) => segment !== ''),
);

export function moduleByKey(key: string): ModuleDef | undefined {
  return BY_KEY.get(key);
}

export function moduleByPathname(pathname: string): ModuleDef | undefined {
  // Only the first segment decides: /app/bookings/services is still Bookings.
  const segment = pathname.split('/').filter(Boolean)[1] ?? '';
  if (!segment) return moduleByKey('dashboard');
  return BY_SEGMENT.get(segment);
}

/** Entries shown in the left rail, with planned apps kept visible but marked. */
export function navModules(): ModuleDef[] {
  return MODULES;
}

/**
 * Screens that exist in this build. Used to hide actions that would otherwise
 * walk the user into the "not in this build yet" page.
 */
export function isLive(key: string): boolean {
  return moduleByKey(key)?.state === 'live';
}

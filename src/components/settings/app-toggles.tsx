'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setAppEnabled } from '@/lib/actions/settings';
import { Switch } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import type { AppKey } from '@/lib/types';

export function AppToggles({
  orgId,
  apps,
  modules,
}: {
  orgId: string;
  apps: Record<AppKey, boolean>;
  modules: { key: AppKey; label: string; tagline: string; live: boolean }[];
}) {
  const [busyKey, setBusyKey] = useState<AppKey | null>(null);
  const router = useRouter();

  const toggle = async (key: AppKey, next: boolean) => {
    setBusyKey(key);
    const result = await setAppEnabled(orgId, key, next);
    setBusyKey(null);
    if (result.ok) {
      toast.success(`${key} switched ${next ? 'on' : 'off'}`);
      router.refresh();
    } else {
      toast.error(result.error ?? 'Could not change that');
    }
  };

  return (
    <ul className="divide-y divide-line">
      {modules.map((module) => {
        const enabled = apps[module.key];
        return (
          <li key={module.key} className={cn('flex items-center gap-4 px-5 py-4', !module.live && 'bg-raised')}>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                {module.label}
                {!module.live && <Badge tone="neutral">in the next release</Badge>}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{module.tagline}</p>
            </div>
            <span className={cn('w-16 flex-none text-right text-[12px]', enabled ? 'text-success' : 'text-muted')}>
              {enabled ? 'On' : 'Off'}
            </span>
            <Switch
              checked={enabled}
              disabled={busyKey !== null || !module.live}
              onChange={(next) => void toggle(module.key, next)}
              label={`Switch ${module.label} ${enabled ? 'off' : 'on'}`}
            />
          </li>
        );
      })}
    </ul>
  );
}

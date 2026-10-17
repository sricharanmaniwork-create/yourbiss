'use client';

import { useRouter } from 'next/navigation';
import { setAutomationRuleEnabled } from '@/lib/actions/automations';
import { FormStatus, Switch, useAction } from '@/components/ui';

/**
 * The on/off switch, on its own, so it can sit in a list row.
 *
 * A failed write puts the switch back where the database says it is rather than leaving
 * it glowing in a position no rule holds — which matters more here than anywhere else in
 * the product, because a switch that looks on while the rule is off sends no letters and
 * gives no reason why.
 */
export function RuleSwitch({ ruleId, enabled, compact }: { ruleId: string; enabled: boolean; compact?: boolean }) {
  const router = useRouter();
  const { state, pending, run } = useAction();

  const flip = (next: boolean) => {
    void run(async () => {
      const result = await setAutomationRuleEnabled(ruleId, next);
      if (result.ok) router.refresh();
      return result;
    });
  };

  return (
    <div className={compact ? 'grid gap-1' : 'flex items-start gap-3'}>
      <Switch checked={enabled} disabled={pending} onChange={flip} label="Switch this rule on" />
      {compact ? null : <span className="mt-0.5 text-[12.5px] text-muted">{enabled ? 'On' : 'Off'}</span>}
      <FormStatus state={state?.ok ? null : state} />
    </div>
  );
}

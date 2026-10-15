'use client';

import { useCallback, useState, useTransition } from 'react';
import type { ActionState } from '@/lib/types';

/**
 * Every write in the product is a server action returning `ActionState`, so one
 * hook renders its pending, error and per-field states everywhere. Doing it this
 * way (rather than `useActionState` with FormData) keeps the action signatures
 * typed, which is what catches a renamed column at build time.
 */
export function useAction() {
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    async (action: () => Promise<ActionState>, onSuccess?: () => void) => {
      setState(null);
      startTransition(async () => {
        try {
          const result = await action();
          setState(result);
          if (result.ok) onSuccess?.();
        } catch (error) {
          setState({ ok: false, error: error instanceof Error ? error.message : 'That did not work' });
        }
      });
    },
    [],
  );

  return {
    state,
    pending,
    run,
    reset: () => setState(null),
    fieldError: (name: string) => state?.fields?.[name],
    success: state?.ok === true,
  };
}

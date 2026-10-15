import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ActionState } from '@/lib/types';

/** Sits under a form's save button and reports what the server just said. */
export function FormStatus({ state }: { state: ActionState | null }) {
  if (!state) return null;

  if (state.ok) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md border border-[#c6e7d0] bg-[#e6f4ea] px-3 py-2 text-[12.5px] text-[#0b6b3c]">
        <CircleCheck size={14} />
        Saved
      </p>
    );
  }

  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3 py-2 text-[12.5px] leading-relaxed text-[#a50f0f]">
      <CircleAlert size={14} className="mt-[2px] flex-none" />
      {state.error ?? 'That did not work.'}
    </p>
  );
}

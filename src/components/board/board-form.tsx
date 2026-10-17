'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBoard, updateBoard } from '@/lib/actions/board';
import { Button, Field, FormStatus, Input, Select, Textarea, useAction } from '@/components/ui';
import type { ActionState, BoardProject, BoardProjectStatus } from '@/lib/types';

const STATUSES: { value: BoardProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active — work is happening' },
  { value: 'paused', label: 'Paused — parked for now' },
  { value: 'completed', label: 'Completed — nothing more is going on it' },
];

/**
 * A board, started or edited.
 *
 * Starting one is a single database call (`youbiss.board_create_project`), because a board
 * with no lanes is not a board — the three lanes arrive in the same statement, so a failed
 * request cannot leave a header with nothing under it. That is also why the create form has
 * no status field: a new board is active, and its lanes are the three the function makes.
 * Changing either belongs to the settings screen, where the board already exists.
 */
export function BoardForm({ orgId, board }: { orgId: string; board?: BoardProject | null }) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [name, setName] = useState(board?.name ?? '');
  const [summary, setSummary] = useState(board?.summary ?? '');
  const [status, setStatus] = useState<BoardProjectStatus>(board?.status ?? 'active');

  const payload = { name, summary, status };

  const submit = () => {
    void run(async () => {
      const result: ActionState & { id?: string } = board
        ? await updateBoard(board.id, payload)
        : await createBoard(orgId, payload);
      if (result.ok && result.id) router.push(`/app/board/${result.id}`);
      else if (result.ok) router.refresh();
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[680px] px-5 py-5">
      <div className="grid gap-4">
        <Field label="Board name" htmlFor="board-name" required error={fieldError('name')} hint="Two words is plenty">
          <Input
            id="board-name"
            value={name}
            maxLength={80}
            invalid={!!fieldError('name')}
            placeholder="Launch the new site"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="What it is for" htmlFor="board-summary" error={fieldError('summary')} hint="Optional">
          <Textarea
            id="board-summary"
            rows={3}
            value={summary}
            maxLength={500}
            placeholder="One sentence a newcomer can read and understand the board from."
            onChange={(event) => setSummary(event.target.value)}
          />
        </Field>

        {board && (
          <Field
            label="State"
            htmlFor="board-status"
            hint="Says something about the board, not about its cards"
            error={fieldError('status')}
          >
            <Select id="board-status" value={status} onChange={(event) => setStatus(event.target.value as BoardProjectStatus)}>
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {!board && (
          <p className="rounded-md border border-[#dfe3e9] bg-[#eef0f3] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#41474f]">
            Saving starts the board with three lanes — To do, In progress, Done — which you can rename, add to or remove
            once it is open. A card that reaches the lane marked as finished is the only thing that marks work as done.
          </p>
        )}

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(board ? `/app/board/${board.id}` : '/app/board')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            {board ? 'Save board' : 'Start the board'}
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteCard, moveCard, updateCard } from '@/lib/actions/board';
import { Button, Field, FormStatus, Input, Modal, Select, Textarea, useAction } from '@/components/ui';
import type { BoardColumn, BoardTask } from '@/lib/types';
import { dateInZone } from '@/lib/utils';

/**
 * One card, opened.
 *
 * The caller keys this by card id, so opening a different card remounts it with that card&rsquo;s
 * own text in the fields instead of whatever was typed into the last one.
 *
 * The lane select is the only control here that does not wait for Save, because it is a
 * different question from what the card says: it is answered by `moveCard`, which lets the
 * database decide whether the card is now finished — the lane marked as done stamps
 * `completed_at`, and moving it back clears it. Saving the text never touches that flag.
 *
 * Deleting asks twice. A card is small and easy to click, and the second click costs nothing
 * next to a piece of work that took a week to write down.
 */
export function CardEditor({
  card,
  lanes,
  members,
  zone,
  onClose,
}: {
  card: BoardTask;
  lanes: BoardColumn[];
  members: { id: string; name: string }[];
  zone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [moved, setMoved] = useState<string | null>(null);

  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details ?? '');
  const [assigneeId, setAssigneeId] = useState(card.assignee_id ?? '');
  const [dueDay, setDueDay] = useState(card.due_at ? dateInZone(new Date(card.due_at), zone) : '');
  const [confirming, setConfirming] = useState(false);

  const laneId = moved ?? card.column_id;
  const payload = { title, details, assignee_id: assigneeId, due_day: dueDay };

  const save = () => {
    void run(async () => {
      const result = await updateCard(card.id, payload);
      if (result.ok) onClose();
      return result;
    });
  };

  const moveTo = (next: string) => {
    setMoved(next);
    void run(
      async () => {
        const result = await moveCard(card.id, next);
        if (!result.ok) setMoved(null);
        return result;
      },
      // The re-read is what brings back the finished flag the database just set, so the
      // card in the lane behind this dialog is correct the moment it closes.
      () => router.refresh(),
    );
  };

  const remove = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(async () => {
      const result = await deleteCard(card.id);
      if (result.ok) onClose();
      return result;
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={card.completed_at ? 'Finished card' : 'Card'}
      description={
        card.completed_at
          ? 'It stayed in the record after it was finished, which is the point of keeping it rather than deleting it.'
          : 'The lane a card stands in decides whether it counts as done.'
      }
      footer={
        <>
          <Button
            variant={confirming ? 'danger' : 'outlineDanger'}
            className="mr-auto"
            loading={pending && confirming}
            onClick={remove}
          >
            {confirming ? 'Delete for good' : 'Delete card'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" loading={pending} disabled={title.trim() === ''} onClick={save}>
            Save card
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="What has to be done" htmlFor="card-title" required error={fieldError('title')}>
          <Input
            id="card-title"
            value={title}
            maxLength={200}
            invalid={!!fieldError('title')}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field label="Details" htmlFor="card-details" error={fieldError('details')} hint="Optional">
          <Textarea
            id="card-details"
            rows={5}
            value={details}
            maxLength={4000}
            placeholder="The steps, the links, anything the next person needs."
            onChange={(event) => setDetails(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Lane" htmlFor="card-lane" hint="Saves at once">
            <Select id="card-lane" value={laneId} onChange={(event) => moveTo(event.target.value)}>
              {lanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {lane.name}
                  {lane.is_done ? ' — finished' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assigned to" htmlFor="card-assignee" error={fieldError('assignee_id')}>
            <Select
              id="card-assignee"
              value={assigneeId}
              invalid={!!fieldError('assignee_id')}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Nobody yet</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Due" htmlFor="card-due" error={fieldError('due_day')} hint="End of that day">
            <Input
              id="card-due"
              type="date"
              value={dueDay}
              invalid={!!fieldError('due_day')}
              onChange={(event) => setDueDay(event.target.value)}
            />
          </Field>
        </div>

        {dueDay && (
          <button type="button" className="justify-self-start text-[12px] text-muted hover:text-brand" onClick={() => setDueDay('')}>
            Remove the due date
          </button>
        )}

        <FormStatus state={state} />

        <p className="text-[12px] leading-relaxed text-muted">
          Moving the card into a lane whose settings say &ldquo;this is finished&rdquo; stamps it as done at this moment;
          dragging it back out un-finishes it. Both write a line in the activity timeline, which is what an Automations
          rule reads.
        </p>
      </div>
    </Modal>
  );
}

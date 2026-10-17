'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Settings2, User } from 'lucide-react';
import { addCard, addLane, deleteLane, moveCard, moveLane, updateLane } from '@/lib/actions/board';
import { Badge, Button, Field, FormStatus, Input, Modal, Switch, useAction } from '@/components/ui';
import { CardEditor } from '@/components/board/card-editor';
import type { BoardColumn, BoardProject, BoardTask } from '@/lib/types';
import { cn, formatDateInZone } from '@/lib/utils';

/**
 * The board itself: lanes left to right, cards on them.
 *
 * A card moves by drag, and by the lane select inside it for anyone on a phone or a keyboard.
 * Both call `moveCard` with nothing but a lane id, and whether the card is now finished is
 * answered by the database from that lane&rsquo;s `is_done` — this canvas never writes a
 * completion date, so it cannot end up disagreeing with the lane it dropped a card into.
 *
 * Counts and overdue states are worked out from the rows already on this page. Nothing here
 * is a stored number that could be out of date by the time somebody looks at it.
 */
export function BoardCanvas({
  board,
  lanes,
  cards,
  members,
  zone,
  nowIso,
}: {
  board: BoardProject;
  lanes: BoardColumn[];
  cards: BoardTask[];
  members: { id: string; name: string }[];
  zone: string;
  nowIso: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openCard, setOpenCard] = useState<BoardTask | null>(null);
  const [laneDialog, setLaneDialog] = useState<{ mode: 'new' } | { mode: 'edit'; lane: BoardColumn } | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const names = new Map(members.map((member) => [member.id, member.name]));
  const now = new Date(nowIso).getTime();

  const move = (cardId: string, laneId: string) => {
    start(async () => {
      await moveCard(cardId, laneId);
      router.refresh();
    });
  };

  const stopComposing = () => {
    setComposing(null);
    setDraft('');
    setDraftError(null);
  };

  const quickAdd = (laneId: string) => {
    const title = draft.trim();
    if (!title) return;
    start(async () => {
      const result = await addCard(laneId, { title, details: '', assignee_id: '', due_day: '' });
      if (result.ok) {
        stopComposing();
        router.refresh();
      } else {
        setDraftError(result.error ?? 'That card could not be added');
      }
    });
  };

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {lanes.map((lane) => {
          const laneCards = cards.filter((card) => card.column_id === lane.id);
          const open = laneCards.filter((card) => card.completed_at === null).length;

          return (
            <section
              key={lane.id}
              onDragOver={(event) => {
                event.preventDefault();
                if (over !== lane.id) setOver(lane.id);
              }}
              onDragLeave={() => setOver((current) => (current === lane.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const cardId = event.dataTransfer.getData('text/plain');
                if (cardId) move(cardId, lane.id);
              }}
              className={cn(
                'flex w-[278px] flex-none flex-col rounded-lg border bg-raised transition-colors',
                over === lane.id ? 'border-brand' : 'border-line',
              )}
              aria-label={`${lane.name}, ${laneCards.length} card${laneCards.length === 1 ? '' : 's'}`}
            >
              <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{lane.name}</span>
                {lane.is_done && (
                  <Badge tone="success" dot>
                    finished
                  </Badge>
                )}
                <span className={cn('text-[11.5px]', pending ? 'text-brand' : 'text-muted')}>{open}</span>
                <button
                  type="button"
                  onClick={() => setLaneDialog({ mode: 'edit', lane })}
                  aria-label={`Settings for the lane ${lane.name}`}
                  className="rounded-md p-1 text-[#8b95a3] hover:bg-black/[0.05] hover:text-ink"
                >
                  <Settings2 size={13} aria-hidden="true" />
                </button>
              </header>

              <div className="flex flex-1 flex-col gap-2 px-3 py-2.5">
                {laneCards.map((card) => (
                  <CardTile
                    key={card.id}
                    card={card}
                    assignee={card.assignee_id ? (names.get(card.assignee_id) ?? 'a person no longer here') : null}
                    zone={zone}
                    overdue={card.due_at !== null && card.completed_at === null && new Date(card.due_at).getTime() < now}
                    onOpen={() => setOpenCard(card)}
                  />
                ))}

                {laneCards.length === 0 && composing !== lane.id && (
                  <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[11.5px] leading-relaxed text-muted">
                    Nothing here yet
                  </p>
                )}

                {composing === lane.id ? (
                  <div className="rounded-md border border-brand bg-surface p-2">
                    <label className="sr-only" htmlFor={`new-card-${lane.id}`}>
                      New card in {lane.name}
                    </label>
                    <textarea
                      id={`new-card-${lane.id}`}
                      rows={3}
                      value={draft}
                      maxLength={200}
                      placeholder="What has to be done?"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          quickAdd(lane.id);
                        }
                        if (event.key === 'Escape') stopComposing();
                      }}
                      className="w-full resize-y rounded border border-line-strong bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-[#9aa3af]"
                    />
                    {draftError && (
                      <p role="alert" className="mt-1 text-[11.5px] leading-relaxed text-danger">
                        {draftError}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={stopComposing}>
                        Cancel
                      </Button>
                      <Button size="sm" variant="primary" loading={pending} disabled={draft.trim() === ''} onClick={() => quickAdd(lane.id)}>
                        Add card
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setComposing(lane.id);
                      setDraft('');
                      setDraftError(null);
                    }}
                    className="mt-auto flex items-center gap-1.5 self-start rounded-md px-2 py-1.5 text-[12px] font-medium text-muted hover:bg-black/[0.05] hover:text-brand"
                  >
                    <Plus size={13} aria-hidden="true" />
                    Add a card
                  </button>
                )}
              </div>
            </section>
          );
        })}

        <div className="flex w-[220px] flex-none flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => setLaneDialog({ mode: 'new' })}
            className="justify-start"
          >
            <Plus size={14} aria-hidden="true" />
            Add a lane
          </Button>
          <p className="px-1 text-[11.5px] leading-relaxed text-muted">
            The lane you mark as finished is the one that decides when a card stops being open work. It stamps the
            moment the card lands there and writes the timeline line Automations reads.
          </p>
        </div>
      </div>

      {openCard && (
        <CardEditor
          key={openCard.id}
          card={openCard}
          lanes={lanes}
          members={members}
          zone={zone}
          onClose={() => setOpenCard(null)}
        />
      )}

      <LaneDialog
        key={laneDialog && laneDialog.mode === 'edit' ? laneDialog.lane.id : 'new'}
        boardId={board.id}
        open={laneDialog !== null}
        mode={laneDialog?.mode ?? 'new'}
        lane={laneDialog && laneDialog.mode === 'edit' ? laneDialog.lane : null}
        position={laneDialog && laneDialog.mode === 'edit' ? lanes.findIndex((row) => row.id === laneDialog.lane.id) : -1}
        laneCount={lanes.length}
        onClose={() => setLaneDialog(null)}
      />
    </>
  );
}

/**
 * A card is a button, because the fast path on a keyboard is the same as the fast path on a
 * mouse: press it, and the whole card opens. Dragging it is the shortcut for a mouse.
 */
function CardTile({
  card,
  assignee,
  zone,
  overdue,
  onOpen,
}: {
  card: BoardTask;
  assignee: string | null;
  zone: string;
  overdue: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/plain', card.id)}
      onClick={onOpen}
      className={cn(
        'w-full cursor-grab rounded-md border bg-surface px-3 py-2.5 text-left shadow-[var(--shadow-card)] transition-colors hover:border-brand',
        card.completed_at ? 'border-line bg-[#f6f8fa]' : 'border-line',
        overdue && 'border-[#f0c3bf]',
      )}
      aria-label={`Open the card ${card.title}`}
    >
      <span className={cn('block text-[13px] font-medium leading-snug', card.completed_at ? 'text-muted line-through' : 'text-ink')}>
        {card.title}
      </span>

      {(assignee || card.due_at) && (
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {assignee && (
            <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-muted">
              <User size={11} aria-hidden="true" />
              <span className="truncate">{assignee}</span>
            </span>
          )}
          {card.due_at && (
            <span className={cn('inline-flex items-center gap-1 text-[11.5px]', overdue ? 'font-medium text-danger' : 'text-muted')}>
              <CalendarDays size={11} aria-hidden="true" />
              {overdue ? 'overdue since ' : 'due '}
              {formatDateInZone(card.due_at, zone)}
            </span>
          )}
        </span>
      )}

      {card.details && (
        <span className="mt-1.5 block line-clamp-2 text-[11.5px] leading-relaxed text-muted">{card.details}</span>
      )}
    </button>
  );
}

/**
 * One lane&rsquo;s settings: what it is called, whether it means finished, where it sits, and
 * whether it should exist at all.
 *
 * Renaming a lane or marking it finished is one write. Moving it left or right is another,
 * because a slide swaps two position numbers with its neighbour and there is nothing else on
 * the lane to change. Deleting is refused by the database while cards stand in the lane — the
 * sentence it raises is printed here rather than guessed at.
 */
function LaneDialog({
  boardId,
  open,
  mode,
  lane,
  position,
  laneCount,
  onClose,
}: {
  boardId: string;
  open: boolean;
  mode: 'new' | 'edit';
  lane: BoardColumn | null;
  position: number;
  laneCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [name, setName] = useState(lane?.name ?? '');
  const [isDone, setIsDone] = useState(lane?.is_done ?? false);
  const [confirming, setConfirming] = useState(false);

  const payload = { name, is_done: isDone };

  const save = () => {
    void run(async () => {
      const result = lane ? await updateLane(lane.id, payload) : await addLane(boardId, payload);
      if (result.ok) {
        onClose();
        router.refresh();
      }
      return result;
    });
  };

  const slide = (direction: 'left' | 'right') => {
    if (!lane) return;
    void run(
      async () => await moveLane(lane.id, direction),
      () => router.refresh(),
    );
  };

  const remove = () => {
    if (!lane) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(
      async () => {
        const result = await deleteLane(lane.id);
        if (result.ok) onClose();
        return result;
      },
      () => router.refresh(),
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'new' ? 'A new lane' : `“${lane?.name ?? ''}”`}
      description={
        mode === 'new'
          ? 'A new lane joins the right-hand end of the board.'
          : 'A lane holds cards and says whether standing in it means the work is finished.'
      }
      footer={
        <>
          {lane && (
            <div className="mr-auto flex items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={pending || position <= 0} onClick={() => slide('left')} aria-label="Move the lane left">
                <ChevronLeft size={14} aria-hidden="true" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || position < 0 || position >= laneCount - 1}
                onClick={() => slide('right')}
                aria-label="Move the lane right"
              >
                <ChevronRight size={14} aria-hidden="true" />
              </Button>
              <Button size="sm" variant={confirming ? 'danger' : 'outlineDanger'} loading={pending} onClick={remove}>
                {confirming ? 'Delete for good' : 'Delete lane'}
              </Button>
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={save}>
            {mode === 'new' ? 'Add lane' : 'Save lane'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Lane name" htmlFor="lane-name" required error={fieldError('name')}>
          <Input
            id="lane-name"
            value={name}
            maxLength={40}
            invalid={!!fieldError('name')}
            placeholder="Waiting on the client"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div className="flex items-start justify-between gap-4 rounded-md border border-line bg-raised px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium text-ink">This lane means the work is finished</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
              {isDone
                ? 'A card dropped in here is stamped as done at that moment, and dragging it out un-finishes it.'
                : 'Cards in this lane stay open work, whatever they are called.'}
            </p>
          </div>
          <Switch checked={isDone} onChange={setIsDone} disabled={pending} label="This lane means the work is finished" />
        </div>

        {lane && lane.is_done !== isDone && (
          <p className="text-[12px] leading-relaxed text-muted">
            Saving this does not rewrite the cards already standing in the lane. The next time one of them is moved or
            saved, it takes its finished state from the lane it is in.
          </p>
        )}

        <FormStatus state={state} />
      </div>
    </Modal>
  );
}

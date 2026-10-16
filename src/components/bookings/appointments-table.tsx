'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, ChevronDown, ChevronUp, Mail, Move, Notebook, Phone, UserCheck, UserRound, UserX, X } from 'lucide-react';
import { moveBooking, saveInternalNotes, setBookingState } from '@/lib/actions/bookings';
import { loadDays, loadSlots } from '@/lib/bookings/availability';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Modal,
  Spinner,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  toast,
  useAction,
} from '@/components/ui';
import { clockInZone, formatDateInZone } from '@/lib/utils';
import { BOOKING_SOURCE_LABELS, type AppointmentDoc } from './types-client';
import { SlotPicker, type ChosenSlot } from './slot-picker';

/**
 * The appointments list: every row a member can act on, and only the acts that row allows.
 *
 * Two things decide what a row offers, and neither is invented here. The transitions come
 * from the server (`allowed`), because `bookings_immutable_fields` refuses to reopen a
 * closed booking and `bclosed_write` is admin-only — a member who could press "completed"
 * would only meet an error they were never going to avoid. And a move goes through
 * `reschedule_booking` alone, so the grid in the dialog is read in the zone stored on the
 * row: the same clock the write will re-check, which is why an hour edited since the
 * booking was made cannot offer a time the move then refuses.
 *
 * A cancelled row has no reopen button on purpose. The trigger says a closed booking stays
 * closed; the honest path is to record the appointment again, which keeps the cancelled row
 * as the record it is.
 */
export function AppointmentsTable({
  rows,
  zone,
  today,
  canManage,
}: {
  rows: AppointmentDoc[];
  zone: string;
  today: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const { state, pending, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [move, setMove] = useState<AppointmentDoc | null>(null);
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [cancel, setCancel] = useState<AppointmentDoc | null>(null);
  const [reason, setReason] = useState('');

  const act = (row: AppointmentDoc, next: 'confirmed' | 'completed' | 'no_show') => {
    setBusy(row.id);
    void run(async () => {
      const result = await setBookingState(row.id, next);
      if (result.ok) {
        toast.success(`${row.customerName}’s appointment is ${next.replace('_', ' ')}`);
        router.refresh();
      }
      setBusy(null);
      return result;
    });
  };

  const close = () => {
    if (!cancel) return;
    setBusy(cancel.id);
    void run(async () => {
      const result = await setBookingState(cancel.id, 'cancelled', reason);
      if (result.ok) {
        toast.success(`${cancel.customerName}’s appointment is cancelled and the letter is queued`);
        setCancel(null);
        setReason('');
        router.refresh();
      }
      setBusy(null);
      return result;
    });
  };

  const applyMove = () => {
    if (!move || !chosen) return;
    setBusy(move.id);
    void run(async () => {
      const result = await moveBooking(move.id, chosen.startsAt);
      if (result.ok) {
        toast.success(`${move.customerName}’s appointment has a new time and the letter is queued`);
        setMove(null);
        setChosen(null);
        router.refresh();
      }
      setBusy(null);
      return result;
    });
  };

  return (
    <>
      <Card>
        <CardBody className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Customer</TH>
                <TH>Service and team</TH>
                <TH>State</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => {
                const expanded = open === row.id;
                return (
                  <TR key={row.id}>
                    <TD className={expanded ? 'bg-raised' : undefined}>
                      <span className="block whitespace-nowrap text-[12.5px] font-medium text-ink">
                        {formatDateInZone(`${row.startsAt}T00:00:00Z`, 'UTC')}
                      </span>
                      <span className="block whitespace-nowrap font-mono text-[12px] text-ink-soft">
                        {clockInZone(row.startsAt, zone)} – {clockInZone(row.endsAt, zone)}
                      </span>
                      {row.timezone !== zone && (
                        <span className="block font-mono text-[11px] text-muted">
                          {clockInZone(row.startsAt, row.timezone)} {row.timezone.split('/').pop()?.replace(/_/g, ' ')}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : row.id)}
                        className="max-w-[220px] text-left hover:text-brand"
                      >
                        <span className="block truncate text-[13px] font-medium text-ink">{row.customerName}</span>
                        <span className="block truncate text-[11.5px] text-muted">{row.customerEmail}</span>
                      </button>
                    </TD>
                    <TD>
                      <span className="block truncate text-[13px] text-ink">
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 flex-none rounded-full align-middle"
                          style={{ backgroundColor: row.color }}
                          aria-hidden="true"
                        />
                        {row.serviceName}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">{row.staffName}</span>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge state={row.state} />
                        <span className="text-[11.5px] text-muted">{BOOKING_SOURCE_LABELS[row.source] ?? row.source}</span>
                      </span>
                    </TD>
                    <TD align="right">
                      <span className="flex items-center justify-end gap-1.5">
                        {busy === row.id && <Spinner label="Working" className="h-4 w-4" />}
                        {canManage && row.allowed.includes('confirmed') && (
                          <Button size="sm" onClick={() => act(row, 'confirmed')} disabled={busy !== null}>
                            <UserCheck size={13} />
                            Confirm
                          </Button>
                        )}
                        {canManage && row.allowed.includes('completed') && (
                          <Button size="sm" onClick={() => act(row, 'completed')} disabled={busy !== null}>
                            <CheckCheck size={13} />
                            Complete
                          </Button>
                        )}
                        {canManage && row.allowed.includes('no_show') && (
                          <Button size="sm" onClick={() => act(row, 'no_show')} disabled={busy !== null}>
                            <UserX size={13} />
                            No-show
                          </Button>
                        )}
                        {canManage && row.allowed.includes('cancelled') && (
                          <Button size="sm" variant="ghost" onClick={() => setCancel(row)} disabled={busy !== null}>
                            <X size={13} />
                            Cancel
                          </Button>
                        )}
                        {canManage && row.allowed.length > 0 && !row.allowed.includes('cancelled') && (
                          <Badge tone="neutral" className="mr-1">
                            Closed
                          </Badge>
                        )}
                        {canManage && (row.state === 'pending' || row.state === 'confirmed') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setMove(row);
                              setChosen(null);
                            }}
                            disabled={busy !== null}
                          >
                            <Move size={13} />
                            Move
                          </Button>
                        )}
                        <button
                          type="button"
                          onClick={() => setOpen(expanded ? null : row.id)}
                          className="p-1.5 text-muted hover:text-ink"
                          aria-label={expanded ? `Hide the detail of ${row.code}` : `Show the detail of ${row.code}`}
                        >
                          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      {open && (
        <DetailPanel
          key={open}
          row={rows.find((entry) => entry.id === open) ?? null}
          onNotesSaved={() => router.refresh()}
          busy={busy !== null}
        />
      )}

      {state && !state.ok && (
        <p className="mt-3 rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3 py-2 text-[12.5px] text-danger">{state.error}</p>
      )}

      <Modal
        open={move !== null}
        onClose={() => setMove(null)}
        size="lg"
        title={move ? `Move ${move.customerName}’s appointment` : 'Move appointment'}
        description="Only the times the booking engine itself offers are listed, and the move is re-checked the moment it is sent."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMove(null)}>
              Keep the current time
            </Button>
            <Button variant="primary" loading={pending} disabled={!chosen} onClick={applyMove}>
              Move to that time
            </Button>
          </>
        }
      >
        {move && (
          <SlotPicker
            serviceId={move.serviceId}
            team={[]}
            timeZone={move.timezone}
            pinnedZone={move.timezone}
            today={today}
            horizonDays={move.horizonDays}
            loadDays={loadDays}
            loadSlots={loadSlots}
            onChoose={setChosen}
            lockedStaff={{ id: move.staffId, name: move.staffName }}
          />
        )}
      </Modal>

      <Modal
        open={cancel !== null}
        onClose={() => setCancel(null)}
        title={cancel ? `Cancel ${cancel.customerName}’s appointment` : 'Cancel appointment'}
        description="The customer is told. A cancelled booking keeps its row so the record of what was booked, and then called off, survives."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancel(null)}>
              Leave it booked
            </Button>
            <Button variant="danger" loading={pending} onClick={close}>
              Cancel the appointment
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Why, in a sentence (optional)</span>
          <Textarea
            value={reason}
            rows={3}
            maxLength={300}
            placeholder="The practitioner was taken ill"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {cancel && (
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Reference {cancel.code}, {formatDateInZone(`${cancel.startsAt}T00:00:00Z`, 'UTC')} at{' '}
            {clockInZone(cancel.startsAt, cancel.timezone)} in {cancel.timezone.replace(/_/g, ' ')}. A cancelled booking
            cannot be reopened — record the appointment again if the customer wants a new time.
          </p>
        )}
      </Modal>
    </>
  );
}

function DetailPanel({ row, onNotesSaved, busy }: { row: AppointmentDoc | null; onNotesSaved: () => void; busy: boolean }) {
  const router = useRouter();
  const { state, pending, run } = useAction();
  const [notes, setNotes] = useState(row?.internalNotes ?? '');

  if (!row) return null;

  const save = () => {
    void run(async () => {
      const result = await saveInternalNotes(row.id, notes);
      if (result.ok) {
        toast.success('Internal note saved');
        onNotesSaved();
        router.refresh();
      }
      return result;
    });
  };

  return (
    <Card className="mt-3">
      <CardBody className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2 text-[12.5px]">
          <p className="flex items-center gap-2 text-ink">
            <UserRound size={14} className="text-muted" />
            {row.customerName}
            <span className="font-mono text-[11.5px] text-muted">{row.code}</span>
          </p>
          <p className="flex items-center gap-2">
            <Mail size={14} className="text-muted" />
            <a href={`mailto:${row.customerEmail}`} className="text-brand hover:underline">
              {row.customerEmail}
            </a>
          </p>
          <p className="flex items-center gap-2 text-ink-soft">
            <Phone size={14} className="text-muted" />
            {row.customerPhone || 'No phone recorded'}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Booked {formatDateInZone(row.createdAt, 'UTC')}. The note the customer wrote, if any, is below; nothing here
            is ever sent to them.
          </p>
          {row.notes && <p className="rounded-md border border-line bg-raised px-3 py-2 leading-relaxed text-ink-soft">{row.notes}</p>}
          {row.cancelReason && (
            <p className="rounded-md border border-[#f4c7c4] bg-[#fcebea] px-3 py-2 leading-relaxed text-danger">
              Cancelled: {row.cancelReason}
            </p>
          )}
        </div>

        <div>
          <label className="block" htmlFor={`notes-${row.id}`}>
            <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
              <Notebook size={14} className="text-muted" />
              Internal note
            </span>
            <Textarea
              id={`notes-${row.id}`}
              value={notes}
              rows={4}
              maxLength={2000}
              placeholder="Only this workspace can read this"
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <span className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="primary" loading={pending} disabled={busy || notes === (row.internalNotes ?? '')} onClick={save}>
              Save note
            </Button>
            {state && !state.ok && <span className="text-[12px] text-danger">{state.error}</span>}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

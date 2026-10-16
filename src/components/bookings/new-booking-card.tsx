'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarPlus } from 'lucide-react';
import { bookingTeam, createManualBooking } from '@/lib/actions/bookings';
import { loadDays, loadSlots } from '@/lib/bookings/availability';
import { Button, Card, CardBody, CardHeader, Field, FormStatus, Input, Select, Textarea, toast, useAction } from '@/components/ui';
import { formatInZone } from '@/lib/utils';
import type { PublicStaff } from '@/lib/bookings/types';
import { SlotPicker, type ChosenSlot } from './slot-picker';

/**
 * Records an appointment for someone who phoned, walked in, or was booked by a colleague.
 *
 * It is the customer's own calendar, not a separate admin grid: the same `SlotPicker`,
 * reading the same `available_slots()` the booking page reads, so a time offered here is a
 * time `create_booking()` accepts. The write then goes through that function with
 * `p_source = 'manual'` — the only door with a conflict check and an advisory lock — which
 * is why this screen cannot make an overlapping appointment even by accident.
 *
 * Only services that are actually on a booking page are listed: `slot_conflict()` refuses a
 * hidden or archived service, so a manual booking against one would fail at the last step
 * for a reason nobody could see coming.
 */
export function NewBookingCard({
  services,
  initialServiceId,
  initialTeam,
  today,
}: {
  services: { id: string; name: string; color: string; timezone: string; durationMin: number; horizonDays: number }[];
  initialServiceId: string;
  initialTeam: PublicStaff[];
  today: string;
}) {
  const { state, pending, run, fieldError } = useAction();
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [team, setTeam] = useState<PublicStaff[]>(initialTeam);
  const [readingTeam, setReadingTeam] = useState(false);
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [code, setCode] = useState<string | null>(null);

  const service = services.find((entry) => entry.id === serviceId) ?? services[0];

  const pickService = (next: string) => {
    setServiceId(next);
    setChosen(null);
    setTeam([]);
    setReadingTeam(true);
    void (async () => {
      const result = await bookingTeam(next).catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : 'The team could not be read.',
      }));
      setReadingTeam(false);
      if (!result.ok) {
        toast.error(result.error ?? 'The team could not be read.');
        return;
      }
      setTeam(result.team ?? []);
    })();
  };

  const submit = () => {
    if (!chosen) return;
    void run(async () => {
      const result = await createManualBooking({
        service_id: serviceId,
        staff_id: chosen.staffId,
        starts_at: chosen.startsAt,
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        notes,
      });
      if (result.ok && result.code) {
        setCode(result.code);
        toast.success(`Appointment recorded as ${result.code}`);
      }
      return result;
    });
  };

  if (code) {
    return (
      <Card className="max-w-[640px]">
        <CardBody className="px-5 py-6 text-center">
          <CalendarPlus size={26} className="mx-auto text-success" />
          <h2 className="mt-3 text-[16px] font-semibold text-ink">Recorded</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            The appointment is in the diary under reference{' '}
            <span className="rounded bg-brand-soft px-2 py-1 font-mono text-[13px] font-semibold text-brand-dark">{code}</span>.
            The customer’s confirmation letter is queued, and the person they are seeing has been told.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              href={`/app/bookings/appointments?q=${encodeURIComponent(code)}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[12.5px] font-medium text-ink-soft hover:bg-raised"
            >
              Open it in the list
              <ArrowRight size={14} />
            </Link>
            <Button
              variant="primary"
              onClick={() => {
                setCode(null);
                setChosen(null);
                setName('');
                setEmail('');
                setPhone('');
                setNotes('');
              }}
            >
              Record another
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px] xl:items-start">
      <Card>
        <CardHeader
          title="Who, and when"
          description="Pick the service, then the person and the time. Only the slots the booking engine itself offers appear, so what is clickable is what can be saved."
        />
        <CardBody className="grid gap-4">
          <Field label="Service" htmlFor="service" hint="A hidden or archived service is not bookable by anyone, so it is not listed.">
            <Select id="service" value={serviceId} onChange={(event) => pickService(event.target.value)}>
              {services.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.durationMin} min
                </option>
              ))}
            </Select>
          </Field>

          {readingTeam ? (
            <p className="rounded-md border border-line bg-raised px-3 py-6 text-center text-[13px] text-ink-muted">
              Reading who offers this service…
            </p>
          ) : (
            <SlotPicker
              serviceId={serviceId}
              team={team}
              timeZone={service?.timezone ?? 'UTC'}
              today={today}
              horizonDays={service?.horizonDays ?? 30}
              loadDays={loadDays}
              loadSlots={loadSlots}
              onChoose={setChosen}
              accent={service?.color}
              emptyTeamCopy="Nobody offers this service yet, so there is nothing to book. Assign it to a team member on the service’s team tab first."
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Customer" description="Their name and address are what the confirmation is sent to." />
        <CardBody className="grid gap-4">
          <Field label="Name" htmlFor="customer-name" required error={fieldError('customer_name')}>
            <Input
              id="customer-name"
              value={name}
              maxLength={120}
              autoComplete="off"
              invalid={!!fieldError('customer_name')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Email"
            htmlFor="customer-email"
            required
            error={fieldError('customer_email')}
            hint="The reference and this address together are what let them move or cancel it themselves."
          >
            <Input
              id="customer-email"
              type="email"
              value={email}
              maxLength={320}
              autoComplete="off"
              invalid={!!fieldError('customer_email')}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="customer-phone" error={fieldError('customer_phone')}>
            <Input
              id="customer-phone"
              type="tel"
              value={phone}
              maxLength={32}
              autoComplete="off"
              invalid={!!fieldError('customer_phone')}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field label="What they said" htmlFor="notes" hint="Kept on the appointment. Nothing here is sent to the customer.">
            <Textarea id="notes" value={notes} rows={3} maxLength={2000} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          <FormStatus state={state} />

          <div className="rounded-md border border-line bg-raised px-3 py-2.5">
            <p className="text-[11.5px] uppercase tracking-[0.04em] text-muted">Selected time</p>
            <p className="mt-1 text-[13px] text-ink">
              {chosen ? formatInZone(chosen.startsAt, service?.timezone ?? 'UTC') : 'No time chosen yet'}
            </p>
            {chosen && (
              <p className="mt-0.5 text-[11.5px] text-muted">
                {team.find((member) => member.id === chosen.staffId)?.name ?? 'Team member'} ·{' '}
                {(service?.timezone ?? 'UTC').replace(/_/g, ' ')}
              </p>
            )}
          </div>

          <Button variant="primary" loading={pending} disabled={!chosen} onClick={submit}>
            <CalendarPlus size={15} />
            Record the appointment
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

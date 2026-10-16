'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, CalendarCheck, CheckCircle2, Clock, Globe, MapPin, Wallet } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui';
import { SlotPicker, type ChosenSlot, type LoadDays, type LoadSlots } from './slot-picker';
import type { PublicService, PublicStaff } from '@/lib/bookings/types';
import { clockInZone, formatInZone, formatMoney } from '@/lib/utils';

/**
 * The booking page a customer uses: who, when, details, done.
 *
 * It posts to `/api/book`, which re-reads the service, the team member and the instant
 * before `create_booking()` runs — so this component is a convenience, not a gate. The
 * hidden `company` field is the honeypot that route looks for, and is named the same on
 * purpose: a bot that has already learned the form-field trick finds a familiar-looking
 * field here.
 *
 * Confirmation returns a reference code and the address that manages it. The code is
 * not enough to cancel by itself — the manage page asks for the email address too — so
 * the link in the mail and the link on this screen can both be safe.
 */

export interface BookingPageProps {
  service: PublicService;
  team: PublicStaff[];
  today: string;
  loadDays: LoadDays;
  loadSlots: LoadSlots;
  /** `embed` drops the card: the frame already sits inside someone's page. */
  variant?: 'page' | 'embed';
  /** The frame and a shared link can both name the person up front with `?staff=`. */
  defaultStaffId?: string;
}

interface Result {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
  code?: string | null;
  booking?: { starts_at: string; ends_at: string; timezone: string; state: string };
  manage_path?: string;
  intake?: { title: string; path: string } | null;
}

const LOCATION_LABEL: Record<PublicService['locationKind'], string> = {
  onsite: 'In person',
  online: 'Online',
  phone: 'By phone',
};

export function BookingPage({ service, team, today, loadDays, loadSlots, variant = 'page', defaultStaffId }: BookingPageProps) {
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [step, setStep] = useState<'time' | 'details'>('time');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [trapped, setTrapped] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Result | null>(null);

  const staff = useMemo(() => team.find((member) => member.id === chosen?.staffId) ?? null, [team, chosen]);
  const zone = staff?.timezone || service.timezone;

  const confirm = async () => {
    if (!chosen || sending) return;
    setSending(true);
    setNotice(null);
    setErrors({});
    try {
      const response = await fetch('/api/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service: service.id,
          staff: chosen.staffId,
          starts_at: chosen.startsAt,
          name,
          email,
          phone,
          notes,
          company: trapped,
        }),
      });
      const result = (await response.json().catch(() => null)) as Result | null;
      if (response.ok && result?.ok) {
        setDone(result);
        return;
      }
      setErrors(result?.fields ?? {});
      setNotice(result?.error ?? 'Your booking could not be recorded. Please try again.');
      if (result?.fields?.starts_at) setStep('time');
    } catch {
      setNotice('Your connection dropped. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (done?.ok) return <Confirmation service={service} result={done} variant={variant} />;

  const summary = (
    <div className="rounded-lg border border-line bg-surface shadow-panel">
      <div className="rounded-t-lg border-b border-line px-5 py-4" style={{ borderTop: `3px solid ${service.color}` }}>
        <p className="text-[12px] uppercase tracking-wide text-ink-muted">{service.orgName}</p>
        <h1 className="mt-0.5 text-[18px] font-semibold text-ink">{service.heading || service.name}</h1>
        {service.description && <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{service.description}</p>}
      </div>
      <dl className="divide-y divide-line text-[13px]">
        <Row icon={<Clock size={14} />} term="Length">
          {service.durationMin} minutes
        </Row>
        <Row icon={<MapPin size={14} />} term="Where">
          {LOCATION_LABEL[service.locationKind]}
        </Row>
        {service.priceCents > 0 && (
          <Row icon={<Wallet size={14} />} term="Price">
            {formatMoney(service.priceCents, service.currency)}
          </Row>
        )}
        <Row icon={<Globe size={14} />} term="Time zone">
          {zone.replace(/_/g, ' ')}
        </Row>
        {chosen && (
          <Row icon={<CalendarCheck size={14} />} term="Selected">
            <span className="font-medium text-ink">{formatInZone(chosen.startsAt, zone)}</span>
            <span className="block text-[12px] text-ink-muted">{staff?.name}</span>
          </Row>
        )}
      </dl>
    </div>
  );

  const body = (
    <>
      {step === 'time' ? (
        <div className="space-y-4">
          <SlotPicker
            serviceId={service.id}
            team={team}
            timeZone={service.timezone}
            today={today}
            horizonDays={service.maxHorizonDays}
            loadDays={loadDays}
            loadSlots={loadSlots}
            onChoose={setChosen}
            accent={service.color}
            defaultStaffId={defaultStaffId}
          />
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[12.5px] text-ink-muted">{service.instructions || 'Pick a time that suits you.'}</p>
            <Button variant="primary" disabled={!chosen} onClick={() => setStep('details')}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Details
            name={name}
            email={email}
            phone={phone}
            notes={notes}
            trapped={trapped}
            requirePhone={service.requirePhone}
            errors={errors}
            notice={notice}
            sending={sending}
            setName={setName}
            setEmail={setEmail}
            setPhone={setPhone}
            setNotes={setNotes}
            setTrapped={setTrapped}
            onBack={() => setStep('time')}
            onConfirm={confirm}
            chosen={chosen ? `${formatInZone(chosen.startsAt, zone)} with ${staff?.name ?? service.name}` : ''}
          />
        </div>
      )}
    </>
  );

  if (variant === 'embed') {
    return (
      <div className="mx-auto max-w-[720px] p-4">
        {summary}
        <div className="mt-4">{body}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1040px] gap-6 px-4 py-8 lg:grid-cols-[340px_1fr] lg:items-start">
      <div className="lg:sticky lg:top-6">{summary}</div>
      <div className="rounded-lg border border-line bg-surface p-5 shadow-panel sm:p-6">{body}</div>
    </div>
  );
}

function Row({ icon, term, children }: { icon: React.ReactNode; term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <span className="mt-0.5 text-ink-muted" aria-hidden="true">
        {icon}
      </span>
      <dt className="w-20 flex-none text-ink-muted">{term}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function Details({
  name,
  email,
  phone,
  notes,
  trapped,
  requirePhone,
  errors,
  notice,
  sending,
  chosen,
  setName,
  setEmail,
  setPhone,
  setNotes,
  setTrapped,
  onBack,
  onConfirm,
}: {
  name: string;
  email: string;
  phone: string;
  notes: string;
  trapped: string;
  requirePhone: boolean;
  errors: Record<string, string>;
  notice: string | null;
  sending: boolean;
  chosen: string;
  setName: (value: string) => void;
  setEmail: (value: string) => void;
  setPhone: (value: string) => void;
  setNotes: (value: string) => void;
  setTrapped: (value: string) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-raised px-4 py-3">
        <p className="text-[12px] uppercase tracking-wide text-ink-muted">Your time</p>
        <p className="mt-1 text-[14px] font-medium text-ink">{chosen}</p>
      </div>

      {/* Bots fill every text input they find; nobody else can see or reach this one. */}
      <input
        type="text"
        name="company"
        value={trapped}
        onChange={(event) => setTrapped(event.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden"
      />

      {notice && (
        <p role="alert" aria-live="polite" className="rounded-md border border-[#f0c3bf] bg-[#fdf2f1] px-3 py-2 text-[12.5px] text-danger">
          {notice}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
            Your name<span className="ml-0.5 text-danger">*</span>
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={120}
            required
            aria-invalid={!!errors.customer_name || undefined}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
          />
          {errors.customer_name && <span className="mt-1 block text-[12px] text-danger">{errors.customer_name}</span>}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
            Email<span className="ml-0.5 text-danger">*</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
            maxLength={320}
            required
            aria-invalid={!!errors.customer_email || undefined}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
          />
          {errors.customer_email && <span className="mt-1 block text-[12px] text-danger">{errors.customer_email}</span>}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">
            Phone{requirePhone && <span className="ml-0.5 text-danger">*</span>}
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            maxLength={32}
            required={requirePhone}
            aria-invalid={!!errors.customer_phone || undefined}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-[#9aa3af] focus:border-brand"
          />
          {errors.customer_phone && <span className="mt-1 block text-[12px] text-danger">{errors.customer_phone}</span>}
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12.5px] font-medium text-ink-soft">Anything they should know?</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-[#9aa3af] focus:border-brand"
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <Button onClick={onBack} disabled={sending}>
          <ArrowLeft size={14} />
          Another time
        </Button>
        <Button variant="primary" onClick={onConfirm} loading={sending}>
          {sending ? 'Booking…' : 'Confirm booking'}
        </Button>
      </div>
    </div>
  );
}

function Confirmation({ service, result, variant }: { service: PublicService; result: Result; variant: 'page' | 'embed' }) {
  const booking = result.booking;
  const zone = booking?.timezone || service.timezone;

  const card = (
    <div className="rounded-lg border border-line bg-surface p-6 text-center shadow-panel">
      <CheckCircle2 size={34} className="mx-auto text-success" />
      <h1 className="mt-3 text-[19px] font-semibold text-ink">You are booked in</h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        {service.orgName} has the details. A confirmation is on its way to your inbox.
      </p>

      {booking && (
        <p className="mx-auto mt-4 max-w-[380px] rounded-md border border-line bg-raised px-4 py-3 text-[13.5px] text-ink">
          {formatInZone(booking.starts_at, zone)}
          <span className="mt-1 block text-[12px] text-ink-muted">
            until {clockInZone(booking.ends_at, zone)} · {zone.replace(/_/g, ' ')}
          </span>
        </p>
      )}

      {result.code && (
        <p className="mt-4 text-[13px] text-ink-soft">
          Your reference is <span className="rounded bg-brand-soft px-2 py-1 font-mono text-[13px] font-semibold text-brand-dark">{result.code}</span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {result.manage_path && (
          <ButtonLink href={result.manage_path} size="md">
            Manage this booking
          </ButtonLink>
        )}
        {result.intake && (
          <ButtonLink href={result.intake.path} variant="primary" size="md">
            Fill in {result.intake.title}
          </ButtonLink>
        )}
      </div>

      <p className="mt-4 text-[11.5px] text-ink-muted">
        Keep the reference. Moving or cancelling needs it and the email address you just used.
      </p>
    </div>
  );

  if (variant === 'embed') return <div className="mx-auto max-w-[560px] p-4">{card}</div>;
  return <div className="mx-auto max-w-[560px] px-4 py-10">{card}</div>;
}

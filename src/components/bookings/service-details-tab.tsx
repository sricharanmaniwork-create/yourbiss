'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveService } from '@/lib/actions/bookings';
import { Button, Card, CardBody, CardFooter, CardHeader, Checkbox, Field, FormStatus, Input, Select, Switch, Textarea, useAction } from '@/components/ui';
import { LOCATION_KINDS, type ServiceDocument } from './types-client';

/**
 * Everything a service is, in one save.
 *
 * The ranges are the ones `booking_services` carries in 0005 — a duration of 5 to 1440
 * minutes, buffers to 240, a horizon to 730 days — so what the screen refuses is exactly
 * what the database would refuse, and the message names the field rather than a
 * constraint. The length-plus-buffers rule is checked here first because the column
 * check would otherwise answer a legal-looking form with an error about a row.
 *
 * `status` is not on this screen. Hiding, showing and archiving are separate decisions
 * with their own policy — archiving is an admin one — and they live on the header
 * buttons so a save cannot quietly change them.
 */
export function ServiceDetailsTab({
  service,
  forms,
  timezones,
  currencies,
  canManage,
  onSaved,
}: {
  service: ServiceDocument;
  forms: { id: string; title: string }[];
  timezones: string[];
  currencies: { code: string; label: string }[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();

  const [name, setName] = useState(service.name);
  const [slug, setSlug] = useState(service.slug);
  const [description, setDescription] = useState(service.description);
  const [duration, setDuration] = useState(String(service.duration_min));
  const [bufferBefore, setBufferBefore] = useState(String(service.buffer_before_min));
  const [bufferAfter, setBufferAfter] = useState(String(service.buffer_after_min));
  const [step, setStep] = useState(String(service.slot_step_min));
  const [lead, setLead] = useState(String(service.min_lead_min));
  const [horizon, setHorizon] = useState(String(service.max_horizon_days));
  const [capped, setCapped] = useState(service.daily_limit !== null);
  const [dailyLimit, setDailyLimit] = useState(String(service.daily_limit ?? 4));
  const [capacity, setCapacity] = useState(String(service.capacity));
  const [price, setPrice] = useState((service.price_cents / 100).toFixed(2));
  const [currency, setCurrency] = useState(service.currency);
  const [location, setLocation] = useState(service.location_kind);
  const [timezone, setTimezone] = useState(service.timezone);
  const [color, setColor] = useState(service.color);
  const [intake, setIntake] = useState(service.intake_form_id ?? '');
  const [sortOrder, setSortOrder] = useState(String(service.sort_order));
  const [heading, setHeading] = useState(service.page_config.heading);
  const [instructions, setInstructions] = useState(service.page_config.instructions);
  const [requirePhone, setRequirePhone] = useState(service.page_config.require_phone);

  const dirty =
    name !== service.name ||
    slug !== service.slug ||
    description !== service.description ||
    duration !== String(service.duration_min) ||
    bufferBefore !== String(service.buffer_before_min) ||
    bufferAfter !== String(service.buffer_after_min) ||
    step !== String(service.slot_step_min) ||
    lead !== String(service.min_lead_min) ||
    horizon !== String(service.max_horizon_days) ||
    capped !== (service.daily_limit !== null) ||
    dailyLimit !== String(service.daily_limit ?? 4) ||
    capacity !== String(service.capacity) ||
    price !== (service.price_cents / 100).toFixed(2) ||
    currency !== service.currency ||
    location !== service.location_kind ||
    timezone !== service.timezone ||
    color !== service.color ||
    intake !== (service.intake_form_id ?? '') ||
    sortOrder !== String(service.sort_order) ||
    heading !== service.page_config.heading ||
    instructions !== service.page_config.instructions ||
    requirePhone !== service.page_config.require_phone;

  const save = () => {
    void run(async () => {
      const result = await saveService(service.id, {
        name,
        slug,
        description,
        duration_min: num(duration),
        buffer_before_min: num(bufferBefore),
        buffer_after_min: num(bufferAfter),
        slot_step_min: num(step),
        min_lead_min: num(lead),
        max_horizon_days: num(horizon),
        daily_limit: capped ? num(dailyLimit) : null,
        capacity: num(capacity),
        price_cents: Math.round(num(price, 0) * 100),
        currency,
        location_kind: location,
        timezone,
        color,
        intake_form_id: intake === '' ? null : intake,
        status: service.status,
        sort_order: num(sortOrder),
        page_config: { heading, instructions, require_phone: requirePhone },
      });
      if (result.ok) {
        onSaved();
        router.refresh();
      }
      return result;
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
      <Card>
        <CardHeader title="What the customer sees" description="The name, the address, and the words on their booking page." />
        <CardBody className="grid gap-4">
          <Field label="Name" htmlFor="svc-name" required error={fieldError('name')}>
            <Input id="svc-name" value={name} maxLength={120} disabled={!canManage} invalid={!!fieldError('name')} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Address" htmlFor="svc-slug" hint="/book/…/<this>" error={fieldError('slug')}>
            <Input id="svc-slug" value={slug} maxLength={60} spellCheck={false} disabled={!canManage} invalid={!!fieldError('slug')} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          </Field>

          <Field label="Description" htmlFor="svc-desc" hint="Optional" error={fieldError('description')}>
            <Textarea id="svc-desc" rows={3} value={description} maxLength={2000} disabled={!canManage} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <Field label="Heading on the booking page" htmlFor="svc-heading" hint="Blank uses the name" error={fieldError('page_config.heading')}>
            <Input id="svc-heading" value={heading} maxLength={120} disabled={!canManage} onChange={(e) => setHeading(e.target.value)} />
          </Field>

          <Field label="Instructions above the calendar" htmlFor="svc-instructions" hint="Optional" error={fieldError('page_config.instructions')}>
            <Textarea id="svc-instructions" rows={2} value={instructions} maxLength={1000} disabled={!canManage} onChange={(e) => setInstructions(e.target.value)} />
          </Field>

          <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
            <span className="text-[12.5px] text-ink-soft">Ask for a phone number as well as an email</span>
            <Switch checked={requirePhone} label="Ask for a phone number" disabled={!canManage} onChange={setRequirePhone} />
          </div>

          <Field label="Colour" htmlFor="svc-color" hint="Used on the calendar chip and the booking page">
            <div className="flex items-center gap-2">
              <input
                id="svc-color"
                type="color"
                value={/^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#2e6be6'}
                disabled={!canManage}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-9 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
                aria-label="Service colour"
              />
              <Input value={color} maxLength={7} disabled={!canManage} invalid={!!fieldError('color')} onChange={(e) => setColor(e.target.value)} className="w-32 font-mono" />
            </div>
          </Field>

          <Field label="Order on the page" htmlFor="svc-sort" hint="Lowest first" error={fieldError('sort_order')}>
            <Input id="svc-sort" type="number" min={0} max={9999} value={sortOrder} disabled={!canManage} invalid={!!fieldError('sort_order')} onChange={(e) => setSortOrder(e.target.value)} className="w-28" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How the time works" description="Every number here is judged again by the database before a slot is offered." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Length (minutes)" htmlFor="svc-duration" required error={fieldError('duration_min')}>
            <Input id="svc-duration" type="number" min={5} max={1440} step={5} value={duration} disabled={!canManage} invalid={!!fieldError('duration_min')} onChange={(e) => setDuration(e.target.value)} />
          </Field>

          <Field label="Offer every (minutes)" htmlFor="svc-step" hint="How often a slot starts" error={fieldError('slot_step_min')}>
            <Input id="svc-step" type="number" min={5} max={120} step={5} value={step} disabled={!canManage} invalid={!!fieldError('slot_step_min')} onChange={(e) => setStep(e.target.value)} />
          </Field>

          <Field label="Buffer before (minutes)" htmlFor="svc-before" error={fieldError('buffer_before_min')}>
            <Input id="svc-before" type="number" min={0} max={240} step={5} value={bufferBefore} disabled={!canManage} invalid={!!fieldError('buffer_before_min')} onChange={(e) => setBufferBefore(e.target.value)} />
          </Field>

          <Field label="Buffer after (minutes)" htmlFor="svc-after" error={fieldError('buffer_after_min')}>
            <Input id="svc-after" type="number" min={0} max={240} step={5} value={bufferAfter} disabled={!canManage} invalid={!!fieldError('buffer_after_min')} onChange={(e) => setBufferAfter(e.target.value)} />
          </Field>

          <Field label="Shortest notice (minutes)" htmlFor="svc-lead" hint="How soon a slot can be taken" error={fieldError('min_lead_min')}>
            <Input id="svc-lead" type="number" min={0} max={43200} step={15} value={lead} disabled={!canManage} invalid={!!fieldError('min_lead_min')} onChange={(e) => setLead(e.target.value)} />
          </Field>

          <Field label="Book ahead (days)" htmlFor="svc-horizon" error={fieldError('max_horizon_days')}>
            <Input id="svc-horizon" type="number" min={1} max={730} value={horizon} disabled={!canManage} invalid={!!fieldError('max_horizon_days')} onChange={(e) => setHorizon(e.target.value)} />
          </Field>

          <Field label="Places at the same time" htmlFor="svc-capacity" hint="More than one serves two customers at once" error={fieldError('capacity')}>
            <Input id="svc-capacity" type="number" min={1} max={32} value={capacity} disabled={!canManage} invalid={!!fieldError('capacity')} onChange={(e) => setCapacity(e.target.value)} />
          </Field>

          <div className="rounded-md border border-line px-3 py-2.5">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
              <Checkbox checked={capped} disabled={!canManage} onChange={(e) => setCapped(e.target.checked)} />
              Limit how many one person can book per day
            </label>
            {capped && (
              <Input
                aria-label="Bookings per day"
                type="number"
                min={1}
                max={64}
                value={dailyLimit}
                disabled={!canManage}
                invalid={!!fieldError('daily_limit')}
                onChange={(e) => setDailyLimit(e.target.value)}
                className="mt-2 w-24"
              />
            )}
          </div>

          <Field label="Price" htmlFor="svc-price" hint="0 is free" error={fieldError('price_cents')}>
            <Input id="svc-price" type="number" min={0} step="0.01" value={price} disabled={!canManage} invalid={!!fieldError('price_cents')} onChange={(e) => setPrice(e.target.value)} />
          </Field>

          <Field label="Currency" htmlFor="svc-currency">
            <Select id="svc-currency" value={currency} disabled={!canManage} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} — {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Where it happens" htmlFor="svc-location">
            <Select id="svc-location" value={location} disabled={!canManage} onChange={(e) => setLocation(e.target.value as typeof location)}>
              {LOCATION_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Time zone" htmlFor="svc-timezone" hint="Unless a person overrides it" error={fieldError('timezone')}>
            <Select id="svc-timezone" value={timezone} disabled={!canManage} invalid={!!fieldError('timezone')} onChange={(e) => setTimezone(e.target.value)}>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Intake form" htmlFor="svc-intake" hint="Linked after the booking, never required" error={fieldError('intake_form_id')}>
            <Select id="svc-intake" value={intake} disabled={!canManage} onChange={(e) => setIntake(e.target.value)}>
              <option value="">None</option>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.title}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>

        <CardFooter>
          <FormState state={state} />
          <Button variant="primary" loading={pending} disabled={!canManage || !dirty} onClick={save}>
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/** `''` and a stray letter both become 0, which the schema then explains by name. */
function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function FormState({ state }: { state: ReturnType<typeof useAction>['state'] }) {
  if (!state || state.ok) return null;
  return (
    <span className="mr-auto max-w-[420px] text-[12px] leading-relaxed text-danger">
      <FormStatus state={state} />
    </span>
  );
}

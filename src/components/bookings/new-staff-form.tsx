'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createStaff } from '@/lib/actions/bookings';
import { Button, Field, FormStatus, Input, Select, useAction } from '@/components/ui';
import { slugify } from '@/lib/utils';

/**
 * A team member starts as a name and the clock they work to.
 *
 * The zone is asked for here rather than left at the column default because it is the
 * one thing a wrong value breaks silently: `available_slots()` builds the grid in the
 * staff row's zone, so a person added with the workspace's zone while they work in
 * another one shows times that are an hour or two out and still books correctly.
 */
export function NewStaffForm({
  orgId,
  timezones,
  defaultTimezone,
}: {
  orgId: string;
  timezones: string[];
  defaultTimezone: string;
}) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [timezone, setTimezone] = useState(timezones.includes(defaultTimezone) ? defaultTimezone : 'Asia/Kolkata');

  const submit = () => {
    void run(async () => {
      const result = await createStaff({ orgId, name, slug: touched ? slug : slugify(name, 'staff'), timezone });
      if (result.ok && result.id) router.push(`/app/bookings/staff/${result.id}`);
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[560px] px-5 py-5">
      <div className="grid gap-4">
        <Field label="Who is it?" htmlFor="staff-name" required error={fieldError('name')}>
          <Input
            id="staff-name"
            autoFocus
            value={name}
            maxLength={80}
            placeholder="Priya Raman"
            invalid={!!fieldError('name')}
            onChange={(event) => {
              setName(event.target.value);
              if (!touched) setSlug(slugify(event.target.value, 'staff'));
            }}
          />
        </Field>

        <Field label="Address" htmlFor="staff-slug" hint="Used in links that name this person">
          <Input
            id="staff-slug"
            value={slug}
            maxLength={60}
            spellCheck={false}
            invalid={!!fieldError('slug')}
            onChange={(event) => {
              setTouched(true);
              setSlug(slugify(event.target.value, 'staff'));
            }}
          />
        </Field>

        <Field
          label="Time zone"
          htmlFor="staff-timezone"
          hint="The clock their working hours are read in"
          error={fieldError('timezone')}
        >
          <Select id="staff-timezone" value={timezone} invalid={!!fieldError('timezone')} onChange={(event) => setTimezone(event.target.value)}>
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>

        <p className="text-[11.5px] leading-relaxed text-muted">
          Nothing is bookable until this person is assigned to a service and given working hours — both on the next
          screen. Their email and phone live in a separate table that only an owner or admin can read, so a booking page
          can never show them.
        </p>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push('/app/bookings/staff')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            Add team member
          </Button>
        </div>
      </div>
    </div>
  );
}

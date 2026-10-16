'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createService } from '@/lib/actions/bookings';
import { Button, Field, FormStatus, Input, useAction } from '@/components/ui';
import { slugify } from '@/lib/utils';

/**
 * A service starts as a name and a duration of an hour, and nothing else.
 *
 * The address is offered but never required: `createService` takes the next free suffix
 * when the wanted one clashes, so two workspaces that both call their appointment
 * "consultation" cannot fail the create. The same function refuses a slug the platform
 * itself uses, which is why the field shows the workspace prefix — the address a
 * customer will type is `/book/<workspace>/<this>`.
 */
export function NewServiceForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const { state, pending, run, fieldError } = useAction();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);

  const submit = () => {
    void run(async () => {
      const result = await createService({ orgId, name, slug: touched ? slug : slugify(name, 'service') });
      if (result.ok && result.id) router.push(`/app/bookings/services/${result.id}`);
      return result;
    });
  };

  return (
    <div className="ui-card max-w-[560px] px-5 py-5">
      <div className="grid gap-4">
        <Field label="What is it called?" htmlFor="service-name" required error={fieldError('name')}>
          <Input
            id="service-name"
            autoFocus
            value={name}
            maxLength={120}
            placeholder="Hair consultation"
            invalid={!!fieldError('name')}
            onChange={(event) => {
              setName(event.target.value);
              if (!touched) setSlug(slugify(event.target.value, 'service'));
            }}
          />
        </Field>

        <Field label="Address" htmlFor="service-slug" hint="Part of the booking link">
          <div className="flex items-center gap-1.5">
            <span className="flex-none text-[12.5px] text-muted">/book/{orgSlug}/</span>
            <Input
              id="service-slug"
              value={slug}
              maxLength={60}
              spellCheck={false}
              invalid={!!fieldError('slug')}
              onChange={(event) => {
                setTouched(true);
                setSlug(slugify(event.target.value, 'service'));
              }}
            />
          </div>
        </Field>

        <p className="text-[11.5px] leading-relaxed text-muted">
          Length, buffers, price and the rest are on the next screen. An hour is what it starts with, and a service is
          not on any booking page until a team member is assigned to it.
        </p>

        <FormStatus state={state} />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push('/app/bookings/services')}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
            Create service
          </Button>
        </div>
      </div>
    </div>
  );
}

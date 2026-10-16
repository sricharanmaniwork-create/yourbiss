'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveStaff, saveStaffContacts, setStaffServices } from '@/lib/actions/bookings';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Field,
  FormStatus,
  Input,
  Select,
  Textarea,
  useAction,
} from '@/components/ui';
import type { AssignedService, StaffDocument } from './types-client';

/**
 * Who this person is, what they offer, and how to reach them.
 *
 * Three separate saves, because three different rules judge them. The profile is a
 * member's own; the services they offer are the pairing the booking page reads; the
 * contact row sits behind `bstaff_contacts_admin` and is not readable by a member at
 * all — so the card that would edit it says who may, instead of showing empty fields that
 * a save would refuse.
 */
export function StaffProfileTab({
  staff,
  services,
  timezones,
  canManage,
  canAdmin,
  onSaved,
}: {
  staff: StaffDocument;
  services: AssignedService[];
  timezones: string[];
  canManage: boolean;
  canAdmin: boolean;
  onSaved: () => void;
}) {
  const router = useRouter();
  const profile = useAction();
  const offering = useAction();
  const contact = useAction();

  const [name, setName] = useState(staff.name);
  const [slug, setSlug] = useState(staff.slug);
  const [bio, setBio] = useState(staff.bio);
  const [avatar, setAvatar] = useState(staff.avatar_url);
  const [timezone, setTimezone] = useState(staff.timezone);
  const [sortOrder, setSortOrder] = useState(String(staff.sort_order));

  const [serviceIds, setServiceIds] = useState<string[]>(staff.service_ids);
  const [email, setEmail] = useState(staff.contacts?.email ?? '');
  const [phone, setPhone] = useState(staff.contacts?.phone ?? '');
  const [notes, setNotes] = useState(staff.contacts?.notes ?? '');

  const profileDirty =
    name !== staff.name ||
    slug !== staff.slug ||
    bio !== staff.bio ||
    avatar !== staff.avatar_url ||
    timezone !== staff.timezone ||
    sortOrder !== String(staff.sort_order);

  const offeringDirty =
    serviceIds.length !== staff.service_ids.length || serviceIds.some((id) => !staff.service_ids.includes(id));

  const contactDirty =
    staff.contacts !== null &&
    (email !== staff.contacts.email || phone !== staff.contacts.phone || notes !== staff.contacts.notes);

  const saveProfile = () => {
    void profile.run(async () => {
      const result = await saveStaff(staff.id, {
        name,
        slug,
        bio,
        avatar_url: avatar,
        timezone,
        status: staff.status,
        sort_order: num(sortOrder),
      });
      if (result.ok) {
        onSaved();
        router.refresh();
      }
      return result;
    });
  };

  const saveOffering = () => {
    void offering.run(async () => {
      const result = await setStaffServices(staff.id, serviceIds);
      if (result.ok) {
        onSaved();
        router.refresh();
      }
      return result;
    });
  };

  const saveContact = () => {
    void contact.run(async () => {
      const result = await saveStaffContacts(staff.id, { email, phone, notes });
      if (result.ok) {
        onSaved();
        router.refresh();
      }
      return result;
    });
  };

  const toggle = (id: string, wanted: boolean) =>
    setServiceIds((current) => (wanted ? [...new Set([...current, id])] : current.filter((value) => value !== id)));

  return (
    <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
      <Card>
        <CardHeader title="Profile" description="What the booking page shows beside their name." />
        <CardBody className="grid gap-4">
          <Field label="Name" htmlFor="staff-name" required error={profile.fieldError('name')}>
            <Input
              id="staff-name"
              value={name}
              maxLength={80}
              disabled={!canManage}
              invalid={!!profile.fieldError('name')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Field label="Address" htmlFor="staff-slug" hint="Used in links that name this person" error={profile.fieldError('slug')}>
            <Input
              id="staff-slug"
              value={slug}
              maxLength={60}
              spellCheck={false}
              disabled={!canManage}
              invalid={!!profile.fieldError('slug')}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
          </Field>

          <Field label="Short bio" htmlFor="staff-bio" hint="Shown under their name on the booking page" error={profile.fieldError('bio')}>
            <Textarea id="staff-bio" rows={3} value={bio} maxLength={1000} disabled={!canManage} onChange={(event) => setBio(event.target.value)} />
          </Field>

          <Field label="Image address" htmlFor="staff-avatar" hint="Optional — https:// only" error={profile.fieldError('avatar_url')}>
            <Input
              id="staff-avatar"
              value={avatar}
              maxLength={500}
              placeholder="https://…"
              spellCheck={false}
              disabled={!canManage}
              invalid={!!profile.fieldError('avatar_url')}
              onChange={(event) => setAvatar(event.target.value)}
            />
          </Field>

          <Field label="Time zone" htmlFor="staff-timezone" hint="Overrides the service’s own clock" error={profile.fieldError('timezone')}>
            <Select id="staff-timezone" value={timezone} disabled={!canManage} invalid={!!profile.fieldError('timezone')} onChange={(event) => setTimezone(event.target.value)}>
              {timezones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Order on the booking page" htmlFor="staff-sort" hint="Lowest first" error={profile.fieldError('sort_order')}>
            <Input
              id="staff-sort"
              type="number"
              min={0}
              max={9999}
              value={sortOrder}
              disabled={!canManage}
              invalid={!!profile.fieldError('sort_order')}
              onChange={(event) => setSortOrder(event.target.value)}
              className="w-28"
            />
          </Field>
        </CardBody>

        <CardFooter>
          <Errors state={profile.state} />
          <Button variant="primary" loading={profile.pending} disabled={!canManage || !profileDirty} onClick={saveProfile}>
            Save profile
          </Button>
        </CardFooter>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Services they offer"
            description="A service with nobody assigned has a live booking page and no times to show."
          />
          <CardBody className="grid gap-1">
            {services.length === 0 ? (
              <p className="rounded-md bg-[#fdf3e0] px-3 py-2.5 text-[12px] leading-relaxed text-[#8a5300]">
                This workspace has no services yet, so there is nothing to assign. Add one from Bookings → Services.
              </p>
            ) : (
              services.map((service) => {
                const checked = serviceIds.includes(service.id);
                return (
                  <label
                    key={service.id}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 ${canManage ? 'cursor-pointer hover:bg-raised' : 'cursor-default'}`}
                  >
                    <Checkbox checked={checked} disabled={!canManage} onChange={(event) => toggle(service.id, event.target.checked)} />
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full"
                      style={{ backgroundColor: service.color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{service.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted">{service.duration_min} min · /{service.slug}</span>
                    </span>
                  </label>
                );
              })
            )}
          </CardBody>

          <CardFooter>
            <Errors state={offering.state} />
            <Button variant="primary" loading={offering.pending} disabled={!canManage || !offeringDirty} onClick={saveOffering}>
              Save assignment
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader title="Contact details" description="Never shown on a booking page — only an owner or admin can read them." />
          <CardBody className="grid gap-4">
            {staff.contacts === null ? (
              <p className="rounded-md border border-line bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-ink-soft">
                {canAdmin
                  ? 'No contact details saved for this person yet.'
                  : 'These fields belong to a table only an owner or admin can read, so nothing shows here. An admin sets them on the same screen.'}
              </p>
            ) : (
              <>
                <Field label="Email" htmlFor="staff-email" hint="Used for nothing but reaching them" error={contact.fieldError('email')}>
                  <Input
                    id="staff-email"
                    type="email"
                    value={email}
                    maxLength={320}
                    disabled={!canAdmin}
                    invalid={!!contact.fieldError('email')}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Field label="Phone" htmlFor="staff-phone" error={contact.fieldError('phone')}>
                  <Input
                    id="staff-phone"
                    value={phone}
                    maxLength={32}
                    placeholder="+91 98450 00000"
                    disabled={!canAdmin}
                    invalid={!!contact.fieldError('phone')}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </Field>
                <Field label="Internal notes" htmlFor="staff-notes" hint="Never sent to a customer" error={contact.fieldError('notes')}>
                  <Textarea id="staff-notes" rows={2} maxLength={1000} value={notes} disabled={!canAdmin} onChange={(event) => setNotes(event.target.value)} />
                </Field>
              </>
            )}
          </CardBody>

          <CardFooter>
            <Errors state={contact.state} />
            <Button
              variant="primary"
              loading={contact.pending}
              disabled={!canAdmin || !contactDirty}
              onClick={saveContact}
            >
              Save contact
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function Errors({ state }: { state: ReturnType<typeof useAction>['state'] }) {
  if (!state || state.ok) return null;
  return (
    <span className="mr-auto max-w-[420px] text-[12px] leading-relaxed text-danger">
      <FormStatus state={state} />
    </span>
  );
}

function num(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

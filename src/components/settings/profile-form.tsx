'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfile } from '@/lib/actions/settings';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { FormStatus } from '@/components/ui/form-status';
import { useAction } from '@/components/ui/use-action';
import { toast } from '@/components/ui/toaster';

export function ProfileForm({
  profile,
}: {
  profile: { display_name: string; email: string; job_title: string; phone: string };
}) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [jobTitle, setJobTitle] = useState(profile.job_title);
  const [phone, setPhone] = useState(profile.phone);
  const { state, pending, run, fieldError } = useAction();
  const router = useRouter();

  const dirty =
    displayName !== profile.display_name || jobTitle !== profile.job_title || phone !== profile.phone;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => updateProfile({ display_name: displayName, job_title: jobTitle, phone }),
          () => {
            toast.success('Profile updated');
            router.refresh();
          },
        );
      }}
    >
      <Field label="Your name" htmlFor="profile-name" error={fieldError('display_name')} required>
        <Input id="profile-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required />
      </Field>

      <Field label="Email" htmlFor="profile-email" hint="sign-in address — managed by your identity provider">
        <Input id="profile-email" value={profile.email} readOnly disabled />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="profile-title" error={fieldError('job_title')} hint="optional">
          <Input id="profile-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={80} placeholder="Clinic manager" />
        </Field>
        <Field label="Phone" htmlFor="profile-phone" error={fieldError('phone')} hint="optional">
          <Input id="profile-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} placeholder="+91 98765 43210" />
        </Field>
      </div>

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
          Save profile
        </Button>
        <div className="flex-1">
          <FormStatus state={state} />
        </div>
      </div>
    </form>
  );
}

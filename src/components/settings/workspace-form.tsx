'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { slugify } from '@/lib/utils';
import { updateWorkspace } from '@/lib/actions/settings';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { FormStatus } from '@/components/ui/form-status';
import { useAction } from '@/components/ui/use-action';
import { toast } from '@/components/ui/toaster';

interface OrgDraft {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  locale: string;
  logo_url: string | null;
}

export function WorkspaceForm({
  org,
  timezones,
  currencies,
  locales,
}: {
  org: OrgDraft;
  timezones: string[];
  currencies: { code: string; label: string }[];
  locales: { code: string; label: string }[];
}) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState(org.timezone);
  const [currency, setCurrency] = useState(org.currency);
  const [locale, setLocale] = useState(org.locale);
  const [logoUrl, setLogoUrl] = useState(org.logo_url ?? '');

  const { state, pending, run, fieldError } = useAction();
  const router = useRouter();

  const dirty =
    name !== org.name ||
    slug !== org.slug ||
    timezone !== org.timezone ||
    currency !== org.currency ||
    locale !== org.locale ||
    logoUrl !== (org.logo_url ?? '');

  const save = () =>
    run(
      () =>
        updateWorkspace({
          orgId: org.id,
          name,
          slug,
          timezone,
          currency,
          locale,
          logo_url: logoUrl.trim(),
        }),
      () => {
        toast.success('Workspace updated');
        router.refresh();
      },
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Workspace name" htmlFor="org-name" error={fieldError('name')} required>
          <Input
            id="org-name"
            value={name}
            maxLength={80}
            required
            // A brand-new workspace keeps up with the name until the owner types
            // their own address; after that the two are independent.
            onChange={(event) => {
              setName(event.target.value);
              if (!slugTouched) setSlug(slugify(event.target.value, org.slug));
            }}
          />
        </Field>

        <Field
          label="Web address"
          htmlFor="org-slug"
          error={fieldError('slug')}
          hint={`/${slug || '…'}`}
          required
        >
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
            }}
            maxLength={60}
            spellCheck={false}
            required
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Time zone" htmlFor="org-tz" error={fieldError('timezone')} required>
          <Select id="org-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {/* Keeps the stored value visible even if this runtime's ICU list
                differs, instead of silently resetting a workspace's zone. */}
            {!timezones.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Currency" htmlFor="org-ccy" error={fieldError('currency')} required>
          <Select id="org-ccy" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {!currencies.some((c) => c.code === currency) && <option value={currency}>{currency}</option>}
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Number format" htmlFor="org-locale" error={fieldError('locale')} required>
          <Select id="org-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {!locales.some((l) => l.code === locale) && <option value={locale}>{locale}</option>}
            {locales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Logo URL"
        htmlFor="org-logo"
        error={fieldError('logo_url')}
        hint="optional — shown in the sidebar and on invoices"
      >
        <Input
          id="org-logo"
          type="url"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://…/logo.png"
          spellCheck={false}
        />
      </Field>

      <div className="flex items-center gap-3 border-t border-line pt-4">
        <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
          Save changes
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setName(org.name);
              setSlugTouched(false);
              setSlug(org.slug);
              setTimezone(org.timezone);
              setCurrency(org.currency);
              setLocale(org.locale);
              setLogoUrl(org.logo_url ?? '');
            }}
          >
            Discard
          </Button>
        )}
        <div className="flex-1">
          <FormStatus state={state} />
        </div>
      </div>
    </form>
  );
}

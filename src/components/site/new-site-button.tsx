'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe } from 'lucide-react';
import { createSite } from '@/lib/actions/sites';
import { Button, Field, Input, Modal } from '@/components/ui';
import { slugify } from '@/lib/utils';

/**
 * A site is created with one empty Home page, which is what the canvas opens on.
 * The address is offered but never required — the action takes the next free
 * suffix if it clashes, so a crowded slug cannot fail the whole create.
 */
export function NewSiteButton({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const finalSlug = touchedSlug ? slug : slugify(name, 'site');
    setError(null);
    startTransition(async () => {
      const result = await createSite({ orgId, name, slug: finalSlug }).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'The site could not be created',
      }));
      if (!result.ok) {
        setError(result.error ?? 'The site could not be created');
        return;
      }
      setOpen(false);
      setName('');
      setSlug('');
      setTouchedSlug(false);
      // Straight into the canvas: an empty site nobody has opened yet is the
      // one place a wizard would only get in the way.
      if (result.id && result.pageId) router.push(`/app/websites/${result.id}/builder/${result.pageId}`);
      else if (result.id) router.push(`/app/websites/${result.id}`);
    });
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Globe size={15} />
        New site
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New site"
        description="It starts as one empty page. Everything else comes from dragging blocks onto the canvas."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={name.trim() === ''} onClick={submit}>
              Create and open the canvas
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Site name" htmlFor="site-name">
            <Input
              id="site-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder="Northwind Studio"
              onChange={(event) => {
                setName(event.target.value);
                if (!touchedSlug) setSlug(slugify(event.target.value, 'site'));
              }}
            />
          </Field>

          <Field label="Address" htmlFor="site-slug" hint="Part of the URL">
            <div className="flex items-center gap-1.5">
              <span className="flex-none text-[12.5px] text-muted">/s/{orgSlug}/</span>
              <Input
                id="site-slug"
                value={slug}
                maxLength={70}
                onChange={(event) => {
                  setTouchedSlug(true);
                  setSlug(slugify(event.target.value, 'site'));
                }}
              />
            </div>
          </Field>

          <p className="text-[11.5px] leading-relaxed text-muted">
            Nothing is visible to a visitor until the site is published from its overview page.
          </p>

          {error && (
            <p role="alert" className="rounded-md bg-[#fcebea] px-3 py-2 text-[12.5px] text-[#a50f0f]">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

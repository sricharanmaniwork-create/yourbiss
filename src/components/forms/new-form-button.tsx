'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileInput } from 'lucide-react';
import { createForm } from '@/lib/actions/forms';
import { Button, Field, Input, Modal } from '@/components/ui';
import { slugify } from '@/lib/utils';

/**
 * A form starts as a title and no fields at all — the builder opens on an empty
 * question list rather than inventing one to fill the screen.
 *
 * The address is offered but never required: `createForm` takes the next free
 * suffix when the wanted one clashes, so a crowded slug cannot fail the create.
 */
export function NewFormButton({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createForm({ orgId, title, slug: touchedSlug ? slug : slugify(title, 'form') }).catch(
        (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'The form could not be created' }),
      );
      if (!result.ok) {
        setError(result.error ?? 'The form could not be created');
        return;
      }
      setOpen(false);
      setTitle('');
      setSlug('');
      setTouchedSlug(false);
      if (result.id) router.push(`/app/forms/${result.id}`);
    });
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <FileInput size={15} />
        New form
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New form"
        description="It opens empty. Add questions from the palette, and nothing a visitor can submit until you publish it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={title.trim() === ''} onClick={submit}>
              Create and add questions
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Form title" htmlFor="form-title" required>
            <Input
              id="form-title"
              autoFocus
              value={title}
              maxLength={140}
              placeholder="Enquiry"
              onChange={(event) => {
                setTitle(event.target.value);
                if (!touchedSlug) setSlug(slugify(event.target.value, 'form'));
              }}
            />
          </Field>

          <Field label="Address" htmlFor="form-slug" hint="Part of the link you share">
            <div className="flex items-center gap-1.5">
              <span className="flex-none text-[12.5px] text-muted">/f/{orgSlug}/</span>
              <Input
                id="form-slug"
                value={slug}
                maxLength={60}
                spellCheck={false}
                onChange={(event) => {
                  setTouchedSlug(true);
                  setSlug(slugify(event.target.value, 'form'));
                }}
              />
            </div>
          </Field>

          <p className="text-[11.5px] leading-relaxed text-muted">
            You can rename it or move it to another address later, from its settings.
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

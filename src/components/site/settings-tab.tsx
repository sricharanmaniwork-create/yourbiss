'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ImageIcon, Trash } from 'lucide-react';
import type { ActionState, Site } from '@/lib/types';
import { archiveSite, updateSite } from '@/lib/actions/sites';
import { Button, Field, FormStatus, Input, Modal, toast } from '@/components/ui';
import { MediaPicker } from '@/components/builder/media-picker';
import { isValidSlug, slugify } from '@/lib/utils';

/**
 * The three things a site row actually holds: what it is called, the address it
 * answers on, and its favicon.
 *
 * Changing the address is the one field to be careful with — the old links stop
 * answering, because the site is served from `/s/{workspace}/{address}` and there
 * is no redirect table to keep the previous one alive.
 */
export function SettingsTab({ site, orgId, orgSlug }: { site: Site; orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [slug, setSlug] = useState(site.slug);
  const [favicon, setFavicon] = useState(site.favicon_url ?? '');
  const [touchedSlug, setTouchedSlug] = useState(true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [state, setState] = useState<ActionState | null>(null);
  const [deleteState, setDeleteState] = useState<ActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const [media, setMedia] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = name !== site.name || slug !== site.slug || favicon !== (site.favicon_url ?? '');
  const badSlug = !isValidSlug(slug);

  const save = () => {
    setState(null);
    setFields({});
    startTransition(async () => {
      const result: ActionState = await updateSite(site.id, { name, slug, favicon_url: favicon }).catch(
        (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'The site could not be saved' }),
      );
      setState(result);
      if (!result.ok) {
        setFields(result.fields ?? {});
        return;
      }
      toast.success('Site settings saved');
      router.refresh();
    });
  };

  const remove = () => {
    setDeleteState(null);
    startTransition(async () => {
      const result: ActionState = await archiveSite(site.id).catch((e: unknown) => ({
        ok: false,
        error: e instanceof Error ? e.message : 'The site could not be deleted',
      }));
      if (!result.ok) {
        setDeleteState(result);
        return;
      }
      router.push('/app/websites');
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ui-card">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Site details</p>
          <p className="text-[12px] text-muted">The name shows in the workspace; the address is what visitors type.</p>
        </header>
        <div className="grid gap-3 px-4 py-4">
          <FormStatus state={state} />

          <Field label="Site name" htmlFor="site-name" error={fields.name} required>
            <Input
              id="site-name"
              value={name}
              maxLength={80}
              invalid={Boolean(fields.name)}
              onChange={(event) => {
                setName(event.target.value);
                if (!touchedSlug) setSlug(slugify(event.target.value, 'site'));
              }}
            />
          </Field>

          <Field
            label="Address"
            htmlFor="site-slug"
            error={fields.slug ?? (slug !== '' && badSlug ? 'Use letters, numbers and single dashes' : undefined)}
            hint={`Visitors open /s/${orgSlug}/${slug || '…'}`}
          >
            <Input
              id="site-slug"
              value={slug}
              maxLength={60}
              spellCheck={false}
              invalid={Boolean(fields.slug) || (slug !== '' && badSlug)}
              onChange={(event) => {
                setTouchedSlug(true);
                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-'));
              }}
            />
          </Field>

          <Field
            label="Favicon"
            htmlFor="site-favicon"
            error={fields.favicon_url}
            hint="A square image, at least 64×64. Leave it empty to use the Yourbiss mark."
          >
            <div className="flex gap-2">
              <Input
                id="site-favicon"
                value={favicon}
                placeholder="https://…"
                spellCheck={false}
                invalid={Boolean(fields.favicon_url)}
                onChange={(event) => setFavicon(event.target.value)}
              />
              <Button variant="secondary" onClick={() => setMedia(true)} title="Choose from the media library" aria-label="Choose a favicon from the media library">
                <ImageIcon size={14} />
              </Button>
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2 pt-1">
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setName(site.name);
                  setSlug(site.slug);
                  setFavicon(site.favicon_url ?? '');
                  setTouchedSlug(true);
                }}
              >
                Discard
              </Button>
            )}
            <Button variant="primary" loading={pending} disabled={!dirty || badSlug || name.trim() === ''} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      </section>

      <section className="ui-card border-[#f0c3bf]">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Delete this site</p>
          <p className="text-[12px] text-muted">Keeps the pages and their versions in the database, out of every list.</p>
        </header>
        <div className="px-4 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            The address <span className="font-mono text-[11.5px]">/s/{orgSlug}/{site.slug}</span> stops answering the
            next time the site is published or revalidated, and the builder closes. Nothing is destroyed: an admin can
            still read the rows, which is why a deleted site cannot be brought back from this screen — ask support to
            set the status back if it was a mistake.
          </p>
          <Button variant="outlineDanger" className="mt-4" disabled={pending} onClick={() => setConfirmDelete(true)}>
            <Trash size={14} />
            Delete site
          </Button>
          <div className="mt-3">
            <FormStatus state={deleteState} />
          </div>
        </div>
      </section>

      <MediaPicker open={media} orgId={orgId} onClose={() => setMedia(false)} onPick={(url) => setFavicon(url)} />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${site.name}”?`}
        description="This takes the whole site out of the workspace, not one page of it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep the site
            </Button>
            <Button variant="danger" loading={pending} onClick={remove}>
              Delete site
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-soft">
          Every page of this site leaves the builder and its published address stops working. Other sites in the
          workspace are untouched.
        </p>
      </Modal>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Check, Upload, X } from 'lucide-react';
import { listImages, uploadImage, type MediaItem } from '@/lib/actions/media';
import { Field, Input, Modal, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The media library for the workspace: the objects in the public `uploads`
 * bucket under the org folder. Listing and uploading both run as the signed-in
 * member, so the storage policies — not this component — decide what they may
 * touch.
 */
export function MediaPicker({
  open,
  orgId,
  onClose,
  onPick,
}: {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onPick: (url: string) => void;
}) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    startTransition(async () => {
      setError(null);
      try {
        setItems(await listImages(orgId));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The library could not be read');
        setItems([]);
      }
    });
  }, [orgId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const pick = (next: string) => {
    onPick(next);
    onClose();
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const result = await uploadImage({ orgId, file });
      if (!result.ok) {
        setError(result.error ?? 'That upload failed');
        return;
      }
      if (result.url) pick(result.url);
      else load();
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Media library"
      description="PNG, JPEG, WebP, GIF or SVG up to 5 MB. Anything you publish here is public."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised disabled:opacity-60"
          >
            {pending ? <Spinner /> : <Upload size={14} />}
            Upload
          </button>
          <button
            type="button"
            onClick={() => pick(url.trim())}
            disabled={url.trim() === ''}
            className="rounded-md bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-dark disabled:opacity-55"
          >
            Use this address
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      }
    >
      {error && <p className="mb-3 rounded-md bg-[#fcebea] px-3 py-2 text-[12.5px] text-[#a50f0f]">{error}</p>}

      <Field label="Or paste an image address" htmlFor="media-url">
        <div className="flex items-center gap-2">
          <Input
            id="media-url"
            value={url}
            placeholder="https://…"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                pick(url.trim());
              }
            }}
          />
          <button
            type="button"
            onClick={() => pick('')}
            title="Clear the image"
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-line-strong text-muted hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      </Field>

      {items === null ? (
        <div className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner />
          Loading the library…
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-line-strong bg-raised px-3 py-6 text-center text-[12.5px] text-muted">
          Nothing uploaded yet. Use the Upload button, or point at an image that already lives somewhere else.
        </p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {items.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => pick(item.url)}
                className={cn(
                  'group relative block w-full overflow-hidden rounded-md border border-line bg-raised hover:border-brand',
                  url === item.url && 'border-brand ring-1 ring-brand',
                )}
                title={item.name}
              >
                {/* Deliberately a plain <img>: this is a user-supplied URL from another origin, not a site asset. */}
                <img src={item.url} alt={item.name} loading="lazy" className="aspect-square w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/45 px-1.5 py-1 text-left text-[10.5px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {item.name}
                </span>
                {url === item.url && (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                    <Check size={12} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

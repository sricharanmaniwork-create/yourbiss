'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertMembership } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import type { ActionState } from '@/lib/types';

/**
 * The media library is the `uploads` bucket, whose objects must live under a
 * folder named after the workspace — that is what `uploads_write_own_org` checks.
 * The org id therefore never comes from the browser: it is read from the
 * caller's session through RLS before a single byte is written.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export interface MediaItem {
  name: string;
  path: string;
  url: string;
  updated_at: string | null;
}

function publicUrl(path: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/uploads/${path}`;
}

/** Only image objects directly in the workspace folder; nothing nested. */
export async function listImages(orgId: string): Promise<MediaItem[]> {
  if (!z.string().uuid().safeParse(orgId).success) return [];

  const supabase = await createClient();
  await assertMembership(supabase, orgId);

  const { data, error } = await supabase.storage
    .from('uploads')
    .list(orgId, { limit: 200, sortBy: { column: 'createdat', order: 'desc' } });
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as { name: string; updated_at: string | null }[])
    .filter((entry) => !entry.name.startsWith('.') && isImageName(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: `${orgId}/${entry.name}`,
      url: publicUrl(`${orgId}/${entry.name}`),
      updated_at: entry.updated_at ?? null,
    }));
}

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

function isImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return Object.values(EXTENSIONS).some((ext) => lower.endsWith(ext) || (ext === '.jpg' && lower.endsWith('.jpeg')));
}

export async function uploadImage(input: { orgId: string; file: File }): Promise<ActionState & { url?: string }> {
  const orgId = z.string().uuid().safeParse(input.orgId);
  if (!orgId.success) return { ok: false, error: 'Unknown workspace' };

  const supabase = await createClient();
  const actor = await assertMembership(supabase, input.orgId).catch(() => null);
  if (!actor) return { ok: false, error: 'You are not a member of this workspace' };

  if (!IMAGE_TYPES.includes(input.file.type)) {
    return { ok: false, error: 'Uploads accept PNG, JPEG, WebP, GIF or SVG' };
  }
  if (input.file.size > MAX_BYTES) {
    return { ok: false, error: 'Images have to be under 5 MB' };
  }

  const extension = input.file.name.includes('.') ? input.file.name.split('.').pop()!.toLowerCase() : 'png';
  const base = input.file.name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const name = `${base || 'image'}-${Date.now().toString(36)}.${extension === 'svg' ? 'svg' : extension}`;

  const { error } = await supabase.storage.from('uploads').upload(`${input.orgId}/${name}`, input.file, {
    contentType: input.file.type,
    cacheControl: '3600',
    upsert: false,
  });

  if (error) return { ok: false, error: error.message };

  return { ok: true, url: publicUrl(`${input.orgId}/${name}`) };
}

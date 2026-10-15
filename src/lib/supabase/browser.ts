'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser client. It talks to PostgREST as the signed-in user, so every read and
 * write is subject to Row Level Security — this client can never reach another
 * workspace's rows, whatever the UI asks for.
 */
export function useSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
  }
  return createBrowserClient(url, key);
}

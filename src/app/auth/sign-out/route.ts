import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/** POST-only: a GET link anywhere on the internet could sign a member out. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    // The cookie is cleared either way so the browser state matches the UI.
    console.error('[auth] signOut', error.message);
  }
  return NextResponse.redirect(new URL('/login', request.url), { status: 302 });
}

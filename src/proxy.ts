import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refreshes the auth cookie on every request and gates the workspace area. Page
 * level data still checks membership itself; this only keeps anonymous traffic
 * out of `/app`.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // getUser() hits the auth server and is the only trustworthy check;
    // getSession() reads a locally-decodable cookie.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { pathname } = request.nextUrl;
    const wantsApp = pathname.startsWith('/app');
    const wantsAuth = pathname === '/login' || pathname === '/signup';

    if (wantsApp && !user) {
      const to = new URL('/login', request.url);
      to.searchParams.set('next', pathname + request.nextUrl.search);
      const redirect = NextResponse.redirect(to);
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith('sb-')) redirect.cookies.delete(cookie.name);
      }
      return redirect;
    }

    if (wantsAuth && user) {
      return NextResponse.redirect(new URL('/app', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ['/app/:path*', '/login', '/signup'],
};

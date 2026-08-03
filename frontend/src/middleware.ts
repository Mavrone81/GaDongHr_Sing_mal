import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// /register = public company signup (Phase 3). /platform = operator console
// (Phase 5), which authenticates with its own localStorage token, not the
// tenant cookie — so the cookie-based guard must not redirect it.
const PUBLIC_PREFIXES = ['/login', '/register', '/onboard', '/auth', '/platform'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('gadonghr_token')?.value;

  const isPublic = PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (token && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)'],
};

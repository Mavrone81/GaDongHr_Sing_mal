import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/onboard', '/auth'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('vorkhive_token')?.value;

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

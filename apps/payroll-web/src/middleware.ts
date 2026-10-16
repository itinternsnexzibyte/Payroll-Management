import { NextResponse, type NextRequest } from 'next/server';

// Fast redirect to /login when there is no session cookie. The API still validates every request.
const COOKIES = ['payroll_session', '__Host-payroll_session'];

export function middleware(req: NextRequest) {
  const hasSession = COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = req.nextUrl.pathname === '/' ? '' : `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!login|signup|api|_next|favicon.ico|icon.svg).*)'] };

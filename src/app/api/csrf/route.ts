import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Primes the session's CSRF cookie. The middleware (which requires a session
 * for this route) issues a fresh token bound to the current session whenever
 * the request's cookie is missing, near expiry, or bound to another session —
 * this handler only has to answer. Used by pages outside the middleware
 * matcher (e.g. /login right after sign-in) before calling an authenticated
 * server action.
 */
export function GET() {
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

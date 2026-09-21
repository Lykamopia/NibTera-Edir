'use client';

import { getCsrfToken } from '@/app/actions/auth';
import { NotAuthenticatedError } from '@/lib/errors';

/**
 * Fetch a fresh CSRF token immediately before submitting a protected action.
 *
 * Always minting a new token (rather than caching one at mount) means a page
 * left open for hours can never submit an expired token, and keeps the cookie
 * and the echoed value in lockstep. Throws {@link NotAuthenticatedError} when
 * the session is gone, which `toUserError` renders as "Session ended".
 */
export async function requestCsrfToken(): Promise<string> {
  const token = await getCsrfToken();
  if (!token) throw new NotAuthenticatedError();
  return token;
}

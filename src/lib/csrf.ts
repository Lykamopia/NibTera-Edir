import { cookies, headers } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import { LogSeverity } from './types';
import { logSecurityEvent, SecurityEvent } from './security-logger';
import { SESSION_COOKIE_NAME } from './session-cookie';
import {
  CSRF_ERROR_MESSAGE,
  CSRF_HEADER_NAME,
  type CsrfValidationResult,
  verifyCsrfToken,
} from './csrf-token';

/**
 * Server-side CSRF enforcement for authenticated state-changing requests.
 *
 * The primary gate is the middleware (src/middleware.ts), which rejects any
 * non-GET request on a matched route without a valid token. This module is the
 * second, independent gate that runs inside the request handler itself:
 *
 *  - `enforceServerActionCsrf` is called by the central session resolvers
 *    (`getLoggedInUser`, `getActor`), so *every* authenticated server action is
 *    checked — including one posted to a path the middleware matcher excludes
 *    (a server action can be invoked by POSTing its id to any route).
 *  - `enforceRouteCsrf` does the same for authenticated API route handlers.
 *
 * Token format, binding and rotation are described in src/lib/csrf-token.ts.
 */

export { CSRF_ERROR_MESSAGE };

export class CsrfValidationError extends Error {
  constructor() {
    super(CSRF_ERROR_MESSAGE);
    this.name = 'CsrfValidationError';
  }
}

/**
 * Cheap layer in front of the token: reject requests the browser itself labels
 * cross-site, or whose `Origin` doesn't match the served host. A missing
 * `Origin` is not fatal on its own — the token remains the control.
 */
function checkRequestOrigin(headerList: Headers): CsrfValidationResult | null {
  // 'none' = user-initiated (address bar/bookmark); 'same-origin' = our own page.
  // 'same-site' (sibling subdomain) and 'cross-site' are both rejected.
  const fetchSite = headerList.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { valid: false, reason: `request labelled '${fetchSite}' by the browser` };
  }

  const origin = headerList.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return { valid: false, reason: 'unparseable Origin header' };
    }
    // Behind a reverse proxy the internal Host differs from the public host, so
    // a match against the proxy-forwarded host is accepted too.
    const forwardedHost = (headerList.get('x-forwarded-host') || '').split(',')[0].trim();
    const allowedHosts = [headerList.get('host'), forwardedHost].filter(Boolean).map((h) => h!.toLowerCase());
    if (allowedHosts.length > 0 && !allowedHosts.includes(originHost.toLowerCase())) {
      return { valid: false, reason: `Origin '${originHost}' does not match host '${allowedHosts.join("' / '")}'` };
    }
  }
  return null;
}

/** The session's CSRF binding, read from the encrypted NextAuth JWT (never exposed to the client). */
async function currentCsrfSid(): Promise<unknown> {
  const token = await getToken({
    req: { cookies: await cookies(), headers: {} } as any,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: SESSION_COOKIE_NAME,
  });
  return token?.csrfSid;
}

async function validateCurrentRequest(headerList: Headers): Promise<CsrfValidationResult> {
  return checkRequestOrigin(headerList)
    ?? verifyCsrfToken(headerList.get(CSRF_HEADER_NAME), await currentCsrfSid());
}

async function reject(actor: { id: string; name?: string | null }, what: string, reason: string): Promise<never> {
  await logSecurityEvent({
    event: SecurityEvent.CSRF_VALIDATION_FAILURE,
    severity: LogSeverity.CRITICAL,
    actor: { id: actor.id, name: actor.name ?? actor.id },
    details: `CSRF validation failed for ${what} by '${actor.name ?? actor.id}' (ID: ${actor.id}): ${reason}.`,
    targetId: actor.id,
    targetType: 'User',
  });
  throw new CsrfValidationError();
}

/**
 * If the current request is a server-action invocation (they are always POSTs
 * and carry a `Next-Action` header), require a valid CSRF token bound to the
 * caller's session. A no-op during normal page rendering.
 */
export async function enforceServerActionCsrf(actor: { id: string; name?: string | null }): Promise<void> {
  const headerList = await headers();
  const actionId = headerList.get('next-action');
  if (!actionId) return;

  const result = await validateCurrentRequest(headerList);
  if (!result.valid) await reject(actor, `server action ${actionId}`, result.reason);
}

/** Require a valid, session-bound CSRF token on an authenticated state-changing API route request. */
export async function enforceRouteCsrf(req: Request, actor: { id: string; name?: string | null }): Promise<void> {
  const result = await validateCurrentRequest(req.headers);
  if (!result.valid) await reject(actor, `${req.method} ${new URL(req.url).pathname}`, result.reason);
}

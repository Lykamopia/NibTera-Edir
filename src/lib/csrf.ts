import crypto from 'crypto';
import { cookies, headers } from 'next/headers';

/**
 * CSRF protection for state-changing server actions (currently the
 * password-change endpoints).
 *
 * Model: **signed, session-bound double-submit cookie**.
 *
 *  1. `issueCsrfToken(subject)` mints `<nonce>.<expiry>.<hmac>`, stores it in an
 *     httpOnly + SameSite=Strict cookie AND returns the raw value to the caller.
 *     The raw token reaches the browser only through the server-action response
 *     body — a cross-site attacker can neither read that body (CORS) nor read
 *     the cookie (httpOnly), so the pair cannot be obtained off-site.
 *  2. The client echoes the token back as an explicit argument to the
 *     state-changing action.
 *  3. `validateCsrfToken(submitted, subject)` requires the cookie and the
 *     submitted value to be present, byte-identical, correctly signed with the
 *     server secret, unexpired, and bound to the *current* user — so a token
 *     minted for another session is useless.
 *
 * The HMAC binds the token to the signed-in user id, so the cookie cannot be
 * transplanted between sessions, and the `Origin`/`Sec-Fetch-Site` check below
 * rejects obvious cross-site callers before the token is even considered.
 */

const nextAuthUrl = (process.env.NEXTAUTH_URL || '').trim();
const usesHttps = nextAuthUrl.toLowerCase().startsWith('https://');

/**
 * `__Host-` requires Secure + Path=/ + no Domain, which pins the cookie to this
 * exact origin (a sibling/compromised subdomain cannot overwrite it). Over plain
 * HTTP (local dev) the prefix is not allowed, so the bare name is used.
 */
export const CSRF_COOKIE_NAME = usesHttps ? '__Host-csrf-token' : 'csrf-token';

/** Matches the absolute session cap in `authOptions` (8h). */
const CSRF_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/** Single user-facing message — never leaks *why* validation failed. */
export const CSRF_ERROR_MESSAGE =
  'Your security token is missing or no longer valid. Please refresh the page and try again.';

export type CsrfValidationResult = { valid: true } | { valid: false; reason: string };

function csrfSecret(): string {
  const secret = process.env.CSRF_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('CSRF secret is not configured. Set CSRF_SECRET or NEXTAUTH_SECRET.');
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', csrfSecret()).update(payload).digest('base64url');
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still burn a comparison so the failure isn't distinguishable by timing.
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * Additional (cheap) layer in front of the token: reject requests the browser
 * itself labels cross-site, or whose `Origin` doesn't match the served host.
 * A missing `Origin` is not fatal on its own — the token remains the control.
 */
async function checkRequestOrigin(): Promise<CsrfValidationResult> {
  const headerList = await headers();

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
    const host = headerList.get('x-forwarded-host') || headerList.get('host');
    if (host && originHost.toLowerCase() !== host.toLowerCase()) {
      return { valid: false, reason: `Origin '${originHost}' does not match host '${host}'` };
    }
  }

  return { valid: true };
}

/**
 * Mint a fresh CSRF token for `subject` (the signed-in user id), store it in the
 * hardened cookie and return the raw value for the client to echo back.
 */
export async function issueCsrfToken(subject: string): Promise<string> {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + CSRF_TOKEN_TTL_MS;
  const token = `${nonce}.${expiresAt}.${sign(`${nonce}.${expiresAt}.${subject}`)}`;

  (await cookies()).set(CSRF_COOKIE_NAME, token, {
    httpOnly: true,       // the raw value travels in the action response, never via document.cookie
    sameSite: 'strict',   // a cross-site request carries no CSRF cookie at all
    secure: usesHttps,
    path: '/',
    maxAge: Math.floor(CSRF_TOKEN_TTL_MS / 1000),
  });

  return token;
}

/**
 * Validate a submitted CSRF token against the cookie and `subject`. Returns a
 * reason suitable for the security log — never surface it to the client.
 */
export async function validateCsrfToken(submitted: unknown, subject: string): Promise<CsrfValidationResult> {
  const originCheck = await checkRequestOrigin();
  if (!originCheck.valid) return originCheck;

  if (typeof submitted !== 'string' || submitted.length === 0) {
    return { valid: false, reason: 'no CSRF token supplied with the request' };
  }

  const cookieToken = (await cookies()).get(CSRF_COOKIE_NAME)?.value;
  if (!cookieToken) {
    return { valid: false, reason: 'CSRF cookie missing from the request' };
  }

  if (!safeEqual(submitted, cookieToken)) {
    return { valid: false, reason: 'submitted CSRF token does not match the CSRF cookie' };
  }

  const parts = submitted.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed CSRF token' };
  }
  const [nonce, expiry, signature] = parts;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt)) {
    return { valid: false, reason: 'malformed CSRF token expiry' };
  }

  if (!safeEqual(signature, sign(`${nonce}.${expiry}.${subject}`))) {
    // Bad signature, or a token minted for a different user/session.
    return { valid: false, reason: 'invalid CSRF token signature or session binding' };
  }

  if (Date.now() > expiresAt) {
    return { valid: false, reason: 'CSRF token expired' };
  }

  return { valid: true };
}

/** Drop the CSRF cookie (e.g. right after a successful password change). */
export async function clearCsrfToken(): Promise<void> {
  (await cookies()).set(CSRF_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: usesHttps,
    path: '/',
    maxAge: 0,
  });
}

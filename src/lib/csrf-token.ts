/**
 * Session-bound CSRF tokens — the primitives shared by the edge middleware and
 * the Node server-action guard (src/lib/csrf.ts). Uses only Web Crypto so it
 * runs in both runtimes.
 *
 * Model: **HMAC-signed, session-bound token** (OWASP "signed double submit").
 *
 *  - Every authenticated session carries a random `csrfSid` inside its
 *    encrypted, httpOnly NextAuth JWT. It is minted at sign-in and rotated
 *    whenever the session changes (see the `jwt` callback in src/lib/auth.ts).
 *  - A token is `<expiresAt>.<nonce>.<hmac>` where
 *    `hmac = HMAC-SHA256(serverSecret, "csrf.v1.<csrfSid>.<expiresAt>.<nonce>")`.
 *    The 32-byte random nonce makes every token unique and unpredictable; the
 *    HMAC makes it unforgeable without the server secret and binds it to exactly
 *    one session, so a token minted for another session (or a stale one from
 *    before a rotation) never validates.
 *  - Middleware hands the token to our own pages in a SameSite=Strict cookie;
 *    the client echoes it in the `x-csrf-token` header on every state-changing
 *    request (src/lib/csrf-client.ts), and the server verifies it.
 */

export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Set on a 403 caused by CSRF validation, so the client knows a retry with the refreshed cookie is safe. */
export const CSRF_REJECTED_HEADER = 'x-csrf-rejected';

const usesHttps = (process.env.NEXTAUTH_URL || '').trim().toLowerCase().startsWith('https://');

/**
 * `__Host-` requires Secure + Path=/ + no Domain, which pins the cookie to this
 * exact origin (a sibling/compromised subdomain cannot overwrite it). Over plain
 * HTTP (local dev) the prefix is not allowed, so the bare name is used.
 */
export const CSRF_COOKIE_NAME = usesHttps ? '__Host-csrf-token' : 'csrf-token';

/**
 * Both possible names, for the browser: NEXTAUTH_URL is server-only, so client
 * code cannot know which one the server chose.
 */
export const CSRF_COOKIE_NAMES = ['__Host-csrf-token', 'csrf-token'] as const;

/** A token is valid for 2h; middleware re-issues it once less than 30 min remain. */
export const CSRF_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const CSRF_REFRESH_WINDOW_MS = 30 * 60 * 1000;

/** Single user-facing message — never leaks *why* validation failed. */
export const CSRF_ERROR_MESSAGE =
  'Your security token is missing or no longer valid. Please refresh the page and try again.';

export type CsrfValidationResult =
  | { valid: true; expiresAt: number }
  | { valid: false; reason: string };

/**
 * Cookie options for the token. Deliberately NOT httpOnly: our own page script
 * must read it to echo it in the request header. A cross-site page can neither
 * read it (same-origin policy) nor cause it to be sent (SameSite=Strict), and
 * it is useless without the session it is bound to.
 */
export const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: 'strict' as const,
  secure: usesHttps,
  path: '/',
  maxAge: Math.floor(CSRF_TOKEN_TTL_MS / 1000),
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Anything other than GET/HEAD/OPTIONS may change state and must carry a token. */
export function isStateChangingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Fresh per-session binding secret, stored only inside the encrypted session JWT. */
export function newCsrfSessionId(): string {
  return randomBase64Url(32);
}

let keyPromise: Promise<CryptoKey> | null = null;

function hmacKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env.CSRF_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error('CSRF secret is not configured. Set CSRF_SECRET or NEXTAUTH_SECRET.');
    }
    keyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }
  return keyPromise;
}

function signingInput(csrfSid: string, expiresAt: string, nonce: string): Uint8Array {
  return new TextEncoder().encode(`csrf.v1.${csrfSid}.${expiresAt}.${nonce}`);
}

/** Mint a new, unique token bound to `csrfSid`. */
export async function mintCsrfToken(csrfSid: string, now: number = Date.now()): Promise<string> {
  const expiresAt = String(now + CSRF_TOKEN_TTL_MS);
  const nonce = randomBase64Url(32);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), signingInput(csrfSid, expiresAt, nonce));
  return `${expiresAt}.${nonce}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify `token` against the session's `csrfSid`. The returned reason is for
 * the security log only — never surface it to the client.
 */
export async function verifyCsrfToken(
  token: unknown,
  csrfSid: unknown,
  now: number = Date.now(),
): Promise<CsrfValidationResult> {
  if (typeof csrfSid !== 'string' || csrfSid.length === 0) {
    return { valid: false, reason: 'session has no CSRF binding' };
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { valid: false, reason: 'no CSRF token supplied with the request' };
  }
  if (token.length > 512) {
    return { valid: false, reason: 'malformed CSRF token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed CSRF token' };
  }
  const [expiry, nonce, signature] = parts;
  const expiresAt = Number(expiry);
  const signatureBytes = fromBase64Url(signature);
  if (!/^\d+$/.test(expiry) || !Number.isSafeInteger(expiresAt) || !nonce || !signatureBytes) {
    return { valid: false, reason: 'malformed CSRF token' };
  }

  // crypto.subtle.verify compares in constant time.
  const authentic = await crypto.subtle.verify('HMAC', await hmacKey(), signatureBytes, signingInput(csrfSid, expiry, nonce));
  if (!authentic) {
    // Forged, tampered, or minted for a different (or rotated-out) session.
    return { valid: false, reason: 'CSRF token signature invalid or bound to another session' };
  }

  if (now >= expiresAt) {
    return { valid: false, reason: 'CSRF token expired' };
  }
  // A token claiming to outlive the TTL was not minted by this code.
  if (expiresAt - now > CSRF_TOKEN_TTL_MS) {
    return { valid: false, reason: 'CSRF token expiry out of range' };
  }

  return { valid: true, expiresAt };
}

/** True when the cookie's token should be replaced (missing, invalid, or close to expiry). */
export function csrfTokenNeedsRefresh(result: CsrfValidationResult, now: number = Date.now()): boolean {
  return !result.valid || result.expiresAt - now < CSRF_REFRESH_WINDOW_MS;
}

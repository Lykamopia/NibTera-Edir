/**
 * Returns the configured application base URL — the canonical host for every
 * server-built link (email reset/invite buttons, deep links, redirects).
 *
 * Resolution order (server-side):
 *   1. BASE_URL          — explicitly set application URL (preferred)
 *   2. NEXT_PUBLIC_APP_URL — the public app URL (used elsewhere for the client)
 *   3. NEXTAUTH_URL      — NextAuth configuration URL
 *   4. http://localhost:3010 — last-resort development fallback
 *
 * Trailing slashes are stripped so callers can always append paths with "/".
 * Set BASE_URL in your .env / .env.production so email links point to the
 * correct host in every environment.
 */
export function getBaseUrl(): string {
  const raw =
    process.env.BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3010';
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Client-safe base URL for browser-side redirects (e.g. sign-out).
 *
 * Uses the build-time NEXT_PUBLIC_APP_URL (the only base URL exposed to the
 * client), falling back to the current window origin when it isn't configured.
 * Trailing slashes are stripped.
 */
export function getClientBaseUrl(): string {
  const configured = process.env.BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

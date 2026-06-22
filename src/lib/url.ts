/**
 * Returns the configured application base URL.
 *
 * Resolution order (server-side):
 *   1. BASE_URL  — explicitly set application URL (preferred)
 *   2. NEXTAUTH_URL — NextAuth configuration URL (fallback)
 *   3. http://localhost:3010 — hard-coded development fallback
 *
 * Trailing slashes are stripped so callers can always append paths with "/".
 *
 * Set BASE_URL in your .env / .env.production to ensure emails, redirects,
 * and deep links point to the correct host in every environment.
 */
export function getBaseUrl(): string {
  const raw =
    process.env.BASE_URL ||
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

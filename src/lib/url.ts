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

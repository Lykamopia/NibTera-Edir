/**
 * Resolve where to send the user after a successful portal connect. Prefer an
 * explicit handoff path, then the last-searched path, else null (default /pay).
 * Only same-origin dashboard/pay paths are allowed.
 */
export function resolvePayResumePath(handoff?: string | null, lastSearched?: string | null): string | null {
  const candidate = (handoff || lastSearched || '').trim();
  if (!candidate.startsWith('/')) return null;
  if (candidate.startsWith('//')) return null; // protocol-relative
  if (candidate.startsWith('/pay')) return candidate;
  return null;
}

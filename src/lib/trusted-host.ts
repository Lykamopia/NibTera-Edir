/**
 * Trusted application origin + Host / X-Forwarded-Host allowlist.
 *
 * The Host and X-Forwarded-Host request headers are attacker-controlled. Any
 * absolute URL built from them (redirects, rewrites, email links) can be
 * poisoned to point at a foreign domain. This module is the single source of
 * truth for which hosts the app answers to, and for the canonical origin used
 * to build absolute URLs. Edge-runtime safe (no Node imports) so the
 * middleware can use it.
 *
 * Allowed hosts =
 *   - the hosts of BASE_URL, NEXTAUTH_URL, NEXT_PUBLIC_APP_URL, NIB_CALLBACK_URL
 *   - ALLOWED_HOSTS (optional, comma/space-separated, e.g. "edir.nib.com.et:443 10.0.0.5:3020")
 *   - loopback (localhost / 127.0.0.1 / [::1], any port) — used by the internal
 *     cron service and health checks; a redirect to loopback cannot reach
 *     another user.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}

let cachedHosts: Set<string> | null = null;

function configuredHosts(): Set<string> {
  if (cachedHosts) return cachedHosts;
  const hosts = new Set<string>();
  for (const url of [process.env.BASE_URL, process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.NIB_CALLBACK_URL]) {
    const h = hostOf(url);
    if (h) hosts.add(h);
  }
  for (const h of (process.env.ALLOWED_HOSTS || '').split(/[\s,]+/)) {
    if (h) hosts.add(h.trim().toLowerCase());
  }
  cachedHosts = hosts;
  return hosts;
}

/** Hostname without port, handling bracketed IPv6. */
function hostnameOnly(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

/** True when `host` (a Host / X-Forwarded-Host value, may include a port) is one the app serves. */
export function isTrustedHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  // Reject anything that isn't a bare host[:port] (userinfo, paths, spaces, etc.).
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/.test(h)) return false;
  if (LOOPBACK.has(hostnameOnly(h))) return true;
  const allowed = configuredHosts();
  if (allowed.has(h)) return true;
  // Default ports are often omitted/added by proxies: "host" ≡ "host:443" ≡ "host:80".
  const bare = hostnameOnly(h);
  return allowed.has(bare) || allowed.has(`${bare}:443`) || allowed.has(`${bare}:80`);
}

/**
 * Validates the request's Host and (if present) X-Forwarded-Host headers.
 * Returns a reason string when the request must be rejected, otherwise null.
 */
export function untrustedHostReason(headers: Headers): string | null {
  const host = headers.get('host');
  if (!isTrustedHost(host)) return `untrusted Host '${host ?? ''}'`;
  const forwarded = headers.get('x-forwarded-host');
  if (forwarded) {
    for (const h of forwarded.split(',')) {
      if (!isTrustedHost(h)) return `untrusted X-Forwarded-Host '${h.trim()}'`;
    }
  }
  return null;
}

/**
 * The canonical, configured application origin (never derived from request
 * headers). Use this — not request.url / Host — to build absolute redirects.
 */
export function trustedOrigin(): string {
  const raw = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3020';
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return 'http://localhost:3020';
  }
}

/**
 * Builds an absolute same-origin URL for a server-side redirect. Only
 * app-relative paths are accepted ("/x", never "//evil" or "https://evil");
 * anything else falls back to `fallback`.
 */
export function safeRedirectUrl(path: string | null | undefined, fallback = '/'): URL {
  const origin = trustedOrigin();
  const candidate = (path || '').trim();
  const isRelative = candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/\\');
  const url = new URL(isRelative ? candidate : fallback, origin);
  // Belt-and-braces: the resolved URL must still be on the trusted origin.
  return url.origin === origin ? url : new URL(fallback, origin);
}

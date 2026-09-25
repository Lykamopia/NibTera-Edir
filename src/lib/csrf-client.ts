'use client';

import {
  CSRF_COOKIE_NAMES,
  CSRF_HEADER_NAME,
  CSRF_REJECTED_HEADER,
  isStateChangingMethod,
} from '@/lib/csrf-token';

/**
 * Client half of the CSRF protection (server half: src/middleware.ts and
 * src/lib/csrf.ts).
 *
 * Wraps `window.fetch` so every same-origin state-changing request — server
 * actions (which Next.js sends through fetch) and API calls like /api/upload —
 * carries the session's current CSRF token in the `x-csrf-token` header. The
 * token is read from the cookie at send time, so a token rotated by the server
 * (new sign-in, session update, expiry) is picked up automatically.
 *
 * If the server refuses a request *because of* CSRF (403 + x-csrf-rejected),
 * the request never reached a handler, and the refusal carries a freshly
 * minted cookie — so it is retried exactly once with the new token.
 */

function readCsrfCookie(): string | null {
  const cookies = new Map<string, string>();
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  for (const name of CSRF_COOKIE_NAMES) {
    const value = cookies.get(name);
    if (value) return decodeURIComponent(value);
  }
  return null;
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Obtain a CSRF token for the current session from a page the middleware does
 * not cover (e.g. /login right after sign-in, where any cookie left over is
 * bound to the previous session).
 */
export async function primeCsrfToken(): Promise<void> {
  await fetch('/api/csrf', { cache: 'no-store', credentials: 'same-origin' });
}

let installed = false;

export function installCsrfFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (!isStateChangingMethod(method) || !isSameOrigin(url)) {
      return nativeFetch(input, init);
    }

    // A Request body can only be read once; clone it so the retry can reuse it.
    const retryInput = input instanceof Request ? input.clone() : input;

    const send = (target: RequestInfo | URL) => {
      const headers = new Headers(init?.headers ?? (target instanceof Request ? target.headers : undefined));
      const token = readCsrfCookie();
      if (token) headers.set(CSRF_HEADER_NAME, token);
      return nativeFetch(target, { ...init, headers });
    };

    const response = await send(input);
    if (response.status === 403 && response.headers.get(CSRF_REJECTED_HEADER)) {
      return send(retryInput);
    }
    return response;
  };
}

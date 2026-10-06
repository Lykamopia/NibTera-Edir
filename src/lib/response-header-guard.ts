import http from 'node:http';

/**
 * VA-004 (Server Information Exposure) — strip headers that identify the
 * server software from EVERY response the Node process sends.
 *
 * `poweredByHeader: false` and the proxy only cover what they see; Next.js also
 * writes headers after the proxy has run (static files, cached/prerendered
 * pages, API routes, error pages). Hooking `http.ServerResponse` catches all of
 * them, whatever code path set them.
 *
 * Only headers the browser does not need are removed. The `x-nextjs-*` headers
 * the client router reads (stale-time, prerender, rewritten-path, …) carry no
 * version and are left alone — removing them breaks client navigation.
 *
 * A reverse proxy / load balancer in front of the app adds its own `Server`
 * header; that has to be switched off in its config (see docs/SECURITY_HARDENING.md).
 */
const STRIPPED = new Set([
  'server',
  'x-powered-by',
  'x-aspnet-version',
  'x-runtime',
  'x-nextjs-cache',
  'x-nextjs-matched-path',
  'x-nextjs-deployment-id',
]);

const INSTALLED = Symbol.for('nibtera.responseHeaderGuard');

const isStripped = (name: unknown) => typeof name === 'string' && STRIPPED.has(name.toLowerCase());

/** Remove stripped names from a writeHead() headers argument (object or flat array). */
function filterHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    // Either [[name, value], ...] or a flat [name, value, name, value, ...].
    if (headers.length > 0 && Array.isArray(headers[0])) {
      return headers.filter((pair) => !isStripped((pair as unknown[])[0]));
    }
    const out: unknown[] = [];
    for (let i = 0; i < headers.length; i += 2) {
      if (!isStripped(headers[i])) out.push(headers[i], headers[i + 1]);
    }
    return out;
  }
  if (headers && typeof headers === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (!isStripped(k)) out[k] = v;
    }
    return out;
  }
  return headers;
}

export function installResponseHeaderGuard() {
  // Patched in place, so typed loosely as a bag of methods.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = http.ServerResponse.prototype as unknown as Record<string | symbol, any>;
  if (proto[INSTALLED]) return;

  const setHeader = proto.setHeader;
  proto.setHeader = function (name: string, value: unknown) {
    if (isStripped(name)) return this;
    return setHeader.call(this, name, value);
  };

  const appendHeader = proto.appendHeader;
  if (typeof appendHeader === 'function') {
    proto.appendHeader = function (name: string, value: unknown) {
      if (isStripped(name)) return this;
      return appendHeader.call(this, name, value);
    };
  }

  const writeHead = proto.writeHead;
  proto.writeHead = function (statusCode: number, ...rest: unknown[]) {
    // Anything that slipped in before the guard was installed.
    for (const name of STRIPPED) {
      if (this.hasHeader?.(name)) this.removeHeader(name);
    }
    // writeHead(status, headers) or writeHead(status, statusMessage, headers)
    const idx = typeof rest[0] === 'string' ? 1 : 0;
    if (rest[idx] !== undefined) rest[idx] = filterHeaders(rest[idx]);
    return writeHead.call(this, statusCode, ...rest);
  };

  proto[INSTALLED] = true;
}

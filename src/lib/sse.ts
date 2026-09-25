/**
 * Shared hardening for the app's real-time channels.
 *
 * The app streams to the browser with Server-Sent Events only; it exposes no
 * WebSocket endpoints and accepts no client→server messages on these channels.
 * These helpers enforce that protocol strictly:
 *
 *  - `rejectInvalidSseRequest`: only a plain `GET` from an EventSource
 *    (`Accept: text/event-stream`), no body, no protocol-upgrade attempt, and a
 *    bounded URL — anything else is refused before any work is done.
 *  - `sseFrame`: every outgoing frame is serialised through JSON (no raw CR/LF
 *    can split a frame), the event name is allow-listed, and frames over
 *    `SSE_MAX_FRAME_BYTES` are refused rather than sent.
 *  - `ConnectionLimiter`: caps concurrent streams per caller and in total, so
 *    held-open connections can't exhaust the server.
 */

/** Largest single SSE frame the server will emit. */
export const SSE_MAX_FRAME_BYTES = 32 * 1024;
/** Longest request URL (path + query) accepted on a stream endpoint. */
export const SSE_MAX_URL_LENGTH = 2048;

export const SSE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-Content-Type-Options': 'nosniff',
};

const EVENT_NAME = /^[a-z][a-z_]{0,31}$/;
const encoder = new TextEncoder();

function plain(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/**
 * Strict protocol validation for a stream request. Returns an error Response to
 * send back, or null if the request is a well-formed EventSource subscription.
 */
export function rejectInvalidSseRequest(req: Request): Response | null {
  if (req.method !== 'GET') return plain(405, 'Method not allowed', { Allow: 'GET' });

  // No WebSocket (or any other) protocol switch is supported on this endpoint.
  const upgrade = req.headers.get('upgrade');
  const connection = (req.headers.get('connection') || '').toLowerCase();
  if (upgrade || connection.split(',').some((t) => t.trim() === 'upgrade') || req.headers.has('sec-websocket-key')) {
    return plain(400, 'Protocol upgrade not supported');
  }

  if (req.url.length > SSE_MAX_URL_LENGTH) return plain(414, 'Request URI too long');

  // A subscription carries no body.
  const length = req.headers.get('content-length');
  if ((length && length !== '0') || req.headers.has('transfer-encoding')) {
    return plain(400, 'Request body not allowed');
  }

  const accept = (req.headers.get('accept') || '').toLowerCase();
  if (!accept.includes('text/event-stream')) return plain(406, 'This endpoint only serves text/event-stream');

  return null;
}

/**
 * Encode one SSE frame. Returns null (and the caller must not send anything) if
 * the event name is not allow-listed or the frame would exceed the size cap.
 */
export function sseFrame(event: string | null, data: unknown): Uint8Array | null {
  if (event !== null && !EVENT_NAME.test(event)) return null;
  // JSON.stringify escapes CR/LF inside strings, so data can never inject
  // extra SSE fields or split into additional frames.
  const json = JSON.stringify(data);
  if (json === undefined) return null;
  const bytes = encoder.encode(`${event ? `event: ${event}\n` : ''}data: ${json}\n\n`);
  return bytes.byteLength > SSE_MAX_FRAME_BYTES ? null : bytes;
}

/** Truncate a free-text field for streaming so one record can't blow the frame budget. */
export function clampText<T extends string | null | undefined>(value: T, max: number): T {
  if (typeof value !== 'string' || value.length <= max) return value;
  return (value.slice(0, max - 1) + '…') as T;
}

/**
 * In-process cap on concurrent streams, per key (user id / client IP) and in
 * total. `acquire` returns a release function, or null when a limit is hit.
 */
export class ConnectionLimiter {
  private perKey = new Map<string, number>();
  private total = 0;

  constructor(private readonly maxPerKey: number, private readonly maxTotal: number) {}

  acquire(key: string): (() => void) | null {
    const current = this.perKey.get(key) ?? 0;
    if (current >= this.maxPerKey || this.total >= this.maxTotal) return null;
    this.perKey.set(key, current + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const n = (this.perKey.get(key) ?? 1) - 1;
      if (n <= 0) this.perKey.delete(key);
      else this.perKey.set(key, n);
    };
  }
}

/** First hop of X-Forwarded-For (bounded), for per-client limits on public streams. */
export function clientKey(req: Request): string {
  const raw = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
  return raw.split(',')[0].trim().slice(0, 64) || 'unknown';
}

export function tooManyStreams(): Response {
  return plain(429, 'Too many open streams', { 'Retry-After': '30' });
}

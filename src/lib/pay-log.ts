/**
 * Always-on, structured logger for the mini-app payment flow. Used on both the
 * server (terminal) and client (browser console) so every step of the NIB
 * payment can be traced end-to-end while debugging. Tokens are masked.
 */

export function maskToken(t?: string | null): string {
  if (!t) return String(t);
  return t.length > 14 ? `${t.slice(0, 8)}…${t.slice(-4)} (len ${t.length})` : `(len ${t.length})`;
}

export function payLog(scope: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const prefix = `[MiniApp Pay] ${ts} [${scope}]`;
  try {
    if (data !== undefined) console.log(prefix, message, data);
    else console.log(prefix, message);
  } catch {
    console.log(prefix, message);
  }
}

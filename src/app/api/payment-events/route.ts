import { NextRequest } from 'next/server';
import { getPendingPaymentStatus } from '@/lib/payment-status';
import {
  ConnectionLimiter,
  SSE_RESPONSE_HEADERS,
  clientKey,
  rejectInvalidSseRequest,
  sseFrame,
  tooManyStreams,
} from '@/lib/sse';

export const dynamic = 'force-dynamic';

const TICK_MS = 3000;
const MAX_TICKS = 40; // ~2 minutes

// Our payment references are always crypto.randomUUID().
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[0-9+\-\s()]{0,32}$/;
const MAX_AMOUNT = 1e12;
const ALLOWED_PARAMS = new Set(['transactionId', 'phone', 'previousOutstanding']);

// Public (unauthenticated) endpoint: bound held-open streams per client and overall.
const streams = new ConnectionLimiter(5, 500);

function badRequest(message: string) {
  return new Response(message, { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * Server-Sent Events stream of a pending payment's status. The pay/payments
 * pages subscribe with ?transactionId=&phone=&previousOutstanding= and receive
 * live updates until the payment settles (or the stream times out).
 */
export async function GET(request: NextRequest) {
  const invalid = rejectInvalidSseRequest(request);
  if (invalid) return invalid;

  // Strict parameter validation: known keys only, each once, well-formed.
  const { searchParams } = new URL(request.url);
  for (const key of searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key) || searchParams.getAll(key).length > 1) return badRequest('Invalid parameters');
  }
  const transactionId = searchParams.get('transactionId') || '';
  const phone = searchParams.get('phone') || '';
  const prev = searchParams.get('previousOutstanding');
  if (!TRANSACTION_ID.test(transactionId)) return badRequest('Invalid transactionId');
  if (!PHONE.test(phone)) return badRequest('Invalid phone');
  let previousOutstanding: number | undefined;
  if (prev != null && prev !== '') {
    previousOutstanding = Number(prev);
    if (!Number.isFinite(previousOutstanding) || Math.abs(previousOutstanding) > MAX_AMOUNT) {
      return badRequest('Invalid previousOutstanding');
    }
  }

  const release = streams.acquire(clientKey(request));
  if (!release) return tooManyStreams();

  let stop: () => void = release;
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let wake: (() => void) | undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        wake?.();
        release();
        try { controller.close(); } catch { /* already closed by the runtime */ }
      };
      stop = close;
      request.signal.addEventListener('abort', close);

      const send = (data: unknown) => {
        const frame = sseFrame(null, data);
        if (!frame || closed) return;
        try { controller.enqueue(frame); } catch { close(); }
      };

      for (let tick = 0; tick < MAX_TICKS && !closed; tick++) {
        try {
          const status = await getPendingPaymentStatus(transactionId, phone, previousOutstanding);
          send(status);
          if (['success', 'partial', 'failed', 'void'].includes(status.status)) break;
        } catch {
          send({ status: 'error' });
        }
        if (closed) break;
        await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, TICK_MS); });
      }
      close();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
}

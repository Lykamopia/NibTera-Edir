import { NextRequest } from 'next/server';
import { getPendingPaymentStatus } from '@/lib/payment-status';

export const dynamic = 'force-dynamic';

/**
 * Server-Sent Events stream of a pending payment's status. The pay/payments
 * pages subscribe with ?transactionId=&phone=&previousOutstanding= and receive
 * live updates until the payment settles (or the stream times out).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const transactionId = searchParams.get('transactionId');
  const phone = searchParams.get('phone') || '';
  const prev = searchParams.get('previousOutstanding');
  const previousOutstanding = prev != null ? Number(prev) : undefined;

  if (!transactionId) return new Response('Missing transactionId', { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const maxTicks = 40; // ~2 minutes at 3s
      for (let tick = 0; tick < maxTicks && !closed; tick++) {
        try {
          const status = await getPendingPaymentStatus(transactionId, phone, previousOutstanding);
          send(status);
          if (['success', 'partial', 'failed', 'void'].includes(status.status)) break;
        } catch {
          send({ status: 'error' });
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      closed = true;
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

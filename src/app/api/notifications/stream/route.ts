import { NextRequest } from "next/server";
import { getLoggedInUser } from "@/app/actions/auth";
import prisma from "@/lib/prisma";
import { getCurrentSessionId, isSessionActive } from "@/lib/sessions";
import {
  ConnectionLimiter,
  SSE_RESPONSE_HEADERS,
  clampText,
  rejectInvalidSseRequest,
  sseFrame,
  tooManyStreams,
} from "@/lib/sse";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 10_000;
/** Streams are recycled after this long; EventSource reconnects (and re-authenticates). */
const MAX_STREAM_LIFETIME_MS = 60 * 60 * 1000;
const MAX_NOTIFICATIONS_PER_FRAME = 20;

// A handful of tabs per user; the process-wide cap bounds held-open sockets.
const streams = new ConnectionLimiter(5, 1000);

export async function GET(req: NextRequest) {
  const invalid = rejectInvalidSseRequest(req);
  if (invalid) return invalid;

  const user = await getLoggedInUser();
  const sessionId = user ? await getCurrentSessionId() : null;
  if (!user || !sessionId) {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const release = streams.acquire(user.id);
  if (!release) return tooManyStreams();

  const userId = user.id;
  let stop: () => void = release;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let interval: ReturnType<typeof setInterval> | undefined;
      const openedAt = Date.now();
      let lastSentAt = new Date();

      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        release();
        try { controller.close(); } catch { /* already closed by the runtime */ }
      };

      const send = (event: string, data: unknown): boolean => {
        const frame = sseFrame(event, data);
        if (!frame || closed) return false;
        try { controller.enqueue(frame); return true; } catch { close(); return false; }
      };

      stop = close;
      req.signal.addEventListener("abort", close);

      try {
        const unreadCount = await prisma.notification.count({ where: { userId, read: false } });
        send("init", { unreadCount });
      } catch {
        close();
        return;
      }

      interval = setInterval(async () => {
        if (closed) return;
        try {
          // The stream must not outlive the session that opened it: logout,
          // revocation, idle/absolute expiry or a tokenVersion bump ends it.
          if (Date.now() - openedAt >= MAX_STREAM_LIFETIME_MS || !(await isSessionActive(sessionId, userId))) {
            close();
            return;
          }

          const since = lastSentAt;
          lastSentAt = new Date();

          const [rows, unreadCount] = await Promise.all([
            prisma.notification.findMany({
              where: { userId, createdAt: { gt: since } },
              orderBy: { createdAt: "desc" },
              take: MAX_NOTIFICATIONS_PER_FRAME,
              select: {
                id: true,
                type: true,
                priority: true,
                title: true,
                body: true,
                linkUrl: true,
                entityId: true,
                entityType: true,
                read: true,
                readAt: true,
                createdAt: true,
              },
            }),
            prisma.notification.count({ where: { userId, read: false } }),
          ]);
          if (closed) return;

          if (rows.length === 0) {
            send("ping", { unreadCount });
            return;
          }

          // Bound every outgoing message: clamp free text, then shrink the
          // batch until the frame fits the size cap (the client refetches the
          // full list on demand).
          let notifications = rows.map((n) => ({
            ...n,
            title: clampText(n.title, 200),
            body: clampText(n.body, 500),
            linkUrl: clampText(n.linkUrl, 500),
          }));
          while (notifications.length > 0 && !send("notification", { notifications, unreadCount })) {
            if (closed) return;
            notifications = notifications.slice(0, Math.floor(notifications.length / 2));
          }
        } catch {
          close();
        }
      }, POLL_INTERVAL_MS);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, { headers: SSE_RESPONSE_HEADERS });
}

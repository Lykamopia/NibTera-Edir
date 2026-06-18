import { NextRequest } from "next/server";
import { getLoggedInUser } from "@/app/actions/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 10_000;

export async function GET(req: NextRequest) {
  const user = await getLoggedInUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = user.id;
  const encoder = new TextEncoder();

  function sseChunk(event: string, data: unknown) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let lastSentAt = new Date();

      // Send initial unread count
      try {
        const unreadCount = await prisma.notification.count({
          where: { userId, read: false },
        });
        controller.enqueue(sseChunk("init", { unreadCount }));
      } catch {
        controller.close();
        return;
      }

      // Poll for new notifications
      const interval = setInterval(async () => {
        try {
          const since = lastSentAt;
          lastSentAt = new Date();

          const [newNotifications, unreadCount] = await Promise.all([
            prisma.notification.findMany({
              where: { userId, createdAt: { gt: since } },
              orderBy: { createdAt: "desc" },
              take: 20,
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

          if (newNotifications.length > 0) {
            controller.enqueue(sseChunk("notification", { notifications: newNotifications, unreadCount }));
          } else {
            controller.enqueue(sseChunk("ping", { unreadCount }));
          }
        } catch {
          clearInterval(interval);
          controller.close();
        }
      }, POLL_INTERVAL_MS);

      // Clean up when client disconnects
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

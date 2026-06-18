"use server";

import prisma from "@/lib/prisma";
import { getLoggedInUser } from "@/app/actions/auth";

export async function getNotifications(limit = 30) {
  const user = await getLoggedInUser();
  if (!user) return [];

  return prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
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
  });
}

export async function getUnreadCount() {
  const user = await getLoggedInUser();
  if (!user) return 0;

  return prisma.notification.count({
    where: { userId: user.id, read: false },
  });
}

export async function markAsRead(id: string) {
  const user = await getLoggedInUser();
  if (!user) return;

  await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true, readAt: new Date() },
  });
}

export async function markAllAsRead() {
  const user = await getLoggedInUser();
  if (!user) return;

  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true, readAt: new Date() },
  });
}

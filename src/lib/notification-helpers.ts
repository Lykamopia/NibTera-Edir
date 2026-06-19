import prisma from "@/lib/prisma";

export type NotificationPriority = "low" | "normal" | "high" | "critical";
export type NotificationType =
  | "general"
  | "account"
  | "security"
  | "system"
  | "payment"
  | "emergency"
  | "member"
  | "event"
  | "approval";

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  body: string;
  linkUrl?: string;
  entityId?: string;
  entityType?: string;
  edirId?: string | null;
}

export async function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      priority: input.priority ?? "normal",
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      entityId: input.entityId,
      entityType: input.entityType,
      edirId: input.edirId ?? null,
    },
  });
}

export async function createNotifications(inputs: CreateNotificationInput[]) {
  if (inputs.length === 0) return;
  return prisma.notification.createMany({ data: inputs });
}

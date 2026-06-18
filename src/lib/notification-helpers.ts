import prisma from "@/lib/prisma";

export type NotificationPriority = "low" | "normal" | "high" | "critical";
export type NotificationType =
  | "plan_approved"
  | "allocation_submitted"
  | "allocation_approved"
  | "allocation_rejected"
  | "kpi_assigned"
  | "achievement_approved"
  | "achievement_rejected"
  // Job workflow
  | "job_submitted"
  | "job_approved"
  | "job_fully_approved"
  | "job_rejected"
  | "job_revision_requested"
  // Lead workflow
  | "lead_assigned"
  | "lead_progress_submitted"
  | "lead_progress_approved"
  | "lead_progress_rejected"
  | "lead_deadline_approaching"
  | "lead_overdue"
  | "lead_completed"
  | "lead_pending_closure"
  | "lead_closed"
  | "lead_returned_for_work"
  // Daily plan workflow
  | "daily_plan_submitted"
  | "daily_plan_approved"
  | "daily_plan_rejected"
  | "daily_plan_overdue"
  | "general";

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  body: string;
  linkUrl?: string;
  entityId?: string;
  entityType?: string;
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
    },
  });
}

export async function createNotifications(inputs: CreateNotificationInput[]) {
  if (inputs.length === 0) return;
  return prisma.notification.createMany({ data: inputs });
}

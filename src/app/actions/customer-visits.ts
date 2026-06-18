"use server";

import prisma from "@/lib/prisma";
import { getLoggedInUser, hasPermission } from "./auth";
import { revalidatePath } from "next/cache";
import { logSecurityEvent, SecurityEvent } from "@/lib/security-logger";
import { LogSeverity } from "@/lib/types";

export async function createCustomerVisit(data: {
  customerId: string;
  visitDate: Date;
  startTime?: Date;
  endTime?: Date;
  latitude?: number;
  longitude?: number;
  locationNotes?: string;
  outcome: string;
  notes?: string;
  followUpNeeded?: boolean;
  followUpDate?: Date;
  followUpAction?: string;
  jobId?: string;
}) {
  await hasPermission('view_customer_visits');
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  const visit = await prisma.customerVisit.create({
    data: {
      customerId: data.customerId,
      visitDate: data.visitDate,
      startTime: data.startTime,
      endTime: data.endTime,
      latitude: data.latitude,
      longitude: data.longitude,
      locationNotes: data.locationNotes,
      outcome: data.outcome as any,
      notes: data.notes,
      followUpNeeded: data.followUpNeeded || false,
      followUpDate: data.followUpDate,
      followUpAction: data.followUpAction,
      jobId: data.jobId,
      createdById: user.id,
      branchId: user.branchId || undefined,
    },
    include: {
      customer: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  // Create a customer interaction record for this visit
  await prisma.customerInteraction.create({
    data: {
      type: "VISIT",
      summary: `Customer visit (${data.outcome})`,
      details: data.notes,
      interactionDate: data.visitDate,
      customerId: data.customerId,
      createdById: user.id,
      jobId: data.jobId,
      visitId: visit.id,
    },
  });

  await logSecurityEvent({
      event: SecurityEvent.CUSTOMER_VISIT_CREATED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Created customer visit for ${customer?.firstName} ${customer?.lastName} (ID: ${data.customerId})`,
      targetId: visit.id,
      targetType: "CustomerVisit",
    });

  revalidatePath("/dashboard/customer-visits");
  revalidatePath("/dashboard/customers");

  return visit;
}

export async function updateCustomerVisit(
  id: string,
  data: Partial<{
    visitDate: Date;
    startTime?: Date;
    endTime?: Date;
    latitude?: number;
    longitude?: number;
    locationNotes?: string;
    outcome: string;
    notes?: string;
    followUpNeeded?: boolean;
    followUpDate?: Date;
    followUpAction?: string;
  }>
) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const visit = await prisma.customerVisit.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!visit) throw new Error("Visit not found");
  if (visit.createdById !== user.id && !user.role?.permissions.includes("manage_customers")) {
    throw new Error("Not authorized to edit this visit");
  }

  const updated = await prisma.customerVisit.update({
    where: { id },
    data: {
      ...data,
      outcome: data.outcome as any,
    },
    include: {
      customer: true,
      createdBy: { select: { id: true, name: true } },
    },
  });

  await logSecurityEvent({
      event: SecurityEvent.CUSTOMER_VISIT_UPDATED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Updated customer visit (ID: ${id}) for ${visit.customer?.firstName} ${visit.customer?.lastName}`,
      targetId: id,
      targetType: "CustomerVisit",
    });

  revalidatePath("/dashboard/customer-visits");
  revalidatePath("/dashboard/customers");

  return updated;
}

export async function deleteCustomerVisit(id: string) {
  await hasPermission('view_customer_visits');
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const visit = await prisma.customerVisit.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!visit) throw new Error("Visit not found");
  if (visit.createdById !== user.id && !user.role?.permissions.includes("manage_customers")) {
    throw new Error("Not authorized to delete this visit");
  }

  await prisma.customerVisit.delete({
    where: { id },
  });

  await logSecurityEvent({
      event: SecurityEvent.CUSTOMER_VISIT_DELETED,
      severity: LogSeverity.WARN,
      actor: user,
      details: `Deleted customer visit (ID: ${id}) for ${visit.customer?.firstName} ${visit.customer?.lastName}`,
      targetId: id,
      targetType: "CustomerVisit",
    });

  revalidatePath("/dashboard/customer-visits");
  revalidatePath("/dashboard/customers");

  return { success: true };
}

export async function getCustomerVisits(filters?: {
  customerId?: string;
  startDate?: Date;
  endDate?: Date;
  branchId?: string;
  userId?: string;
  outcome?: string;
}) {
  await hasPermission('view_customer_visits');
  const user = await getLoggedInUser();
  if (!user) return [];

  const where: any = {};

  if (filters?.customerId) where.customerId = filters.customerId;
  if (filters?.startDate && filters?.endDate) {
    where.visitDate = {
      gte: filters.startDate,
      lte: filters.endDate,
    };
  }
  if (filters?.branchId) where.branchId = filters.branchId;
  else if (user.branchId) where.branchId = user.branchId;
  if (filters?.userId) where.createdById = filters.userId;
  else if (!user.role?.permissions.includes("view_reports")) {
    // If not a manager, only see own visits
    where.createdById = user.id;
  }
  if (filters?.outcome) where.outcome = filters.outcome;

  return await prisma.customerVisit.findMany({
    where,
    include: {
      customer: true,
      createdBy: { select: { id: true, name: true } },
      branch: true,
    },
    orderBy: {
      visitDate: "desc",
    },
  });
}

export async function getCustomerVisitById(id: string) {
  const user = await getLoggedInUser();
  if (!user) return null;

  const visit = await prisma.customerVisit.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { id: true, name: true } },
      branch: true,
      interactions: true,
    },
  });

  if (!visit) return null;

  // Check authorization
  if (
    visit.createdById !== user.id &&
    visit.branchId !== user.branchId &&
    !user.role?.permissions.includes("view_reports")
  ) {
    return null;
  }

  return visit;
}

export async function getCustomersForVisit() {
  await hasPermission('view_customer_visits');
  const user = await getLoggedInUser();
  if (!user) return [];

  let where: any = {};
  if (user.branchId) where.branchId = user.branchId;

  return await prisma.customer.findMany({
    where,
    orderBy: {
      lastName: "asc",
    },
  });
}

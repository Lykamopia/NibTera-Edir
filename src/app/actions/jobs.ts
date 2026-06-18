"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { getLoggedInUser } from "./auth";
import { logSecurityEvent, SecurityEvent } from "@/lib/security-logger";
import { LogSeverity } from "@/lib/types";
import { awardPointsForJob } from "./gamification";
import { AccessDeniedError } from "@/lib/errors";
import { createNotification, createNotifications } from "@/lib/notification-helpers";

function userHasAnyPermission(user: any, ...perms: string[]): boolean {
  const up = user?.role?.permissions?.split(",") ?? [];
  return perms.some((p) => up.includes(p));
}

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Default threshold for flagging (in meters)
const DEFAULT_DISTANCE_THRESHOLD = 100; // 100 meters

// Serialize Prisma Decimal → number | null so Next.js can pass results to Client Components.
// Prisma Decimal.prototype.toJSON() returns a string, so JSON round-trip converts all Decimals to strings;
// we parse those back to numbers where truthy so client code can do arithmetic.
function serializeJobs(jobs: any[]): any[] {
  return JSON.parse(
    JSON.stringify(jobs, (_key, value) =>
      // Prisma Decimal serializes to a string via toJSON(); leave everything else as-is.
      value
    )
  );
}

export async function getJobs() {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasAnyPermission(user, "view_jobs", "submit_jobs", "manage_jobs")) throw new AccessDeniedError();

  try {
    const jobs = await prisma.job.findMany({
      where: { createdById: user.id },
      include: { createdBy: true, plan: true, branch: true, kpiValues: true, customer: true, gpsVerifications: true, approvalHistory: { include: { approvedBy: true }, orderBy: { createdAt: "desc" } } },
      orderBy: { activityDate: "desc" }
    });
    return serializeJobs(jobs);
  } catch {
    return [];
  }
}

export async function getAllJobs() {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasAnyPermission(user, "manage_jobs")) throw new AccessDeniedError();

  try {
    let where: any = {};
    if (user.branchId) {
      where.branchId = user.branchId;
      where.status = { in: ["PENDING_BRANCH", "APPROVED_BRANCH", "PENDING_DISTRICT", "APPROVED", "REJECTED", "RESUBMITTED"] };
    } else if (user.districtId) {
      where.branch = { districtId: user.districtId };
      where.status = { in: ["PENDING_DISTRICT", "APPROVED", "REJECTED", "RESUBMITTED"] };
    }
    const jobs = await prisma.job.findMany({
      where,
      include: { createdBy: true, plan: true, branch: true, kpiValues: true, customer: true, gpsVerifications: true, approvalHistory: { include: { approvedBy: true }, orderBy: { createdAt: "desc" } } },
      orderBy: { activityDate: "desc" }
    });
    return serializeJobs(jobs);
  } catch {
    return [];
  }
}

export async function getJobById(id: string) {
  const user = await getLoggedInUser();
  if (!user) return null;
  if (!userHasAnyPermission(user, "view_jobs", "submit_jobs", "manage_jobs")) return null;

  const canManage = userHasAnyPermission(user, "manage_jobs");

  try {
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        createdBy: true, plan: true, branch: true, kpiValues: true,
        customer: true, gpsVerifications: true,
        approvalHistory: { include: { approvedBy: true }, orderBy: { createdAt: "desc" } },
      },
    });

    if (!job) return null;

    // Staff can only see their own jobs; managers see jobs within their scope
    if (!canManage) {
      if (job.createdById !== user.id) return null;
    } else {
      if (user.branchId && job.branchId !== user.branchId) return null;
      if (user.districtId && !user.branchId) {
        const branch = await prisma.branch.findUnique({ where: { id: job.branchId ?? '' } });
        if (!branch || branch.districtId !== user.districtId) return null;
      }
    }

    return serializeJobs([job])[0];
  } catch {
    return null;
  }
}

export async function createJob(data: {
  title: string;
  activityType: string;
  notes?: string;
  customerName?: string;
  customerContact?: string;
  activityDate: string;
  latitude?: number;
  longitude?: number;
  planId?: string;
  customerId?: string;
  leadId?: string;
  kpiValues: { kpiName: string; kpiConfigId?: string; achievedValue: number }[];
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "submit_jobs", "manage_jobs")) throw new AccessDeniedError();

  try {
    // Check if any of the selected KPIs require district approval
    let requiresDistrictApproval = false;
    if (data.kpiValues.length > 0) {
      const kpiConfigIds = data.kpiValues
        .map(k => k.kpiConfigId)
        .filter((id): id is string => !!id);
      
      if (kpiConfigIds.length > 0) {
        const kpiConfigs = await prisma.kpiConfig.findMany({
          where: { id: { in: kpiConfigIds } },
        });
        requiresDistrictApproval = kpiConfigs.some(k => k.requiresDistrictApproval);
      }
    }

    // Get target location (customer, lead, or branch)
    let targetLat: number | null = null;
    let targetLon: number | null = null;
    let targetType: string | null = null;
    let targetId: string | null = null;

    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { latitude: true, longitude: true }
      });
      if (customer?.latitude && customer?.longitude) {
        targetLat = customer.latitude.toNumber();
        targetLon = customer.longitude.toNumber();
        targetType = "CUSTOMER";
        targetId = data.customerId;
      }
    }

    if (!targetLat && data.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: data.leadId },
        select: { latitude: true, longitude: true }
      });
      if (lead?.latitude && lead?.longitude) {
        targetLat = lead.latitude.toNumber();
        targetLon = lead.longitude.toNumber();
        targetType = "LEAD";
        targetId = data.leadId;
      }
    }

    if (!targetLat && user.branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: user.branchId },
        select: { latitude: true, longitude: true }
      });
      if (branch?.latitude && branch?.longitude) {
        targetLat = branch.latitude.toNumber();
        targetLon = branch.longitude.toNumber();
        targetType = "BRANCH";
        targetId = user.branchId;
      }
    }

    const job = await prisma.job.create({
      data: {
        title: data.title,
        activityType: data.activityType,
        notes: data.notes,
        customerName: data.customerName,
        customerContact: data.customerContact,
        activityDate: new Date(data.activityDate),
        latitude: data.latitude,
        longitude: data.longitude,
        planId: data.planId,
        customerId: data.customerId,
        leadId: data.leadId,
        branchId: user.branchId,
        createdById: user.id,
        requiresDistrictApproval,
        status: requiresDistrictApproval ? "PENDING_BRANCH" : "PENDING_BRANCH", // Start with branch approval
        kpiValues: {
          create: data.kpiValues.map(kpi => ({
            kpiName: kpi.kpiName,
            kpiConfigId: kpi.kpiConfigId,
            achievedValue: kpi.achievedValue
          }))
        }
      },
      include: { kpiValues: true }
    });

    // Log job creation
    await logSecurityEvent({
      event: SecurityEvent.JOB_CREATED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Created job: "${job.title}" (${job.activityType})`,
      targetId: job.id,
      targetType: "Job",
    });

    // Create GPS verification if coordinates are provided
    if (data.latitude && data.longitude) {
      let distance: number | null = null;
      let status: "VERIFIED" | "FLAGGED" = "VERIFIED";

      if (targetLat && targetLon) {
        distance = calculateDistance(data.latitude, data.longitude, targetLat, targetLon);
        if (distance > DEFAULT_DISTANCE_THRESHOLD) {
          status = "FLAGGED";
          await logSecurityEvent({
            event: SecurityEvent.GPS_VERIFICATION_FLAGGED, // We'll add this
            severity: LogSeverity.WARN,
            actor: user,
            details: `Job ${job.id} flagged for GPS verification. Distance: ${distance.toFixed(2)} meters`,
            targetId: job.id,
            targetType: "Job"
          });
        }
      }

      await prisma.gPSVerification.create({
        data: {
          jobId: job.id,
          submissionLatitude: data.latitude,
          submissionLongitude: data.longitude,
          targetLatitude: targetLat,
          targetLongitude: targetLon,
          targetType,
          targetId,
          distanceMeters: distance,
          status
        }
      });
    }

    revalidatePath("/dashboard/jobs");

    // Notify branch managers a new job needs review
    if (user.branchId) {
      try {
        const managers = await prisma.user.findMany({
          where: { branchId: user.branchId, id: { not: user.id }, role: { permissions: { contains: "manage_jobs" } } },
          select: { id: true },
        });
        if (managers.length > 0) {
          await createNotifications(managers.map((m) => ({
            userId: m.id,
            type: "job_submitted" as const,
            priority: "normal" as const,
            title: "New Job Submitted for Review",
            body: `${user.name ?? "A staff member"} submitted a job: "${job.title}" (${job.activityType}).`,
            linkUrl: "/dashboard/approvals",
            entityId: job.id,
            entityType: "job",
          })));
        }
      } catch (e) {
        console.error("Failed to send job submission notifications:", e);
      }
    }

    return job;
  } catch (error) {
    console.error("Error creating job:", error);
    throw new Error("Failed to create job");
  }
}

export async function approveJob(jobId: string, comment?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_jobs")) throw new AccessDeniedError();

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new Error("Job not found");

    let newStatus = "APPROVED";
    let stage: "BRANCH" | "DISTRICT" = "BRANCH";

    if (user.branchId && job.status === "PENDING_BRANCH") {
      // Branch manager approving
      stage = "BRANCH";
      if (job.requiresDistrictApproval) {
        newStatus = "PENDING_DISTRICT";
      } else {
        newStatus = "APPROVED";
      }
    } else if (user.districtId && job.status === "PENDING_DISTRICT") {
      // District manager approving
      stage = "DISTRICT";
      newStatus = "APPROVED";
    } else {
      throw new Error("Not authorized to approve at this stage");
    }

    await prisma.$transaction(async (tx) => {
      await tx.jobApprovalHistory.create({
        data: {
          jobId,
          stage,
          status: "APPROVED",
          comment,
          approvedById: user.id
        }
      });
      await tx.job.update({
        where: { id: jobId },
        data: { status: newStatus }
      });

      // If job is fully approved and linked to a customer, add interaction
      if (newStatus === "APPROVED" && job.customerId) {
        // Map activity type to interaction type
        let interactionType = "VISIT";
        const lowerType = job.activityType.toLowerCase();
        if (lowerType.includes("call") || lowerType.includes("phone")) {
          interactionType = "CALL";
        } else if (lowerType.includes("email")) {
          interactionType = "EMAIL";
        } else if (lowerType.includes("meeting")) {
          interactionType = "MEETING";
        }

        await tx.customerInteraction.create({
          data: {
            customerId: job.customerId,
            type: interactionType,
            summary: job.title,
            details: job.notes || comment || "",
            interactionDate: job.activityDate,
            createdById: user.id,
            jobId: job.id
          }
        });
      }
    });

    // Log job approval
    await logSecurityEvent({
      event: SecurityEvent.JOB_APPROVED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Approved job: "${job.title}" (stage: ${stage})`,
      targetId: jobId,
      targetType: "Job",
    });

    // Award points when job is fully approved
    if (newStatus === "APPROVED") {
      await awardPointsForJob(jobId, job.createdById);
    }
    revalidatePath("/dashboard/jobs");

    // Notify job creator of approval outcome
    if (job.createdById !== user.id) {
      try {
        const isFullyApproved = newStatus === "APPROVED";
        await createNotification({
          userId: job.createdById,
          type: isFullyApproved ? "job_fully_approved" : "job_approved",
          priority: isFullyApproved ? "high" : "normal",
          title: isFullyApproved ? "Job Fully Approved" : "Job Approved — Awaiting District Review",
          body: isFullyApproved
            ? `Your job "${job.title}" has been fully approved.${comment ? ` Comment: ${comment}` : ""}`
            : `Your job "${job.title}" was approved at branch level and is now pending district review.`,
          linkUrl: "/dashboard/jobs",
          entityId: jobId,
          entityType: "job",
        });
      } catch (e) {
        console.error("Failed to send job approval notification:", e);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error approving job:", error);
    throw new Error("Failed to approve job");
  }
}

export async function rejectJob(jobId: string, comment?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_jobs")) throw new AccessDeniedError();

  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new Error("Job not found");

    let stage: "BRANCH" | "DISTRICT" = "BRANCH";
    
    if (user.branchId) stage = "BRANCH";
    else if (user.districtId) stage = "DISTRICT";

    await prisma.$transaction(async (tx) => {
      await tx.jobApprovalHistory.create({
        data: {
          jobId,
          stage,
          status: "REJECTED",
          comment,
          approvedById: user.id
        }
      });
      await tx.job.update({
        where: { id: jobId },
        data: { status: "REJECTED" }
      });
    });

    // Log job rejection
    await logSecurityEvent({
      event: SecurityEvent.JOB_REJECTED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Rejected job: "${job.title}" (stage: ${stage})`,
      targetId: jobId,
      targetType: "Job",
    });

    revalidatePath("/dashboard/jobs");

    // Notify job creator of rejection or revision request
    if (job.createdById !== user.id) {
      try {
        const isRevision = comment?.startsWith("REVISION REQUESTED:");
        await createNotification({
          userId: job.createdById,
          type: isRevision ? "job_revision_requested" : "job_rejected",
          priority: "high",
          title: isRevision ? "Job Revision Requested" : "Job Rejected",
          body: isRevision
            ? `Revision requested for your job "${job.title}". ${comment?.replace("REVISION REQUESTED:", "").trim() ?? ""}`
            : `Your job "${job.title}" was rejected.${comment ? ` Reason: ${comment}` : ""}`,
          linkUrl: "/dashboard/jobs",
          entityId: jobId,
          entityType: "job",
        });
      } catch (e) {
        console.error("Failed to send job rejection notification:", e);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error rejecting job:", error);
    throw new Error("Failed to reject job");
  }
}

export async function resubmitJob(data: {
  jobId: string;
  title: string;
  activityType: string;
  notes?: string;
  customerName?: string;
  customerContact?: string;
  activityDate: string;
  latitude?: number;
  longitude?: number;
  planId?: string;
  kpiValues: { id?: string; kpiName: string; kpiConfigId?: string; achievedValue: number }[];
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  try {
    let requiresDistrictApproval = false;
    if (data.kpiValues.length > 0) {
      const kpiConfigIds = data.kpiValues
        .map(k => k.kpiConfigId)
        .filter((id): id is string => !!id);
      
      if (kpiConfigIds.length > 0) {
        const kpiConfigs = await prisma.kpiConfig.findMany({
          where: { id: { in: kpiConfigIds } },
        });
        requiresDistrictApproval = kpiConfigs.some(k => k.requiresDistrictApproval);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.jobKpiValue.deleteMany({ where: { jobId: data.jobId } });
      await tx.job.update({
        where: { id: data.jobId },
        data: {
          title: data.title,
          activityType: data.activityType,
          notes: data.notes,
          customerName: data.customerName,
          customerContact: data.customerContact,
          activityDate: new Date(data.activityDate),
          latitude: data.latitude,
          longitude: data.longitude,
          planId: data.planId,
          status: requiresDistrictApproval ? "PENDING_BRANCH" : "PENDING_BRANCH",
          requiresDistrictApproval,
          kpiValues: {
            create: data.kpiValues.map(kpi => ({
              kpiName: kpi.kpiName,
              kpiConfigId: kpi.kpiConfigId,
              achievedValue: kpi.achievedValue
            }))
          }
        }
      });
    });

    // Log job resubmission
    await logSecurityEvent({
      event: SecurityEvent.JOB_RESUBMITTED,
      severity: LogSeverity.INFO,
      actor: user,
      details: `Resubmitted job: "${data.title}" (job ID: ${data.jobId})`,
      targetId: data.jobId,
      targetType: "Job",
    });

    revalidatePath("/dashboard/jobs");

    // Notify branch managers the job has been resubmitted
    if (user.branchId) {
      try {
        const managers = await prisma.user.findMany({
          where: { branchId: user.branchId, id: { not: user.id }, role: { permissions: { contains: "manage_jobs" } } },
          select: { id: true },
        });
        if (managers.length > 0) {
          await createNotifications(managers.map((m) => ({
            userId: m.id,
            type: "job_submitted" as const,
            priority: "normal" as const,
            title: "Job Resubmitted for Review",
            body: `${user.name ?? "A staff member"} resubmitted a job: "${data.title}".`,
            linkUrl: "/dashboard/approvals",
            entityId: data.jobId,
            entityType: "job",
          })));
        }
      } catch (e) {
        console.error("Failed to send job resubmission notifications:", e);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error resubmitting job:", error);
    throw new Error("Failed to resubmit job");
  }
}
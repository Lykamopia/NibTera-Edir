
"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { getLoggedInUser, hasPermission } from "./auth";
import { AccessDeniedError } from "@/lib/errors";
import { createNotification, createNotifications } from "@/lib/notification-helpers";
import { logSecurityEvent, SecurityEvent } from "@/lib/security-logger";
import { LogSeverity } from "@/lib/types";

function userHasAnyPermission(user: any, ...perms: string[]): boolean {
  const up = user?.role?.permissions?.split(",") ?? [];
  return perms.some((p) => up.includes(p));
}

// A lead in PENDING_CLOSURE is awaiting approver review; CLOSED leads are final.
// Both states are read-only for everyone except the dedicated closure actions below.
function assertLeadEditable(lead: { status: string }) {
  if (lead.status === "PENDING_CLOSURE" || lead.status === "CLOSED") {
    throw new Error("This lead is closed or pending closure review and cannot be edited.");
  }
}

const LEAD_INCLUDE = {
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true, branch: { select: { id: true, name: true } }, district: { select: { id: true, name: true } } } },
  branch: { select: { id: true, name: true, code: true, districtId: true, district: { select: { id: true, name: true } } } },
  district: { select: { id: true, name: true, code: true } },
  kpis: { orderBy: { createdAt: "asc" as const } },
  assignments: {
    include: {
      assignedFrom: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      assignedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  progressUpdates: {
    include: {
      submittedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      kpiUpdates: {
        include: { leadKpi: { select: { id: true, kpiName: true } } },
      },
    },
    orderBy: { createdAt: "desc" as const },
  },
  comments: {
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

export async function getLeads() {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasAnyPermission(user, "view_leads", "create_leads", "manage_leads", "assign_leads", "update_assigned_leads"))
    throw new AccessDeniedError();

  try {
    return await prisma.lead.findMany({
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        kpis: true,
        assignments: {
          include: {
            assignedFrom: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } },
            assignedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { progressUpdates: true, comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    return [];
  }
}

export async function getLeadById(id: string) {
  const user = await getLoggedInUser();
  if (!user) return null;
  if (!userHasAnyPermission(user, "view_leads", "create_leads", "manage_leads", "assign_leads", "update_assigned_leads"))
    throw new AccessDeniedError();

  try {
    return await prisma.lead.findUnique({
      where: { id },
      include: LEAD_INCLUDE,
    });
  } catch {
    return null;
  }
}

export async function getEligibleAssignees(leadId: string) {
  const user = await getLoggedInUser();
  if (!user) return [];

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { branch: { select: { id: true, districtId: true } }, district: { select: { id: true } } },
  });
  if (!lead) return [];

  // Determine scope: branch-scoped or district-scoped
  const districtId = lead.branch?.districtId ?? lead.districtId;
  const branchId = lead.branchId;

  const where: any = { status: "active" };

  if (branchId) {
    // Branch-scoped: users in the same branch, or district managers of that branch's district
    where.OR = [
      { branchId },
      { districtId },
    ];
  } else if (districtId) {
    // District-scoped: users in that district or any of its branches
    const district = await prisma.district.findUnique({
      where: { id: districtId },
      include: { branches: { select: { id: true } } },
    });
    const branchIds = district?.branches.map((b) => b.id) ?? [];
    where.OR = [
      { districtId },
      { branchId: { in: branchIds } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      branch: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
      role: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  // Move current user (self-assign) to front
  const self = users.find((u) => u.id === user.id);
  const others = users.filter((u) => u.id !== user.id);
  return self ? [self, ...others] : users;
}

// ── KPI Options for lead creation — fetches active KpiConfigs enriched with
//    plan allocation context scoped to the chosen branch or district ─────────
export type KpiAllocationOption = {
  kpiConfigId: string;
  kpiName: string;
  kpiType: "COUNT" | "CURRENCY";
  currency: string | null;
  // Plan-level allocation for this scope
  planAllocation: number;
  // Already claimed by other active leads in this scope
  allocatedToOtherLeads: number;
  // Already achieved/delivered via approved lead progress
  achievedInLeads: number;
  // Available = planAllocation − allocatedToOtherLeads
  availableBalance: number;
  hasPlanData: boolean;
};

export async function getKpiOptionsForLead(
  branchId?: string,
  districtId?: string,
  excludeLeadId?: string
): Promise<KpiAllocationOption[]> {
  const user = await getLoggedInUser();
  if (!user) return [];

  // 1. Active KpiConfig entries
  const configs = await prisma.kpiConfig.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  if (configs.length === 0) return [];

  const configNames = configs.map((c) => c.name.toLowerCase());

  // 2. Plan-level allocation scoped to branch or district
  // Match by case-insensitive name since PlanMetric has no kpiConfigId link
  let planAllocByName: Record<string, number> = {};

  if (branchId) {
    // Sum BranchPlanTarget.value across all months for active plans
    const branchTargets = await prisma.branchPlanTarget.findMany({
      where: {
        branchId,
        districtTarget: {
          assignment: { plan: { status: "active" } },
          metric: { name: { in: configs.map((c) => c.name), mode: "insensitive" } },
        },
      },
      include: { districtTarget: { include: { metric: { select: { name: true } } } } },
    });
    for (const bt of branchTargets) {
      const n = bt.districtTarget.metric.name.toLowerCase();
      planAllocByName[n] = (planAllocByName[n] ?? 0) + Number(bt.value);
    }
  } else if (districtId) {
    // Sum DistrictPlanTarget.plannedValue for active plans
    const districtTargets = await prisma.districtPlanTarget.findMany({
      where: {
        assignment: {
          districtId,
          plan: { status: "active" },
        },
        metric: { name: { in: configs.map((c) => c.name), mode: "insensitive" } },
      },
      include: { metric: { select: { name: true } } },
    });
    for (const dt of districtTargets) {
      const n = dt.metric.name.toLowerCase();
      planAllocByName[n] = (planAllocByName[n] ?? 0) + Number(dt.plannedValue);
    }
  }

  // 3. Lead KPI allocations in this scope (other active leads, by kpiConfigId)
  const activeLeadWhere: any = {
    kpiConfigId: { in: configs.map((c) => c.id) },
    lead: { status: { notIn: ["WON", "LOST"] } },
  };
  if (excludeLeadId) activeLeadWhere.leadId = { not: excludeLeadId };
  if (branchId) activeLeadWhere.lead.branchId = branchId;
  else if (districtId) activeLeadWhere.lead.districtId = districtId;

  const leadKpiGroups = await prisma.leadKpi.groupBy({
    by: ["kpiConfigId"],
    where: activeLeadWhere,
    _sum: { targetValue: true, currentValue: true },
  });
  const allocByConfigId: Record<string, { allocated: number; achieved: number }> = {};
  for (const g of leadKpiGroups) {
    if (g.kpiConfigId) {
      allocByConfigId[g.kpiConfigId] = {
        allocated: Number(g._sum.targetValue ?? 0),
        achieved: Number(g._sum.currentValue ?? 0),
      };
    }
  }

  return configs.map((c) => {
    const planAlloc = planAllocByName[c.name.toLowerCase()] ?? 0;
    const { allocated = 0, achieved = 0 } = allocByConfigId[c.id] ?? {};
    const available = Math.max(0, planAlloc - allocated);
    return {
      kpiConfigId: c.id,
      kpiName: c.name,
      kpiType: c.type as "COUNT" | "CURRENCY",
      currency: c.currency ?? null,
      planAllocation: planAlloc,
      allocatedToOtherLeads: allocated,
      achievedInLeads: achieved,
      availableBalance: available,
      hasPlanData: planAlloc > 0,
    };
  });
}

export async function getDistrictsAndBranches() {
  const [districts, branches] = await Promise.all([
    prisma.district.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    prisma.branch.findMany({
      select: { id: true, name: true, code: true, districtId: true, district: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  return { districts, branches };
}

export async function createLead(data: {
  title: string;
  description?: string;
  targetLocation?: string;
  latitude?: number;
  longitude?: number;
  deadline?: string;
  branchId?: string;
  districtId?: string;
  kpis: { kpiConfigId: string; targetValue: number }[];
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "create_leads", "manage_leads")) throw new AccessDeniedError();

  if (!data.kpis.length) throw new Error("At least one KPI is required");

  // Resolve KpiConfig names
  const configIds = [...new Set(data.kpis.map((k) => k.kpiConfigId))];
  const configs = await prisma.kpiConfig.findMany({
    where: { id: { in: configIds } },
    select: { id: true, name: true, currency: true },
  });
  const configMap = Object.fromEntries(configs.map((c) => [c.id, c]));

  const lead = await prisma.lead.create({
    data: {
      title: data.title,
      description: data.description,
      targetLocation: data.targetLocation,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      deadline: data.deadline ? new Date(data.deadline) : null,
      createdById: user.id,
      branchId: data.branchId || null,
      districtId: data.districtId || null,
      kpis: {
        create: data.kpis.map((kpi) => {
          const cfg = configMap[kpi.kpiConfigId];
          return {
            kpiName: cfg?.name ?? kpi.kpiConfigId,
            kpiConfigId: kpi.kpiConfigId,
            targetValue: kpi.targetValue,
            currency: (cfg?.currency as any) ?? null,
          };
        }),
      },
    },
    include: { kpis: true },
  });
  revalidatePath("/dashboard/leads");
  return { success: true, lead };
}

export async function updateLead(
  id: string,
  data: {
    title?: string;
    description?: string;
    targetLocation?: string;
    latitude?: number;
    longitude?: number;
    deadline?: string;
    branchId?: string;
    districtId?: string;
  }
) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_leads")) throw new AccessDeniedError();

  const existing = await prisma.lead.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new Error("Lead not found");
  assertLeadEditable(existing);

  await prisma.lead.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      targetLocation: data.targetLocation,
      latitude: data.latitude ?? undefined,
      longitude: data.longitude ?? undefined,
      deadline: data.deadline ? new Date(data.deadline) : undefined,
      branchId: data.branchId ?? undefined,
      districtId: data.districtId ?? undefined,
    },
  });
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${id}`);
  return { success: true };
}

export async function updateLeadStatus(id: string, status: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_leads")) throw new AccessDeniedError();

  if (status === "PENDING_CLOSURE" || status === "CLOSED") {
    throw new Error("Use the lead closure workflow (Close Lead / Return for Work) to set this status.");
  }

  const existing = await prisma.lead.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw new Error("Lead not found");
  if (existing.status === "CLOSED") {
    throw new Error("This lead is closed and cannot be modified.");
  }

  await prisma.lead.update({ where: { id }, data: { status: status as any } });
  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${id}`);
  return { success: true };
}

export async function assignLead(leadId: string, assignedToId: string, note?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "assign_leads", "manage_leads")) throw new AccessDeniedError();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      kpis: { select: { id: true, kpiName: true, kpiConfigId: true, staffKpiTargetId: true } },
    },
  });
  if (!lead) throw new Error("Lead not found");
  assertLeadEditable(lead);
  const previousAssignedToId = lead?.assignedToId;

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { assignedToId, status: "IN_PROGRESS" as any },
    }),
    prisma.leadAssignmentHistory.create({
      data: {
        leadId,
        assignedFromId: previousAssignedToId,
        assignedToId,
        assignedById: user.id,
        note,
      },
    }),
  ]);

  // Auto-link LeadKpis to matching StaffKpiTargets for the new assignee
  if (lead?.kpis) {
    for (const kpi of lead.kpis) {
      if (kpi.staffKpiTargetId) continue; // already linked
      const match = await prisma.staffKpiTarget.findFirst({
        where: {
          userId: assignedToId,
          districtTarget: { metric: { name: { equals: kpi.kpiName, mode: "insensitive" as const } } },
        },
        orderBy: { createdAt: "desc" },
      });
      if (match) {
        await prisma.leadKpi.update({
          where: { id: kpi.id },
          data: { staffKpiTargetId: match.id },
        });
      }
    }
  }

  // Notify the newly assigned user (unless they're assigning themselves)
  if (assignedToId !== user.id) {
    await createNotification({
      userId: assignedToId,
      type: "lead_assigned",
      priority: "high",
      title: "Lead Assigned to You",
      body: `You have been assigned the lead: "${lead?.title}". ${note ? `Note: ${note}` : ""}`,
      linkUrl: `/dashboard/leads/${leadId}`,
      entityId: leadId,
      entityType: "lead",
    });
  }

  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { success: true };
}

export async function submitLeadProgress(data: {
  leadId: string;
  notes: string;
  updateType: "INCREMENTAL" | "COMPLETION";
  kpiUpdates: { leadKpiId: string; value: number }[];
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const lead = await prisma.lead.findUnique({
    where: { id: data.leadId },
    include: { kpis: true, createdBy: { select: { id: true, name: true } } },
  });
  if (!lead) throw new Error("Lead not found");

  if (lead.assignedToId !== user.id) throw new AccessDeniedError("Only the assigned user can submit progress updates");

  if (lead.status === "PENDING_CLOSURE" || lead.status === "CLOSED") {
    throw new Error("This lead is awaiting closure review and cannot accept new updates.");
  }

  const progressUpdate = await prisma.$transaction(async (tx) => {
    const pu = await tx.leadProgressUpdate.create({
      data: {
        leadId: data.leadId,
        submittedById: user.id,
        notes: data.notes,
        updateType: data.updateType,
        status: "PENDING",
        kpiUpdates: {
          create: data.kpiUpdates.map((u) => ({
            leadKpiId: u.leadKpiId,
            value: u.value,
          })),
        },
      },
    });

    // A "Task Done" completion submission moves the lead into Pending Closure —
    // it only becomes fully reportable once the approver explicitly closes it.
    if (data.updateType === "COMPLETION") {
      await tx.lead.update({ where: { id: data.leadId }, data: { status: "PENDING_CLOSURE" as any } });
    }

    return pu;
  });

  // Notify lead creator / managers for approval
  if (lead.createdById !== user.id) {
    await createNotification({
      userId: lead.createdById,
      type: data.updateType === "COMPLETION" ? "lead_pending_closure" : "lead_progress_submitted",
      priority: "normal",
      title: data.updateType === "COMPLETION" ? "Lead Awaiting Closure Review" : "Lead Progress Update Submitted",
      body: data.updateType === "COMPLETION"
        ? `${user.name} marked "${lead.title}" as done. Review the submitted updates and close the lead or return it for further work.`
        : `${user.name} submitted a ${data.updateType.toLowerCase()} progress update for "${lead.title}". Pending your approval.`,
      linkUrl: `/dashboard/leads/${data.leadId}`,
      entityId: progressUpdate.id,
      entityType: "lead_progress",
    });
  }

  revalidatePath(`/dashboard/leads/${data.leadId}`);
  return { success: true, progressUpdate };
}

export async function approveLeadProgress(progressUpdateId: string, note?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_leads", "assign_leads")) throw new AccessDeniedError();

  const update = await prisma.leadProgressUpdate.findUnique({
    where: { id: progressUpdateId },
    include: {
      lead: {
        include: {
          kpis: {
            include: { staffKpiTarget: true },
          },
          assignedTo: { select: { id: true } },
        },
      },
      kpiUpdates: {
        include: {
          leadKpi: { include: { staffKpiTarget: true } },
        },
      },
      submittedBy: { select: { id: true, name: true } },
    },
  });
  if (!update) throw new Error("Progress update not found");

  const assignedUserId = update.lead.assignedToId ?? update.submittedById;
  const approvalDate = new Date();

  // ── 1. Apply KPI increments to LeadKpi.currentValue ──────────────────────
  const kpiIncrements: any[] = update.kpiUpdates.map((ku) =>
    prisma.leadKpi.update({
      where: { id: ku.leadKpiId },
      data: { currentValue: { increment: Number(ku.value) } },
    })
  );

  // ── 2. Sync to StaffKpiTarget — create auto-approved StaffKpiProgress entries
  //       for each KPI update that has a linked staffKpiTargetId ────────────────
  const staffProgressCreates: any[] = [];
  for (const ku of update.kpiUpdates) {
    let targetId = ku.leadKpi.staffKpiTargetId;

    // Auto-match by name if no explicit link (PlanMetric has no kpiConfigId field)
    if (!targetId && assignedUserId) {
      const match = await prisma.staffKpiTarget.findFirst({
        where: {
          userId: assignedUserId,
          districtTarget: { metric: { name: { equals: ku.leadKpi.kpiName, mode: "insensitive" as const } } },
        },
        orderBy: { createdAt: "desc" },
      });
      if (match) targetId = match.id;
    }

    if (targetId) {
      staffProgressCreates.push(
        prisma.staffKpiProgress.create({
          data: {
            targetId,
            submittedById: assignedUserId,
            progressDate: approvalDate,
            value: ku.value,
            notes: `Auto-synced from approved lead update: "${update.lead.title}"${note ? ` — ${note}` : ""}`,
            status: "approved",
            approvedById: user.id,
            approvedAt: approvalDate,
            leadProgressUpdateId: progressUpdateId,
          },
        })
      );
    }
  }

  // ── 3. Approve the update and apply increments ───────────────────────────
  // Note: approving a COMPLETION update does NOT close the lead — the
  // approver must explicitly call closeLead() or returnLeadForWork() to
  // resolve the Pending Closure state.
  const txOps: any[] = [
    prisma.leadProgressUpdate.update({
      where: { id: progressUpdateId },
      data: { status: "APPROVED", approvedById: user.id, approvalNote: note },
    }),
    ...kpiIncrements,
    ...staffProgressCreates,
  ];
  await prisma.$transaction(txOps);

  // ── 4. Notify submitter ───────────────────────────────────────────────────
  await createNotification({
    userId: update.submittedById,
    type: "lead_progress_approved",
    priority: "normal",
    title: "Progress Update Approved",
    body: `Your progress update for "${update.lead.title}" has been approved.${note ? ` Note: ${note}` : ""}`,
    linkUrl: `/dashboard/leads/${update.leadId}`,
    entityId: update.leadId,
    entityType: "lead",
  });

  revalidatePath(`/dashboard/leads/${update.leadId}`);
  revalidatePath("/dashboard/my-targets");
  return { success: true };
}

export async function rejectLeadProgress(progressUpdateId: string, note: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_leads", "assign_leads")) throw new AccessDeniedError();

  const update = await prisma.leadProgressUpdate.findUnique({
    where: { id: progressUpdateId },
    include: { lead: { select: { id: true, title: true } }, submittedBy: { select: { id: true } } },
  });
  if (!update) throw new Error("Progress update not found");

  await prisma.leadProgressUpdate.update({
    where: { id: progressUpdateId },
    data: { status: "REJECTED", approvedById: user.id, approvalNote: note },
  });

  await createNotification({
    userId: update.submittedById,
    type: "lead_progress_rejected",
    priority: "high",
    title: "Progress Update Rejected",
    body: `Your progress update for "${update.lead.title}" was rejected. Reason: ${note}`,
    linkUrl: `/dashboard/leads/${update.leadId}`,
    entityId: update.leadId,
    entityType: "lead",
  });

  revalidatePath(`/dashboard/leads/${update.leadId}`);
  return { success: true };
}

export async function addLeadComment(leadId: string, comment: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "view_leads", "create_leads", "manage_leads", "assign_leads", "update_assigned_leads"))
    throw new AccessDeniedError();

  await prisma.leadComment.create({
    data: { leadId, userId: user.id, comment },
  });

  revalidatePath(`/dashboard/leads/${leadId}`);
  return { success: true };
}

export async function updateLeadKpi(leadKpiId: string, currentValue: number) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "update_assigned_leads", "manage_leads")) throw new AccessDeniedError();

  const leadKpi = await prisma.leadKpi.findUnique({
    where: { id: leadKpiId },
    include: { lead: { select: { status: true } } },
  });
  if (!leadKpi) throw new Error("Lead KPI not found");
  assertLeadEditable(leadKpi.lead);

  await prisma.leadKpi.update({ where: { id: leadKpiId }, data: { currentValue } });
  revalidatePath("/dashboard/leads");
  return { success: true };
}

// ── Lead closure workflow ───────────────────────────────────────────────────
// A lead reaches PENDING_CLOSURE when the assignee submits a "Task Done"
// (COMPLETION) update. The approver must then either close the lead — making
// it read-only and final for reporting — or return it for further work.

export async function closeLead(leadId: string, note?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_leads", "assign_leads")) throw new AccessDeniedError();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      progressUpdates: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  if (!lead) throw new Error("Lead not found");
  if (lead.status !== "PENDING_CLOSURE") {
    throw new Error("Only leads pending closure review can be closed.");
  }
  if (lead.progressUpdates.length > 0) {
    throw new Error("Resolve all pending progress updates before closing this lead.");
  }

  await prisma.lead.update({ where: { id: leadId }, data: { status: "CLOSED" as any } });

  if (lead.assignedToId) {
    await createNotification({
      userId: lead.assignedToId,
      type: "lead_closed",
      priority: "normal",
      title: "Lead Closed",
      body: `"${lead.title}" has been closed.${note ? ` Note: ${note}` : ""}`,
      linkUrl: `/dashboard/leads/${leadId}`,
      entityId: leadId,
      entityType: "lead",
    });
  }

  await logSecurityEvent({
    event: SecurityEvent.LEAD_CLOSED,
    severity: LogSeverity.INFO,
    actor: user,
    details: `Closed lead: "${lead.title}"${note ? ` — ${note}` : ""}`,
    targetId: leadId,
    targetType: "Lead",
  });

  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { success: true };
}

export async function returnLeadForWork(leadId: string, note: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasAnyPermission(user, "manage_leads", "assign_leads")) throw new AccessDeniedError();
  if (!note?.trim()) throw new Error("A note is required when returning a lead for further work.");

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      progressUpdates: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  if (!lead) throw new Error("Lead not found");
  if (lead.status !== "PENDING_CLOSURE") {
    throw new Error("Only leads pending closure review can be returned for work.");
  }

  await prisma.$transaction([
    ...lead.progressUpdates.map((u) =>
      prisma.leadProgressUpdate.update({
        where: { id: u.id },
        data: { status: "REJECTED", approvedById: user.id, approvalNote: note },
      })
    ),
    prisma.lead.update({ where: { id: leadId }, data: { status: "IN_PROGRESS" as any } }),
  ]);

  if (lead.assignedToId) {
    await createNotification({
      userId: lead.assignedToId,
      type: "lead_returned_for_work",
      priority: "high",
      title: "Lead Returned for Further Work",
      body: `"${lead.title}" was returned for further work. Reason: ${note}`,
      linkUrl: `/dashboard/leads/${leadId}`,
      entityId: leadId,
      entityType: "lead",
    });
  }

  await logSecurityEvent({
    event: SecurityEvent.LEAD_RETURNED_FOR_WORK,
    severity: LogSeverity.INFO,
    actor: user,
    details: `Returned lead for further work: "${lead.title}" — ${note}`,
    targetId: leadId,
    targetType: "Lead",
  });

  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${leadId}`);
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { getLoggedInUser } from "./auth";
import { AccessDeniedError } from "@/lib/errors";
import { toDateKey, calendarMonthRange } from "@/lib/working-days";
import { createNotification } from "@/lib/notification-helpers";

function userHasPermission(user: any, perm: string): boolean {
  return (user?.role?.permissions?.split(",") ?? []).includes(perm);
}

/** Convert fiscal month (1=Jul..12=Jun) to calendar {year, month0based}. */
function fiscalToCalendar(fiscalYear: number, fiscalMonth: number) {
  const calMonth0 = (fiscalMonth - 1 + 6) % 12; // 0-based
  const calYear = calMonth0 >= 6 ? fiscalYear : fiscalYear + 1;
  return { calYear, calMonth0 };
}

function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

// ─── Manager: list plans for their branch ───────────────────────────────────

export async function getMonthlyPlansForBranch(fiscalYear?: number, fiscalMonth?: number) {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();
  if (!user.branchId) return [];

  const where: any = { branchId: user.branchId };
  if (fiscalYear) where.fiscalYear = fiscalYear;
  if (fiscalMonth) where.fiscalMonth = fiscalMonth;

  const plans = await prisma.monthlyDailyPlan.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      kpiConfig: { select: { id: true, name: true } },
      entries: {
        orderBy: { date: "asc" },
        include: {
          achievements: {
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ fiscalYear: "desc" }, { fiscalMonth: "desc" }, { createdAt: "desc" }],
  });

  return serialize(plans);
}

// ─── Manager: get branch staff ───────────────────────────────────────────────

export async function getBranchStaff() {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();
  if (!user.branchId) return [];

  const staff = await prisma.user.findMany({
    where: { branchId: user.branchId, status: "active" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  return staff;
}

// ─── Manager: get KPI configs ────────────────────────────────────────────────

export async function getKpiConfigsForPlan() {
  const user = await getLoggedInUser();
  if (!user) throw new AccessDeniedError();

  const configs = await prisma.kpiConfig.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true },
    orderBy: { name: "asc" },
  });
  return configs;
}

// ─── Manager: get working days for a fiscal month ────────────────────────────

export async function getWorkingDaysForFiscalMonth(fiscalYear: number, fiscalMonth: number) {
  const user = await getLoggedInUser();
  if (!user) throw new AccessDeniedError();

  const { calYear, calMonth0 } = fiscalToCalendar(fiscalYear, fiscalMonth);
  const { start, end } = calendarMonthRange(calYear, calMonth0);

  // Fetch settings + holidays
  const [settingRecord, holidays] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "working_days" } }),
    prisma.publicHoliday.findMany({
      where: { date: { gte: start, lte: end } },
    }),
  ]);

  const settingVal = settingRecord?.value as { saturdayWeekend?: boolean; sundayWeekend?: boolean } | null;
  const settings = {
    saturdayWeekend: settingVal?.saturdayWeekend ?? true,
    sundayWeekend: settingVal?.sundayWeekend ?? true,
  };
  const holidayKeys = new Set(holidays.map((h) => toDateKey(new Date(h.date))));

  // Build list of working day dates
  const workingDays: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    const key = toDateKey(cur);
    if (
      !(settings.saturdayWeekend && dow === 6) &&
      !(settings.sundayWeekend && dow === 0) &&
      !holidayKeys.has(key)
    ) {
      workingDays.push(key);
    }
    cur.setDate(cur.getDate() + 1);
  }

  return { workingDays, calYear, calMonth0, settings };
}

// ─── Manager: create / upsert plan entries ───────────────────────────────────

export async function createMonthlyDailyPlan(data: {
  userId: string;
  kpiConfigId?: string;
  metricName: string;
  fiscalYear: number;
  fiscalMonth: number;
  totalTarget: number;
  notes?: string;
  /** Map of YYYY-MM-DD → target value */
  dailyTargets: Record<string, number>;
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();
  if (!user.branchId) throw new Error("Not assigned to a branch");

  // Find-or-create the plan header (upsert with nullable composite key needs findFirst)
  const existing = await prisma.monthlyDailyPlan.findFirst({
    where: {
      userId: data.userId,
      kpiConfigId: data.kpiConfigId ?? null,
      fiscalYear: data.fiscalYear,
      fiscalMonth: data.fiscalMonth,
    },
  });

  const plan = existing
    ? await prisma.monthlyDailyPlan.update({
        where: { id: existing.id },
        data: {
          metricName: data.metricName,
          totalTarget: data.totalTarget,
          notes: data.notes,
          status: "draft",
        },
      })
    : await prisma.monthlyDailyPlan.create({
        data: {
          branchId: user.branchId,
          createdById: user.id,
          userId: data.userId,
          kpiConfigId: data.kpiConfigId ?? null,
          metricName: data.metricName,
          fiscalYear: data.fiscalYear,
          fiscalMonth: data.fiscalMonth,
          totalTarget: data.totalTarget,
          notes: data.notes,
          status: "draft",
        },
      });

  // Delete old entries and recreate
  await prisma.dailyPlanEntry.deleteMany({ where: { planId: plan.id } });

  const entries = Object.entries(data.dailyTargets)
    .filter(([, v]) => v > 0)
    .map(([dateStr, targetValue]) => ({
      planId: plan.id,
      date: new Date(dateStr),
      targetValue,
    }));

  if (entries.length > 0) {
    await prisma.dailyPlanEntry.createMany({ data: entries });
  }

  revalidatePath("/dashboard/daily-plan");
  revalidatePath("/dashboard/daily-targets");
  return { success: true, planId: plan.id };
}

// ─── Internal: evenly distribute total across working days ───────────────────

function distributeEvenlyInternal(
  total: number,
  days: string[],
  wholeNumbers = true,
): Record<string, number> {
  if (!days.length) return {};

  if (wholeNumbers) {
    const intTotal = Math.round(total);
    const base = Math.floor(intTotal / days.length);
    const remainder = intTotal - base * days.length;
    const result: Record<string, number> = {};
    days.forEach((d, i) => { result[d] = i < remainder ? base + 1 : base; });
    return result;
  }

  // Decimal mode — 2 dp, last day absorbs residual
  const perDay = Math.round((total / days.length) * 100) / 100;
  const result: Record<string, number> = {};
  let remaining = total;
  days.forEach((d, i) => {
    if (i === days.length - 1) {
      result[d] = Math.round(remaining * 100) / 100;
    } else {
      result[d] = perDay;
      remaining = Math.round((remaining - perDay) * 100) / 100;
    }
  });
  return result;
}

// ─── Internal: get working days without auth check (used inside other actions) ─

async function getWorkingDaysInternal(fiscalYear: number, fiscalMonth: number): Promise<string[]> {
  const { calYear, calMonth0 } = fiscalToCalendar(fiscalYear, fiscalMonth);
  const { start, end } = calendarMonthRange(calYear, calMonth0);

  const [settingRecord, holidays] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "working_days" } }),
    prisma.publicHoliday.findMany({ where: { date: { gte: start, lte: end } } }),
  ]);

  const settingVal = settingRecord?.value as { saturdayWeekend?: boolean; sundayWeekend?: boolean } | null;
  const sat = settingVal?.saturdayWeekend ?? true;
  const sun = settingVal?.sundayWeekend ?? true;
  const holidayKeys = new Set(holidays.map((h) => toDateKey(new Date(h.date))));

  const workingDays: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    const key = toDateKey(cur);
    if (!(sat && dow === 6) && !(sun && dow === 0) && !holidayKeys.has(key)) {
      workingDays.push(key);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return workingDays;
}

// ─── Manager: validate raw Excel rows (no side effects) ──────────────────────

export type ExcelImportRow = {
  staffEmail: string;
  metricName: string;
  kpiName?: string;
  fiscalYear: number;
  fiscalMonth: number;
  totalTarget: number;
  notes?: string;
};

export type ExcelImportPreviewRow = ExcelImportRow & {
  rowIndex: number;
  staffName: string | null;
  kpiConfigId: string | null;
  errors: string[];
  valid: boolean;
};

export async function validateDailyPlanImport(
  rows: ExcelImportRow[]
): Promise<{ preview: ExcelImportPreviewRow[]; validCount: number; errorCount: number }> {
  const user = await getLoggedInUser();
  if (!user) throw new AccessDeniedError();
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();

  const branchStaff = await prisma.user.findMany({
    where: { branchId: user.branchId ?? undefined },
    select: { id: true, name: true, email: true },
  });
  const staffByEmail = new Map(branchStaff.map((s) => [s.email?.toLowerCase() ?? "", s]));

  const kpiConfigs = await prisma.kpiConfig.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const kpiByName = new Map(kpiConfigs.map((k) => [k.name.toLowerCase(), k]));

  const seenKeys = new Set<string>();

  const preview: ExcelImportPreviewRow[] = rows.map((row, i) => {
    const errors: string[] = [];

    // Staff email
    const emailKey = row.staffEmail.trim().toLowerCase();
    const staffMember = staffByEmail.get(emailKey);
    if (!row.staffEmail.trim()) errors.push("Staff email is required");
    else if (!staffMember) errors.push(`No staff found with email "${row.staffEmail}"`);

    // Fiscal year
    if (!row.fiscalYear || row.fiscalYear < 2000 || row.fiscalYear > 2100)
      errors.push("Fiscal year must be a valid year (e.g. 2024)");

    // Fiscal month
    if (!row.fiscalMonth || row.fiscalMonth < 1 || row.fiscalMonth > 12)
      errors.push("Fiscal month must be 1–12");

    // Total target
    if (!row.totalTarget || row.totalTarget <= 0)
      errors.push("Total target must be greater than 0");

    // Metric name
    if (!row.metricName?.trim() && !row.kpiName?.trim())
      errors.push("Either KPI Name or custom Metric Name is required");

    // Duplicate check within file
    if (errors.length === 0 && staffMember) {
      const dk = `${staffMember.id}:${row.kpiName?.toLowerCase() ?? row.metricName.toLowerCase()}:${row.fiscalYear}-${row.fiscalMonth}`;
      if (seenKeys.has(dk)) errors.push("Duplicate row (same staff + KPI + month)");
      else seenKeys.add(dk);
    }

    // Resolve KPI config
    const matchedKpi = row.kpiName ? kpiByName.get(row.kpiName.trim().toLowerCase()) : null;

    return {
      ...row,
      rowIndex: i + 1,
      staffName: staffMember?.name ?? null,
      kpiConfigId: matchedKpi?.id ?? null,
      errors,
      valid: errors.length === 0,
    };
  });

  return {
    preview,
    validCount: preview.filter((r) => r.valid).length,
    errorCount: preview.filter((r) => !r.valid).length,
  };
}

// ─── Manager: execute validated import ───────────────────────────────────────

export async function executeDailyPlanImport(rows: ExcelImportPreviewRow[]) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();
  if (!user.branchId) throw new Error("Not assigned to a branch");

  const validRows = rows.filter((r) => r.valid);

  const branchStaff = await prisma.user.findMany({
    where: { branchId: user.branchId },
    select: { id: true, email: true },
  });
  const staffByEmail = new Map(branchStaff.map((s) => [s.email?.toLowerCase() ?? "", s.id]));

  // Pre-load KPI configs referenced in these rows so we can determine unit type
  const kpiIds = [...new Set(validRows.map((r) => r.kpiConfigId).filter(Boolean) as string[])];
  const kpiConfigs = kpiIds.length
    ? await prisma.kpiConfig.findMany({ where: { id: { in: kpiIds } }, select: { id: true, type: true } })
    : [];
  const kpiTypeById = new Map(kpiConfigs.map((k) => [k.id, k.type]));

  // Cache working days per unique (fy, fm) to avoid redundant DB calls
  const wdCache = new Map<string, string[]>();
  const getWD = async (fy: number, fm: number) => {
    const key = `${fy}-${fm}`;
    if (!wdCache.has(key)) wdCache.set(key, await getWorkingDaysInternal(fy, fm));
    return wdCache.get(key)!;
  };

  let succeeded = 0;
  let failed = 0;
  const errors: { row: number; message: string }[] = [];

  for (const row of validRows) {
    const userId = staffByEmail.get(row.staffEmail.trim().toLowerCase());
    if (!userId) { failed++; errors.push({ row: row.rowIndex, message: "Staff not found" }); continue; }

    try {
      const workingDays = await getWD(row.fiscalYear, row.fiscalMonth);
      if (workingDays.length === 0) {
        failed++;
        errors.push({ row: row.rowIndex, message: "No working days found for this month" });
        continue;
      }

      // Use whole-number distribution for COUNT KPIs; decimal for CURRENCY KPIs
      const kpiType = row.kpiConfigId ? kpiTypeById.get(row.kpiConfigId) : undefined;
      const wholeNumbers = kpiType !== "CURRENCY";
      const dailyTargets = distributeEvenlyInternal(row.totalTarget, workingDays, wholeNumbers);
      const metricName = row.metricName?.trim() || row.kpiName?.trim() || "Unknown";

      const existing = await prisma.monthlyDailyPlan.findFirst({
        where: {
          userId,
          kpiConfigId: row.kpiConfigId ?? null,
          fiscalYear: row.fiscalYear,
          fiscalMonth: row.fiscalMonth,
        },
      });

      const plan = existing
        ? await prisma.monthlyDailyPlan.update({
            where: { id: existing.id },
            data: { metricName, totalTarget: row.totalTarget, notes: row.notes, status: "draft" },
          })
        : await prisma.monthlyDailyPlan.create({
            data: {
              branchId: user.branchId,
              createdById: user.id,
              userId,
              kpiConfigId: row.kpiConfigId ?? null,
              metricName,
              fiscalYear: row.fiscalYear,
              fiscalMonth: row.fiscalMonth,
              totalTarget: row.totalTarget,
              notes: row.notes,
              status: "draft",
            },
          });

      await prisma.dailyPlanEntry.deleteMany({ where: { planId: plan.id } });
      const entries = Object.entries(dailyTargets)
        .filter(([, v]) => v > 0)
        .map(([dateStr, targetValue]) => ({ planId: plan.id, date: new Date(dateStr), targetValue }));
      if (entries.length > 0) await prisma.dailyPlanEntry.createMany({ data: entries });

      succeeded++;
    } catch (e: any) {
      failed++;
      errors.push({ row: row.rowIndex, message: e.message ?? "Unknown error" });
    }
  }

  revalidatePath("/dashboard/branch-targets");
  revalidatePath("/dashboard/daily-targets");
  return { succeeded, failed, errors };
}

// ─── Manager: publish plan ───────────────────────────────────────────────────

export async function publishMonthlyDailyPlan(planId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();

  await prisma.monthlyDailyPlan.update({
    where: { id: planId },
    data: { status: "published" },
  });

  revalidatePath("/dashboard/daily-plan");
  revalidatePath("/dashboard/daily-targets");
  return { success: true };
}

// ─── Manager: delete plan ────────────────────────────────────────────────────

export async function deleteMonthlyDailyPlan(planId: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();

  await prisma.monthlyDailyPlan.delete({ where: { id: planId } });

  revalidatePath("/dashboard/daily-plan");
  revalidatePath("/dashboard/daily-targets");
  return { success: true };
}

// ─── Staff: fetch my daily plan entries ─────────────────────────────────────

export async function getMyDailyPlanEntries(fiscalYear?: number, fiscalMonth?: number) {
  const user = await getLoggedInUser();
  if (!user) return [];

  const where: any = { userId: user.id, status: "published" };
  if (fiscalYear) where.fiscalYear = fiscalYear;
  if (fiscalMonth) where.fiscalMonth = fiscalMonth;

  const plans = await prisma.monthlyDailyPlan.findMany({
    where,
    include: {
      kpiConfig: { select: { id: true, name: true, type: true } },
      entries: {
        orderBy: { date: "asc" },
        include: {
          achievements: {
            where: { submittedById: user.id },
            orderBy: { submittedAt: "desc" },
          },
        },
      },
    },
    orderBy: [{ fiscalYear: "desc" }, { fiscalMonth: "desc" }],
  });

  return serialize(plans);
}

// ─── Staff: submit achievement ───────────────────────────────────────────────

export async function submitDailyPlanAchievement(data: {
  entryId: string;
  value: number;
  notes?: string;
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  // Verify the entry belongs to a plan assigned to this user
  const entry = await prisma.dailyPlanEntry.findFirst({
    where: { id: data.entryId, plan: { userId: user.id, status: "published" } },
  });
  if (!entry) throw new Error("Entry not found or not assigned to you");

  // Only allow one pending/approved achievement per entry per user
  const existing = await prisma.dailyPlanAchievement.findFirst({
    where: {
      entryId: data.entryId,
      submittedById: user.id,
      status: { in: ["pending", "approved"] },
    },
  });
  if (existing) throw new Error("Achievement already submitted for this entry");

  // Fetch full entry + plan context for notification
  const fullEntry = await prisma.dailyPlanEntry.findUnique({
    where: { id: data.entryId },
    include: {
      plan: {
        select: {
          metricName: true,
          createdById: true,
          fiscalYear: true,
          fiscalMonth: true,
          kpiConfig: { select: { name: true } },
        },
      },
    },
  });

  const achievement = await prisma.dailyPlanAchievement.create({
    data: {
      entryId: data.entryId,
      submittedById: user.id,
      value: data.value,
      notes: data.notes,
    },
  });

  // Notify the plan creator (manager) that a submission is awaiting approval
  if (fullEntry?.plan && fullEntry.plan.createdById !== user.id) {
    const dateLabel = fullEntry.date.toISOString().split("T")[0];
    try {
      await createNotification({
        userId: fullEntry.plan.createdById,
        type: "daily_plan_submitted",
        priority: "normal",
        title: "Daily Achievement Pending Approval",
        body: `${user.name ?? "A staff member"} submitted ${Number(data.value).toLocaleString()} for "${fullEntry.plan.metricName}" on ${dateLabel}. Open the Approvals drawer to review.`,
        linkUrl: "/dashboard/branch-targets",
        entityId: achievement.id,
        entityType: "daily_plan_achievement",
      });
    } catch {
      // Non-fatal — notification failure should not block the submission
    }
  }

  revalidatePath("/dashboard/daily-targets");
  return { success: true };
}

// ─── Manager: list pending achievements for their branch ────────────────────

export async function getPendingDailyPlanAchievements() {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();
  if (!user.branchId) return [];

  const achievements = await prisma.dailyPlanAchievement.findMany({
    where: {
      status: "pending",
      entry: {
        plan: { branchId: user.branchId },
      },
    },
    include: {
      submittedBy: { select: { id: true, name: true } },
      entry: {
        include: {
          plan: {
            include: { kpiConfig: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: { submittedAt: "asc" },
  });

  return serialize(achievements);
}

// ─── Manager: approve achievement ───────────────────────────────────────────

export async function approveDailyPlanAchievement(achievementId: string, comment?: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();

  // Fetch before update so we have context for the notification
  const ach = await prisma.dailyPlanAchievement.findUnique({
    where: { id: achievementId },
    include: {
      entry: {
        include: {
          plan: { select: { metricName: true, fiscalYear: true, fiscalMonth: true } },
        },
      },
    },
  });

  await prisma.dailyPlanAchievement.update({
    where: { id: achievementId },
    data: {
      status: "approved",
      approvedById: user.id,
      approvedAt: new Date(),
      ...(comment ? { notes: comment } : {}),
    },
  });

  // Notify the staff member
  if (ach) {
    try {
      const dateLabel = ach.entry.date.toISOString().split("T")[0];
      await createNotification({
        userId: ach.submittedById,
        type: "daily_plan_approved",
        priority: "normal",
        title: "Daily Achievement Approved ✓",
        body: `Your submission of ${Number(ach.value).toLocaleString()} for "${ach.entry.plan.metricName}" on ${dateLabel} has been approved by ${user.name ?? "your manager"}.${comment ? ` Comment: "${comment}"` : ""}`,
        linkUrl: "/dashboard/daily-targets",
        entityId: achievementId,
        entityType: "daily_plan_achievement",
      });
    } catch {
      // Non-fatal
    }
  }

  revalidatePath("/dashboard/daily-plan");
  revalidatePath("/dashboard/daily-targets");
  return { success: true };
}

// ─── Manager: reject achievement ────────────────────────────────────────────

export async function rejectDailyPlanAchievement(achievementId: string, feedback: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();

  const ach = await prisma.dailyPlanAchievement.findUnique({
    where: { id: achievementId },
    include: {
      entry: {
        include: {
          plan: { select: { metricName: true } },
        },
      },
    },
  });

  await prisma.dailyPlanAchievement.update({
    where: { id: achievementId },
    data: {
      status: "rejected",
      approvedById: user.id,
      approvedAt: new Date(),
      rejectionFeedback: feedback,
    },
  });

  // Notify the staff member
  if (ach) {
    try {
      const dateLabel = ach.entry.date.toISOString().split("T")[0];
      await createNotification({
        userId: ach.submittedById,
        type: "daily_plan_rejected",
        priority: "high",
        title: "Daily Achievement Returned for Revision",
        body: `Your submission for "${ach.entry.plan.metricName}" on ${dateLabel} was returned by ${user.name ?? "your manager"}. Feedback: "${feedback}"`,
        linkUrl: "/dashboard/daily-targets",
        entityId: achievementId,
        entityType: "daily_plan_achievement",
      });
    } catch {
      // Non-fatal
    }
  }

  revalidatePath("/dashboard/daily-plan");
  revalidatePath("/dashboard/daily-targets");
  return { success: true };
}

// ─── Manager: get all branch achievements (for approval drawer) ───────────────

export async function getBranchDailyPlanAchievements() {
  const user = await getLoggedInUser();
  if (!user) return [];
  if (!userHasPermission(user, "assign_staff_targets")) throw new AccessDeniedError();
  if (!user.branchId) return [];

  const achievements = await prisma.dailyPlanAchievement.findMany({
    where: {
      entry: { plan: { branchId: user.branchId } },
    },
    include: {
      submittedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      entry: {
        include: {
          plan: {
            select: {
              id: true,
              metricName: true,
              fiscalYear: true,
              fiscalMonth: true,
              kpiConfig: { select: { id: true, name: true, type: true } },
            },
          },
        },
      },
    },
    orderBy: { submittedAt: "desc" },
    take: 300,
  });

  return serialize(achievements);
}

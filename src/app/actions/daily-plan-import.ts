"use server";

import prisma from "@/lib/prisma";
import { getLoggedInUser } from "./auth";
import { revalidatePath } from "next/cache";
import { getWorkingDaysSettings } from "./settings";
import { toDateKey } from "@/lib/working-days";

// Check weekend using configurable settings (loaded once per request)
const makeIsWeekend = (settings: { saturdayWeekend: boolean; sundayWeekend: boolean }) =>
  (date: Date) => {
    const dow = date.getDay();
    return (settings.saturdayWeekend && dow === 6) || (settings.sundayWeekend && dow === 0);
  };

// Helper to check if a date is a public holiday
const isPublicHoliday = (date: Date, holidays: { date: Date }[]) => {
  const key = toDateKey(date);
  return holidays.some((h) => toDateKey(new Date(h.date)) === key);
};

// Helper to check if a date is a non-working day
const isNonWorkingDay = (
  date: Date,
  holidays: { date: Date }[],
  isWeekend: (d: Date) => boolean,
) => isWeekend(date) || isPublicHoliday(date, holidays);

// Interface for import preview data
interface ImportPreviewRow {
  userId: string;
  userName?: string;
  date: string;
  dailyTarget: number;
  backlogCarriedForward: number;
  metricId?: string;
  metricName?: string;
  branchPlanTargetId?: string;
  errors?: string[];
  warnings?: string[];
  isNonWorkingDay?: boolean;
}

export async function parseAndValidateDailyPlanImport(fileData: any, options: {
  branchId?: string;
  districtId?: string;
  quarter?: number;
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  // Get public holidays and weekend settings
  const [publicHolidays, wdSettings] = await Promise.all([
    prisma.publicHoliday.findMany({ select: { date: true } }),
    getWorkingDaysSettings(),
  ]);
  const isWeekend = makeIsWeekend(wdSettings);
  
  // Get users in branch/district
  let users: { id: string; name: string | null; branchId: string | null }[] = [];
  if (options.branchId) {
    users = await prisma.user.findMany({
      where: { branchId: options.branchId, status: "active" },
      select: { id: true, name: true, branchId: true },
    });
  } else if (options.districtId) {
    users = await prisma.user.findMany({
      where: { districtId: options.districtId, status: "active" },
      select: { id: true, name: true, branchId: true },
    });
  } else if (user.branchId) {
    users = await prisma.user.findMany({
      where: { branchId: user.branchId, status: "active" },
      select: { id: true, name: true, branchId: true },
    });
  } else if (user.districtId) {
    users = await prisma.user.findMany({
      where: { districtId: user.districtId, status: "active" },
      select: { id: true, name: true, branchId: true },
    });
  }

  // Get branch plan targets for the month
  let branchPlanTargets: {
    id: string;
    branchId: string;
    districtTarget: { metric: { id: string; name: string } };
  }[] = [];
  if (options.branchId) {
    branchPlanTargets = await prisma.branchPlanTarget.findMany({
      where: {
        branchId: options.branchId,
        ...(options.quarter ? { month: options.quarter } : {})
      },
      include: { districtTarget: { include: { metric: true } } },
    });
  } else if (options.districtId) {
    branchPlanTargets = await prisma.branchPlanTarget.findMany({
      where: {
        districtTarget: { assignment: { districtId: options.districtId } },
        ...(options.quarter ? { month: options.quarter } : {})
      },
      include: { districtTarget: { include: { metric: true } } },
    });
  }

  // Create lookup maps
  const userByName = new Map<string, typeof users[0]>();
  const userByEmail = new Map<string, typeof users[0]>();
  users.forEach(u => {
    if (u.name) userByName.set(u.name.toLowerCase(), u);
  });

  const branchPlanTargetByMetric = new Map<string, typeof branchPlanTargets>();
  branchPlanTargets.forEach(t => {
    const key = `${t.branchId}-${t.districtTarget.metric.id}`;
    if (!branchPlanTargetByMetric.has(key)) {
      branchPlanTargetByMetric.set(key, []);
    }
    branchPlanTargetByMetric.get(key)!.push(t);
  });

  const preview: ImportPreviewRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];

  // Process each row from the file
  for (let i = 0; i < fileData.length; i++) {
    const row = fileData[i];
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];

    // Extract and validate fields
    const userNameRaw = row["userName"] || row["UserName"] || row["Name"] || row["name"];
    const dateRaw = row["date"] || row["Date"] || row["activityDate"] || row["ActivityDate"];
    const dailyTargetRaw = row["dailyTarget"] || row["DailyTarget"] || row["target"] || row["Target"];
    const backlogRaw = row["backlogCarriedForward"] || row["BacklogCarriedForward"] || row["backlog"] || row["Backlog"] || 0;
    const metricNameRaw = row["metricName"] || row["MetricName"] || row["metric"] || row["Metric"];

    // Validate date
    let date: Date;
    if (!dateRaw) {
      rowErrors.push("Date is required");
    } else {
      date = new Date(dateRaw);
      if (isNaN(date.getTime())) {
        rowErrors.push("Invalid date format");
      } else {
        // Check if it's a non-working day
        if (isNonWorkingDay(date, publicHolidays, isWeekend)) {
          rowWarnings.push("Date falls on a weekend or public holiday - will be ignored");
        }
      }
    }

    // Validate user
    let matchedUser: typeof users[0] | undefined;
    if (!userNameRaw) {
      rowErrors.push("User name is required");
    } else {
      matchedUser = userByName.get(userNameRaw.toLowerCase());
      if (!matchedUser) {
        rowErrors.push(`User '${userNameRaw}' not found`);
      }
    }

    // Validate daily target
    let dailyTarget: number;
    if (dailyTargetRaw == null) {
      rowErrors.push("Daily target is required");
    } else {
      dailyTarget = Number(dailyTargetRaw);
      if (isNaN(dailyTarget)) {
        rowErrors.push("Daily target must be a number");
      } else if (dailyTarget < 0) {
        rowErrors.push("Daily target cannot be negative");
      }
    }

    // Validate backlog
    let backlogCarriedForward: number;
    backlogCarriedForward = Number(backlogRaw || 0);
    if (isNaN(backlogCarriedForward) || backlogCarriedForward < 0) {
      backlogCarriedForward = 0;
    }

    // Find matching branch plan target
    let matchedBranchPlanTarget = undefined;
    let metricId = undefined;
    let metricName = undefined;
    if (matchedUser && matchedUser.branchId && metricNameRaw) {
      const allTargetsForBranch = branchPlanTargets.filter(t => t.branchId === matchedUser.branchId);
      const matchingByMetric = allTargetsForBranch.find(t => 
        t.districtTarget.metric.name.toLowerCase() === metricNameRaw.toLowerCase()
      );
      if (matchingByMetric) {
        matchedBranchPlanTarget = matchingByMetric;
        metricId = matchingByMetric.districtTarget.metric.id;
        metricName = matchingByMetric.districtTarget.metric.name;
      } else {
        rowErrors.push(`Metric '${metricNameRaw}' not found for user's branch`);
      }
    } else if (matchedUser && matchedUser.branchId && branchPlanTargets.length > 0) {
      // If only one metric exists, assume that's the one
      const allTargetsForBranch = branchPlanTargets.filter(t => t.branchId === matchedUser.branchId);
      if (allTargetsForBranch.length === 1) {
        matchedBranchPlanTarget = allTargetsForBranch[0];
        metricId = allTargetsForBranch[0].districtTarget.metric.id;
        metricName = allTargetsForBranch[0].districtTarget.metric.name;
      }
    }

    preview.push({
      userId: matchedUser?.id || "",
      userName: matchedUser?.name || userNameRaw,
      date: date ? date.toISOString().split('T')[0] : "",
      dailyTarget: dailyTarget || 0,
      backlogCarriedForward,
      metricId,
      metricName,
      branchPlanTargetId: matchedBranchPlanTarget?.id,
      errors: rowErrors,
      warnings: rowWarnings,
      isNonWorkingDay: date ? isNonWorkingDay(date, publicHolidays, isWeekend) : false,
    });

    if (rowErrors.length > 0) {
      rowErrors.forEach(err => errors.push({ row: i + 1, message: err }));
    }
    if (rowWarnings.length > 0) {
      rowWarnings.forEach(warn => warnings.push({ row: i + 1, message: warn }));
    }
  }

  return {
    preview,
    errors,
    warnings,
    summary: {
      totalRows: fileData.length,
      validRows: preview.filter(r => r.errors?.length === 0 && !r.isNonWorkingDay).length,
      invalidRows: preview.filter(r => (r.errors?.length || 0) > 0).length,
      nonWorkingDays: preview.filter(r => r.isNonWorkingDay).length,
    },
  };
}

export async function importDailyPlanFromPreview(validatedData: {
  preview: ImportPreviewRow[];
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  // Filter out invalid rows and non-working days
  const rowsToImport = validatedData.preview.filter(
    r => (r.errors?.length || 0) === 0 && !r.isNonWorkingDay && r.branchPlanTargetId
  );

  if (rowsToImport.length === 0) {
    throw new Error("No valid rows to import");
  }

  try {
    // Delete existing daily targets for same branchPlanTarget, user, and date
    for (const row of rowsToImport) {
      await prisma.salesOfficerDailyTarget.deleteMany({
        where: {
          branchPlanTargetId: row.branchPlanTargetId,
          userId: row.userId,
          date: new Date(row.date),
        },
      });
    }

    // Create new daily targets
    const created = await Promise.all(
      rowsToImport.map(row =>
        prisma.salesOfficerDailyTarget.create({
          data: {
            branchPlanTargetId: row.branchPlanTargetId!,
            userId: row.userId,
            date: new Date(row.date),
            dailyTarget: row.dailyTarget,
            backlogCarriedForward: row.backlogCarriedForward,
            totalRequired: row.dailyTarget + row.backlogCarriedForward,
          },
        })
      )
    );

    revalidatePath("/dashboard/daily-targets");
    revalidatePath("/dashboard/branch-targets");
    
    return {
      success: true,
      count: created.length,
    };
  } catch (error) {
    console.error("Import failed:", error);
    throw new Error("Failed to import daily targets");
  }
}

export async function getImportTemplateData() {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  let branchId = user.branchId;
  let districtId = user.districtId;

  // Get users in branch/district
  let users = [];
  if (branchId) {
    users = await prisma.user.findMany({
      where: { branchId, status: "active" },
      select: { id: true, name: true, branchId: true },
    });
  } else if (districtId) {
    users = await prisma.user.findMany({
      where: { districtId, status: "active" },
      select: { id: true, name: true, branchId: true },
    });
  }

  // Get branch plan targets
  let branchPlanTargets = [];
  if (branchId) {
    branchPlanTargets = await prisma.branchPlanTarget.findMany({
      where: { branchId },
      include: { districtTarget: { include: { metric: true } }, branch: true },
      orderBy: { month: 'asc' },
    });
  } else if (districtId) {
    branchPlanTargets = await prisma.branchPlanTarget.findMany({
      where: { districtTarget: { assignment: { districtId } } },
      include: { districtTarget: { include: { metric: true } }, branch: true },
      orderBy: { month: 'asc' },
    });
  }

  return { users, branchPlanTargets };
}

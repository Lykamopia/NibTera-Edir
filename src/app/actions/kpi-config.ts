"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { getLoggedInUser } from "./auth";

export async function getKpiConfigs() {
  const user = await getLoggedInUser();
  if (!user) return [];

  try {
    return await prisma.kpiConfig.findMany({
      orderBy: { name: "asc" },
      include: { category: true },
    });
  } catch {
    return [];
  }
}

export async function getActiveKpiConfigs() {
  const user = await getLoggedInUser();
  if (!user) return [];

  try {
    return await prisma.kpiConfig.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { category: true },
    });
  } catch {
    return [];
  }
}

export async function createKpiConfig(data: {
  name: string;
  description?: string;
  requiresDistrictApproval: boolean;
  allowsManualAdjustment?: boolean;
  type?: "COUNT" | "CURRENCY";
  currency?: "ETB" | "USD" | "EUR" | "GBP";
  categoryId?: string | null;
}) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  // Check if user has permission
  const canManage = user.role?.permissions.includes("manage_kpi_config");
  if (!canManage) {
    throw new Error("Not authorized to manage KPI configurations");
  }

  try {
    const kpi = await prisma.kpiConfig.create({
      data: { ...data, categoryId: data.categoryId || null },
    });
    revalidatePath("/dashboard/admin/kpi-config");
    return { success: true, kpi };
  } catch (error) {
    console.error("Error creating KPI config:", error);
    throw new Error("Failed to create KPI configuration");
  }
}

export async function updateKpiConfig(
  id: string,
  data: {
    name?: string;
    description?: string;
    requiresDistrictApproval?: boolean;
    allowsManualAdjustment?: boolean;
    isActive?: boolean;
    type?: "COUNT" | "CURRENCY";
    currency?: "ETB" | "USD" | "EUR" | "GBP" | null;
    categoryId?: string | null;
  }
) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const canManage = user.role?.permissions.includes("manage_kpi_config");
  if (!canManage) {
    throw new Error("Not authorized to manage KPI configurations");
  }

  try {
    const kpi = await prisma.kpiConfig.update({
      where: { id },
      data: { ...data, categoryId: data.categoryId === undefined ? undefined : (data.categoryId || null) },
    });
    revalidatePath("/dashboard/admin/kpi-config");
    return { success: true, kpi };
  } catch (error) {
    console.error("Error updating KPI config:", error);
    throw new Error("Failed to update KPI configuration");
  }
}

export async function deleteKpiConfig(id: string) {
  const user = await getLoggedInUser();
  if (!user) throw new Error("Not authenticated");

  const canManage = user.role?.permissions.includes("manage_kpi_config");
  if (!canManage) {
    throw new Error("Not authorized to manage KPI configurations");
  }

  try {
    await prisma.kpiConfig.delete({ where: { id } });
    revalidatePath("/dashboard/admin/kpi-config");
    return { success: true };
  } catch (error) {
    console.error("Error deleting KPI config:", error);
    throw new Error("Failed to delete KPI configuration");
  }
}

// ─── KPI Categories ───────────────────────────────────────────────────────────
// First-class, admin-managed business groupings (Deposits, Loans, …). KPIs link
// to a category via KpiConfig.categoryId; reports group / filter / export by it.

export type KpiCategoryRow = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  color: string | null;
  order: number;
  isActive: boolean;
  kpiCount: number;
};

function assertCanManage(user: any) {
  if (!user) throw new Error("Not authenticated");
  if (!user.role?.permissions?.includes("manage_kpi_config"))
    throw new Error("Not authorized to manage KPI configurations");
}

/** List categories with how many KPIs are assigned to each. */
export async function getKpiCategories(opts: { activeOnly?: boolean } = {}): Promise<KpiCategoryRow[]> {
  const user = await getLoggedInUser();
  if (!user) return [];
  try {
    const cats = await prisma.kpiCategory.findMany({
      where: opts.activeOnly ? { isActive: true } : undefined,
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: { _count: { select: { kpis: true } } },
    });
    return cats.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      description: c.description,
      color: c.color,
      order: c.order,
      isActive: c.isActive,
      kpiCount: c._count.kpis,
    }));
  } catch {
    return [];
  }
}

export async function createKpiCategory(data: {
  name: string;
  code?: string | null;
  description?: string | null;
  color?: string | null;
  order?: number;
  isActive?: boolean;
}) {
  const user = await getLoggedInUser();
  assertCanManage(user);

  const name = data.name?.trim();
  if (!name) throw new Error("Category name is required.");

  try {
    const category = await prisma.kpiCategory.create({
      data: {
        name,
        code: data.code?.trim() || null,
        description: data.description?.trim() || null,
        color: data.color?.trim() || null,
        order: data.order ?? 0,
        isActive: data.isActive ?? true,
      },
    });
    revalidatePath("/dashboard/admin/kpi-config");
    revalidatePath("/dashboard/rm-report");
    return { success: true, category };
  } catch (error: any) {
    if (error?.code === "P2002") throw new Error("A category with that name or code already exists.");
    console.error("Error creating KPI category:", error);
    throw new Error("Failed to create category.");
  }
}

export async function updateKpiCategory(
  id: string,
  data: {
    name?: string;
    code?: string | null;
    description?: string | null;
    color?: string | null;
    order?: number;
    isActive?: boolean;
  }
) {
  const user = await getLoggedInUser();
  assertCanManage(user);

  try {
    const category = await prisma.kpiCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.code !== undefined ? { code: data.code?.trim() || null } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.color !== undefined ? { color: data.color?.trim() || null } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    revalidatePath("/dashboard/admin/kpi-config");
    revalidatePath("/dashboard/rm-report");
    return { success: true, category };
  } catch (error: any) {
    if (error?.code === "P2002") throw new Error("A category with that name or code already exists.");
    console.error("Error updating KPI category:", error);
    throw new Error("Failed to update category.");
  }
}

/** Delete a category. KPIs that referenced it are left uncategorized (FK SetNull). */
export async function deleteKpiCategory(id: string) {
  const user = await getLoggedInUser();
  assertCanManage(user);

  try {
    await prisma.kpiCategory.delete({ where: { id } });
    revalidatePath("/dashboard/admin/kpi-config");
    revalidatePath("/dashboard/rm-report");
    return { success: true };
  } catch (error) {
    console.error("Error deleting KPI category:", error);
    throw new Error("Failed to delete category.");
  }
}

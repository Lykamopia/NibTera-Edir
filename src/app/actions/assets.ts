'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, tenantWhere } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notification-helpers';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';

/** Tenant-wide asset KPIs for the summary cards (filtered by registration date). */
export async function getAssetSummary(range?: DateRangeParam) {
  const actor = await getActor();
  await assertPermission(actor, ['view_assets', 'manage_assets']);
  const where = { ...tenantWhere(actor), ...dateWhere('createdAt', range) };
  const [agg, categories, openIssuances, settings] = await Promise.all([
    prisma.asset.aggregate({ _sum: { currentValue: true, purchaseValue: true, quantity: true, issuedQuantity: true }, _count: { _all: true }, where }),
    prisma.assetCategory.count({ where: tenantWhere(actor) }),
    prisma.assetIssuance.count({ where: { asset: where, status: { in: ['ISSUED', 'COMPENSATION_PENDING'] } } }),
    actor.edirId || actor.isSuperAdmin ? prisma.edirSettings.findFirst({ where: actor.isSuperAdmin ? {} : { edirId: actor.edirId! } }) : Promise.resolve(null),
  ]);
  const totalUnits = agg._sum.quantity ?? 0;
  const issuedUnits = agg._sum.issuedQuantity ?? 0;
  return {
    currency: settings?.currency ?? 'ETB',
    count: agg._count._all,
    categories,
    totalValue: Number(agg._sum.currentValue ?? 0),
    purchaseValue: Number(agg._sum.purchaseValue ?? 0),
    totalUnits,
    issuedUnits,
    availableUnits: totalUnits - issuedUnits,
    utilization: totalUnits > 0 ? Math.round((issuedUnits / totalUnits) * 100) : 0,
    activeIssuances: openIssuances,
  };
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function getAssetCategories() {
  const actor = await getActor();
  await assertPermission(actor, ['view_assets', 'manage_assets', 'manage_asset_categories']);
  return prisma.assetCategory.findMany({ where: tenantWhere(actor), orderBy: { name: 'asc' } });
}

const categorySchema = z.object({ id: z.string().optional(), name: z.string().min(2, 'Name is required.') });

export async function saveAssetCategory(input: z.infer<typeof categorySchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_asset_categories');
    const data = categorySchema.parse(input);
    if (data.id) {
      const existing = await prisma.assetCategory.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Category not found.' };
      await assertSameTenant(actor, existing.edirId);
      await prisma.assetCategory.update({ where: { id: data.id }, data: { name: data.name } });
    } else {
      await prisma.assetCategory.create({ data: { edirId, name: data.name } });
    }
    await writeAudit({ edirId, userId: actor.id, action: data.id ? 'ASSET_CATEGORY_UPDATED' : 'ASSET_CATEGORY_CREATED', targetType: 'AssetCategory', targetId: data.id, details: data.name });
    revalidatePath('/dashboard/assets');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAssetCategory(id: string) {
  try {
    const { actor, edirId } = await requireActor('manage_asset_categories');
    const existing = await prisma.assetCategory.findUnique({ where: { id } });
    if (!existing) return { success: false as const, error: 'Category not found.' };
    await assertSameTenant(actor, existing.edirId);
    await prisma.assetCategory.delete({ where: { id } }); // assets keep history (categoryId set null)
    await writeAudit({ edirId, userId: actor.id, action: 'ASSET_CATEGORY_DELETED', targetType: 'AssetCategory', targetId: id, details: existing.name });
    revalidatePath('/dashboard/assets');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Assets (inventory) ──────────────────────────────────────────────────────

export async function getAssets(params: { status?: string; query?: string; categoryId?: string; range?: DateRangeParam } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_assets', 'manage_assets']);
  const where: Prisma.AssetWhereInput = {
    ...tenantWhere(actor),
    ...dateWhere('createdAt', params.range),
    ...(params.status && params.status !== 'all' ? { status: params.status } : {}),
    ...(params.categoryId && params.categoryId !== 'all' ? { categoryId: params.categoryId } : {}),
    ...(params.query ? { name: { contains: params.query, mode: 'insensitive' } } : {}),
  };
  const assets = await prisma.asset.findMany({ where, include: { category: { select: { name: true } } }, orderBy: { name: 'asc' } });
  return assets.map(a => ({
    id: a.id, name: a.name, categoryId: a.categoryId, categoryName: a.category?.name ?? null,
    purchaseValue: Number(a.purchaseValue), currentValue: Number(a.currentValue),
    quantity: a.quantity, issuedQuantity: a.issuedQuantity, available: a.quantity - a.issuedQuantity,
    condition: a.condition, location: a.location, status: a.status,
    compensationCost: Number(a.compensationCost),
  }));
}

const assetSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Name is required.'),
  categoryId: z.string().optional().nullable(),
  purchaseValue: z.coerce.number().min(0).default(0),
  currentValue: z.coerce.number().min(0).optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  condition: z.string().default('good'),
  location: z.string().optional().nullable(),
  compensationCost: z.coerce.number().min(0).default(0),
});

export async function saveAsset(input: z.infer<typeof assetSchema>) {
  try {
    const { actor, edirId } = await requireActor(input.id ? ['edit_asset', 'manage_assets'] : ['create_asset', 'manage_assets']);
    const data = assetSchema.parse(input);
    if (data.categoryId) {
      const cat = await prisma.assetCategory.findUnique({ where: { id: data.categoryId } });
      if (!cat || cat.edirId !== edirId) return { success: false as const, error: 'Invalid category.' };
    }
    const currentValue = data.currentValue != null ? data.currentValue : data.purchaseValue;

    if (data.id) {
      const existing = await prisma.asset.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Asset not found.' };
      await assertSameTenant(actor, existing.edirId);
      if (data.quantity < existing.issuedQuantity) {
        return { success: false as const, error: `Quantity cannot be below the ${existing.issuedQuantity} already issued.` };
      }
      await prisma.asset.update({
        where: { id: data.id },
        data: {
          name: data.name, categoryId: data.categoryId || null,
          purchaseValue: new Prisma.Decimal(data.purchaseValue), currentValue: new Prisma.Decimal(currentValue),
          quantity: data.quantity, condition: data.condition, location: data.location || null,
          compensationCost: new Prisma.Decimal(data.compensationCost),
        },
      });
      await writeAudit({ edirId, userId: actor.id, action: 'ASSET_UPDATED', targetType: 'Asset', targetId: data.id, details: data.name });
    } else {
      const created = await prisma.asset.create({
        data: {
          edirId, name: data.name, categoryId: data.categoryId || null,
          purchaseValue: new Prisma.Decimal(data.purchaseValue), currentValue: new Prisma.Decimal(currentValue),
          quantity: data.quantity, condition: data.condition, location: data.location || null,
          compensationCost: new Prisma.Decimal(data.compensationCost), status: 'available',
        },
      });
      await writeAudit({ edirId, userId: actor.id, action: 'ASSET_CREATED', targetType: 'Asset', targetId: created.id, details: data.name });
    }
    revalidatePath('/dashboard/assets');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAsset(id: string) {
  try {
    const { actor, edirId } = await requireActor(['delete_asset', 'manage_assets']);
    const existing = await prisma.asset.findUnique({ where: { id }, include: { _count: { select: { issuances: true } } } });
    if (!existing) return { success: false as const, error: 'Asset not found.' };
    await assertSameTenant(actor, existing.edirId);
    if (existing.issuedQuantity > 0) return { success: false as const, error: 'Return all issued units before deleting this asset.' };
    await prisma.asset.delete({ where: { id } });
    await writeAudit({ edirId, userId: actor.id, action: 'ASSET_DELETED', targetType: 'Asset', targetId: id, details: existing.name });
    revalidatePath('/dashboard/assets');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Issuances ───────────────────────────────────────────────────────────────

const OPEN_STATUSES: Prisma.ApprovalRequestWhereInput['status'] = { in: ['PENDING', 'RETURNED'] };

export async function getIssuances(params: { status?: string; range?: DateRangeParam } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_assets', 'manage_assets']);
  const where: Prisma.AssetIssuanceWhereInput = {
    asset: tenantWhere(actor),
    ...dateWhere('createdAt', params.range),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
  };
  const issuances = await prisma.assetIssuance.findMany({
    where,
    include: { asset: { select: { name: true, compensationCost: true } }, member: { select: { name: true, memberId: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const open = await prisma.approvalRequest.findMany({
    where: { ...tenantWhere(actor), module: 'ASSET_ISSUANCE', status: OPEN_STATUSES, targetId: { in: issuances.map(i => i.id) } },
    select: { targetId: true },
  });
  const openSet = new Set(open.map(o => o.targetId));

  return issuances.map(i => ({
    id: i.id,
    assetName: i.asset?.name ?? null,
    compensationCost: Number(i.asset?.compensationCost ?? 0),
    memberName: i.member?.name ?? null,
    memberCode: i.member?.memberId ?? null,
    status: i.status,
    issuedQty: i.issuedQty,
    returnedQty: i.returnedQty,
    condition: i.condition,
    compensation: i.compensation != null ? Number(i.compensation) : null,
    createdAt: i.createdAt,
    hasOpenRequest: openSet.has(i.id),
  }));
}

const issueSchema = z.object({
  assetId: z.string().min(1),
  memberId: z.string().min(1, 'A member is required.'),
  qty: z.coerce.number().int().min(1).default(1),
});

/** Maker requests issuing an asset to a member (ASSET_ISSUANCE Maker–Checker). */
export async function requestIssuance(input: z.infer<typeof issueSchema>) {
  try {
    const { actor, edirId } = await requireActor(['issue_asset', 'manage_assets']);
    const data = issueSchema.parse(input);

    const asset = await prisma.asset.findUnique({ where: { id: data.assetId } });
    if (!asset) return { success: false as const, error: 'Asset not found.' };
    await assertSameTenant(actor, asset.edirId);
    const available = asset.quantity - asset.issuedQuantity;
    if (data.qty > available) return { success: false as const, error: `Only ${available} unit(s) available.` };

    const member = await prisma.member.findUnique({ where: { id: data.memberId } });
    if (!member || member.edirId !== edirId) return { success: false as const, error: 'Invalid member.' };

    const issuance = await prisma.assetIssuance.create({
      data: { assetId: asset.id, memberId: member.id, status: 'REQUESTED', issuedQty: data.qty },
    });

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'ASSET_ISSUANCE',
      title: `Issue ${data.qty} × ${asset.name} to ${member.name}`,
      summary: `${available} of ${asset.quantity} available before issuance.`,
      payload: { issuanceId: issuance.id, assetId: asset.id, qty: data.qty },
      targetType: 'AssetIssuance',
      targetId: issuance.id,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'ASSET_ISSUANCE_REQUESTED', targetType: 'AssetIssuance', targetId: issuance.id, details: `${data.qty} × ${asset.name} → ${member.name}` });
    revalidatePath('/dashboard/assets');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

const returnSchema = z.object({
  issuanceId: z.string().min(1),
  returnedQty: z.coerce.number().int().min(1),
  condition: z.string().optional().nullable(),
  compensation: z.coerce.number().min(0).default(0),
});

/**
 * Submit an asset return for Maker–Checker approval. The asset is NOT freed and
 * the member is NOT charged until a checker approves — the ASSET_RETURN executor
 * applies the return (frees inventory, applies any loss/damage compensation).
 */
export async function recordReturn(input: z.infer<typeof returnSchema>) {
  try {
    const { actor, edirId } = await requireActor(['return_asset', 'manage_assets']);
    const data = returnSchema.parse(input);

    const issuance = await prisma.assetIssuance.findUnique({ where: { id: data.issuanceId }, include: { asset: true, member: true } });
    if (!issuance) return { success: false as const, error: 'Issuance not found.' };
    await assertSameTenant(actor, issuance.asset.edirId);
    if (issuance.status !== 'ISSUED') return { success: false as const, error: 'Only issued assets can be returned.' };
    if (data.returnedQty > issuance.issuedQty) return { success: false as const, error: `Cannot return more than the ${issuance.issuedQty} issued.` };

    // Block duplicate pending returns for the same issuance.
    const openReturn = await prisma.approvalRequest.findFirst({
      where: { module: 'ASSET_RETURN', targetId: issuance.id, status: { in: ['PENDING', 'RETURNED'] } },
      select: { id: true },
    });
    if (openReturn) return { success: false as const, error: 'A return for this asset is already awaiting approval.' };

    const compensation = data.compensation;
    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'ASSET_RETURN',
      title: `Asset return: ${data.returnedQty} × ${issuance.asset.name}`,
      summary: `${issuance.member?.name ?? 'Member'} returning ${data.returnedQty} × ${issuance.asset.name}${compensation > 0 ? ` · compensation ${compensation}` : ''}${data.condition ? ` · ${data.condition}` : ''}`,
      payload: { issuanceId: issuance.id, returnedQty: data.returnedQty, condition: data.condition || null, compensation },
      targetType: 'AssetIssuance', targetId: issuance.id,
    });

    await writeAudit({
      edirId, userId: actor.id, action: 'ASSET_RETURN_REQUESTED', targetType: 'AssetIssuance', targetId: issuance.id,
      details: `Return submitted for approval: ${data.returnedQty} × ${issuance.asset.name}${compensation > 0 ? ` with ${compensation} compensation` : ''}.`,
    });

    revalidatePath('/dashboard/assets');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId, pendingApproval: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Valuation / depreciation report ─────────────────────────────────────────

export async function getDepreciationReport() {
  const actor = await getActor();
  await assertPermission(actor, ['view_assets', 'manage_assets']);
  const assets = await prisma.asset.findMany({ where: tenantWhere(actor), include: { category: { select: { name: true } } }, orderBy: { name: 'asc' } });

  const rows = assets.map(a => {
    const purchase = Number(a.purchaseValue) * a.quantity;
    const current = Number(a.currentValue) * a.quantity;
    return {
      id: a.id, name: a.name, categoryName: a.category?.name ?? 'Uncategorized',
      quantity: a.quantity,
      purchaseValue: Number(a.purchaseValue), currentValue: Number(a.currentValue),
      totalPurchase: purchase, totalCurrent: current,
      depreciation: purchase - current,
      depreciationPct: purchase > 0 ? Math.round(((purchase - current) / purchase) * 100) : 0,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({ purchase: t.purchase + r.totalPurchase, current: t.current + r.totalCurrent, depreciation: t.depreciation + r.depreciation }),
    { purchase: 0, current: 0, depreciation: 0 },
  );

  return { rows, totals };
}

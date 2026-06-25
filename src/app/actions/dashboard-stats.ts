'use server';

import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';

function failure(error: unknown) {
  console.error('Dashboard stats error:', error);
  return { success: false as const, error: error instanceof Error ? error.message : 'Failed to load stats' };
}

export async function getBranchStats(branchId: string, range?: DateRangeParam) {
  try {
    const actor = await getActor();
    const memDate = dateWhere('joinDate', range);
    const txDate = dateWhere('createdAt', range);

    // Only branch users, district users, or super-admin can view
    if (actor.orgScope === 'BRANCH' && actor.branchId && actor.branchId !== branchId) {
      return failure(new Error('Permission denied'));
    }
    if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { districtId: true },
      });
      if (!branch || branch.districtId !== actor.districtId) {
        return failure(new Error('Permission denied'));
      }
    } else if (!actor.isSuperAdmin && actor.orgScope !== 'BRANCH') {
      return failure(new Error('Permission denied'));
    }

    const [totalEdirs, activeEdirs, pendingEdirs, totalMembers, paymentsCollected, pendingApprovals] =
      await Promise.all([
        prisma.edir.count({ where: { branchId } }),
        prisma.edir.count({ where: { branchId, status: 'ACTIVE' } }),
        prisma.edir.count({ where: { branchId, status: 'PENDING' } }),
        prisma.member.count({
          where: { edir: { branchId }, ...memDate },
        }),
        prisma.paymentLog.aggregate({
          where: { edir: { branchId }, status: 'PAID', ...txDate },
          _sum: { amount: true },
        }),
        prisma.approvalRequest.count({
          where: { edir: { branchId }, status: 'PENDING' },
        }),
      ]);

    return {
      success: true as const,
      data: {
        totalEdirs,
        activeEdirs,
        pendingEdirs,
        totalMembers,
        paymentsCollected: Number(paymentsCollected._sum.amount ?? 0),
        pendingApprovals,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function getDistrictStats(districtId: string, range?: DateRangeParam) {
  try {
    const actor = await getActor();
    const memDate = dateWhere('joinDate', range);
    const txDate = dateWhere('createdAt', range);

    // Only district users or super-admin can view
    if (actor.orgScope === 'DISTRICT' && actor.districtId && actor.districtId !== districtId) {
      return failure(new Error('Permission denied'));
    } else if (!actor.isSuperAdmin && actor.orgScope !== 'DISTRICT') {
      return failure(new Error('Permission denied'));
    }

    const [branches, totalEdirs, activeEdirs, totalMembers, paymentsCollected] = await Promise.all([
      prisma.branch.findMany({
        where: { districtId },
        select: { id: true, name: true },
      }),
      prisma.edir.count({
        where: { branch: { districtId } },
      }),
      prisma.edir.count({
        where: { branch: { districtId }, status: 'ACTIVE' },
      }),
      prisma.member.count({
        where: { edir: { branch: { districtId } }, ...memDate },
      }),
      prisma.paymentLog.aggregate({
        where: { edir: { branch: { districtId } }, status: 'PAID', ...txDate },
        _sum: { amount: true },
      }),
    ]);

    // Get per-branch stats
    const branchStats = await Promise.all(
      branches.map(async (branch) => {
        const [edirs, activeCount, members, collected] = await Promise.all([
          prisma.edir.count({ where: { branchId: branch.id } }),
          prisma.edir.count({ where: { branchId: branch.id, status: 'ACTIVE' } }),
          prisma.member.count({ where: { edir: { branchId: branch.id }, ...memDate } }),
          prisma.paymentLog.aggregate({
            where: { edir: { branchId: branch.id }, status: 'PAID', ...txDate },
            _sum: { amount: true },
          }),
        ]);
        return {
          id: branch.id,
          name: branch.name,
          edirs,
          activeEdirs: activeCount,
          members,
          collected: Number(collected._sum.amount ?? 0),
        };
      })
    );

    return {
      success: true as const,
      data: {
        totalBranches: branches.length,
        totalEdirs,
        activeEdirs,
        totalMembers,
        paymentsCollected: Number(paymentsCollected._sum.amount ?? 0),
        branches: branchStats,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function getRecentActivities(scope: 'BRANCH' | 'DISTRICT' | 'HEAD_OFFICE', scopeId?: string) {
  try {
    const actor = await getActor();

    // Validate scope access
    if (scope === 'BRANCH' && actor.orgScope !== 'BRANCH' && actor.orgScope !== 'HEAD_OFFICE' && !actor.isSuperAdmin) {
      return failure(new Error('Permission denied'));
    }
    if (scope === 'DISTRICT' && actor.orgScope !== 'DISTRICT' && actor.orgScope !== 'HEAD_OFFICE' && !actor.isSuperAdmin) {
      return failure(new Error('Permission denied'));
    }

    const where: any = {};
    if (scope === 'BRANCH' && scopeId) {
      where.edir = { branchId: scopeId };
    } else if (scope === 'DISTRICT' && scopeId) {
      where.edir = { branch: { districtId: scopeId } };
    }

    const activities = await prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      success: true as const,
      data: activities.map((a) => ({
        id: a.id,
        type: a.action.includes('CREATED') ? 'create' : a.action.includes('UPDATED') ? 'update' : 'other',
        description: a.details || a.action,
        userName: a.user?.name || a.user?.email || 'System',
        timestamp: a.createdAt,
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

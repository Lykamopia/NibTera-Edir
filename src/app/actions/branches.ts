'use server';

import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';

function failure(error: unknown): { success: false; error: string } {
  console.error('Branch action error:', error);
  const message = error instanceof Error ? error.message : 'An error occurred';
  return { success: false, error: message };
}

export async function getBranches(districtId?: string | null) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_branches', 'manage_districts', 'super_admin']);

    // District users can only see branches in their district
    const where: any = {};
    if (districtId) {
      where.districtId = districtId;
    } else if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      where.districtId = actor.districtId;
    }

    const branches = await prisma.branch.findMany({
      where,
      include: {
        district: { select: { id: true, name: true } },
        _count: { select: { edirs: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true as const,
      data: branches.map(b => ({
        id: b.id,
        name: b.name,
        code: b.code,
        description: b.description,
        districtId: b.districtId,
        districtName: b.district.name,
        edirs: b._count.edirs,
        createdAt: b.createdAt,
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveBranch(input: { id?: string; name: string; code: string; districtId: string; description?: string }) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_branches', 'manage_districts', 'super_admin']);

    const name = input.name?.trim();
    const code = input.code?.trim();

    if (!name) return { success: false as const, error: 'Branch name is required.' };
    if (!code) return { success: false as const, error: 'Branch code is required.' };
    if (!input.districtId) return { success: false as const, error: 'District is required.' };

    // Verify district exists
    const district = await prisma.district.findUnique({ where: { id: input.districtId } });
    if (!district) return { success: false as const, error: 'Selected district not found.' };

    // District users can only manage branches in their district
    if (actor.orgScope === 'DISTRICT' && actor.districtId && actor.districtId !== input.districtId) {
      return { success: false as const, error: 'You can only manage branches in your district.' };
    }

    if (input.id) {
      await prisma.branch.update({
        where: { id: input.id },
        data: { name, code, districtId: input.districtId, description: input.description ?? null },
      });
      await writeAudit({
        userId: actor.id,
        action: 'BRANCH_UPDATED',
        targetType: 'Branch',
        targetId: input.id,
        details: `Updated branch: ${name}`,
      });
    } else {
      const branch = await prisma.branch.create({
        data: { name, code, districtId: input.districtId, description: input.description ?? null },
      });
      await writeAudit({
        userId: actor.id,
        action: 'BRANCH_CREATED',
        targetType: 'Branch',
        targetId: branch.id,
        details: `Created branch: ${name}`,
      });
    }

    revalidatePath('/dashboard/system/branches');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBranch(id: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_branches', 'manage_districts', 'super_admin']);

    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) return { success: false as const, error: 'Branch not found.' };

    // District users can only manage branches in their district
    if (actor.orgScope === 'DISTRICT' && actor.districtId && actor.districtId !== branch.districtId) {
      return { success: false as const, error: 'You can only manage branches in your district.' };
    }

    // Check if branch has Edirs
    const edirCount = await prisma.edir.count({ where: { branchId: id } });
    if (edirCount > 0) {
      return { success: false as const, error: 'Cannot delete a branch with registered Edirs. Remove or reassign Edirs first.' };
    }

    await prisma.branch.delete({ where: { id } });
    await writeAudit({
      userId: actor.id,
      action: 'BRANCH_DELETED',
      targetType: 'Branch',
      targetId: id,
      details: `Deleted branch: ${branch.name}`,
    });

    revalidatePath('/dashboard/system/branches');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

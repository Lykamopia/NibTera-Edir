'use server';

import { getActor, assertPermission, requireActor } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit-logger';

function failure(error: unknown): { success: false; error: string } {
  console.error('District action error:', error);
  const message = error instanceof Error ? error.message : 'An error occurred';
  return { success: false, error: message };
}

export async function getDistricts() {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_districts', 'super_admin']);

    const districts = await prisma.district.findMany({
      include: {
        _count: { select: { branches: true } },
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true as const,
      data: districts.map(d => ({
        id: d.id,
        name: d.name,
        code: d.code,
        description: d.description,
        branches: d._count.branches,
        createdAt: d.createdAt,
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveDistrict(input: { id?: string; name: string; code: string; description?: string }) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_districts', 'super_admin']);

    const name = input.name?.trim();
    const code = input.code?.trim();

    if (!name) return { success: false as const, error: 'District name is required.' };
    if (!code) return { success: false as const, error: 'District code is required.' };

    if (input.id) {
      await prisma.district.update({
        where: { id: input.id },
        data: { name, code, description: input.description ?? null },
      });
      await writeAudit({
        userId: actor.id,
        action: 'DISTRICT_UPDATED',
        targetType: 'District',
        targetId: input.id,
        details: `Updated district: ${name}`,
      });
    } else {
      const district = await prisma.district.create({
        data: { name, code, description: input.description ?? null },
      });
      await writeAudit({
        userId: actor.id,
        action: 'DISTRICT_CREATED',
        targetType: 'District',
        targetId: district.id,
        details: `Created district: ${name}`,
      });
    }

    revalidatePath('/dashboard/system/districts');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDistrict(id: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_districts', 'super_admin']);

    const district = await prisma.district.findUnique({ where: { id } });
    if (!district) return { success: false as const, error: 'District not found.' };

    // Check if district has branches
    const branchCount = await prisma.branch.count({ where: { districtId: id } });
    if (branchCount > 0) {
      return { success: false as const, error: 'Cannot delete a district with branches. Remove branches first.' };
    }

    await prisma.district.delete({ where: { id } });
    await writeAudit({
      userId: actor.id,
      action: 'DISTRICT_DELETED',
      targetType: 'District',
      targetId: id,
      details: `Deleted district: ${district.name}`,
    });

    revalidatePath('/dashboard/system/districts');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

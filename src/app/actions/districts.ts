'use server';

import { z } from 'zod';
import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import { failure } from '@/lib/action-result';
import { zId, zName, zCode, zOptionalText } from '@/lib/validation';

const DISTRICT_MANAGER_PERMISSIONS = [
  'view_dashboard', 'view_districts', 'manage_branches', 'view_branches',
  'register_edir', 'approve_edir_registration', 'approve_edir_update',
  'view_members', 'manage_members', 'view_payments', 'record_payment',
  'view_approvals', 'view_audit_log', 'view_district_dashboard',
  // Manage the district's own platform users (branch/district operators) and
  // recover Edir user credentials within the district.
  'view_users', 'manage_users', 'reset_password', 'lock_user', 'unlock_user',
];
const DISTRICT_OPERATOR_PERMISSIONS = [
  'view_dashboard', 'view_districts', 'view_branches', 'register_edir', 'view_members', 'view_district_dashboard',
  'view_users',
];

/** Provision the default District Manager / Operator roles for a new district. */
async function provisionDistrictRoles(districtId: string) {
  await prisma.role.createMany({
    data: [
      { name: 'District Manager', scope: 'DISTRICT', districtId, permissions: DISTRICT_MANAGER_PERMISSIONS.join(',') },
      { name: 'District Operator', scope: 'DISTRICT', districtId, permissions: DISTRICT_OPERATOR_PERMISSIONS.join(',') },
    ],
  });
}

export async function getDistricts() {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['view_districts', 'manage_districts', 'create_district', 'edit_district', 'super_admin']);

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
    input = z.object({ id: zId.optional(), name: zName('District name', 120), code: zCode('District code'), description: zOptionalText('Description', { max: 500, multiline: true }) }).parse(input) as typeof input;
    const actor = await getActor();
    await assertPermission(actor, input.id ? ['edit_district', 'manage_districts', 'super_admin'] : ['create_district', 'manage_districts', 'super_admin']);

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

      // Auto-provision default roles for the district
      await provisionDistrictRoles(district.id);

      await writeAudit({
        userId: actor.id,
        action: 'DISTRICT_CREATED',
        targetType: 'District',
        targetId: district.id,
        details: `Created district: ${name} with default roles`,
      });
    }

    revalidatePath('/dashboard/system/districts');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

const importDistrictRow = z.object({
  name: zName('Name', 120),
  code: zCode('Code'),
  description: zOptionalText('Description', { max: 500, multiline: true }),
});

export interface ImportResult {
  success: true;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/**
 * Bulk create/update districts from imported rows. Matches existing districts by
 * `code` (then `name`) to support updates; new districts get their default roles.
 * Returns per-row error reporting.
 */
export async function importDistricts(rows: unknown[]): Promise<ImportResult | { success: false; error: string }> {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['import_districts', 'manage_districts', 'super_admin']);
    if (!Array.isArray(rows) || rows.length === 0) return { success: false as const, error: 'No rows to import.' };
    if (rows.length > 1000) return { success: false as const, error: 'Too many rows (max 1000 per import).' };

    let created = 0, updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const parsed = importDistrictRow.safeParse(rows[i]);
      if (!parsed.success) { errors.push({ row: i + 2, message: parsed.error.issues[0]?.message ?? 'Invalid row' }); continue; }
      const { name, code, description } = parsed.data;
      try {
        const existing = await prisma.district.findFirst({ where: { OR: [{ code }, { name }] } });
        if (existing) {
          await prisma.district.update({ where: { id: existing.id }, data: { name, code, description: description ?? null } });
          updated++;
        } else {
          const d = await prisma.district.create({ data: { name, code, description: description ?? null } });
          await provisionDistrictRoles(d.id);
          created++;
        }
      } catch (e: any) {
        const msg = e?.code === 'P2002' ? 'Duplicate name or code conflicts with another district.' : (e instanceof Error ? e.message : 'Failed to import row.');
        errors.push({ row: i + 2, message: msg });
      }
    }

    await writeAudit({ userId: actor.id, action: 'DISTRICTS_IMPORTED', targetType: 'District', targetId: null, details: `Imported districts: ${created} created, ${updated} updated, ${errors.length} error(s).` });
    revalidatePath('/dashboard/system/districts');
    return { success: true as const, created, updated, errors };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDistrict(id: string) {
  try {
    id = zId.parse(id);
    const actor = await getActor();
    await assertPermission(actor, ['delete_district', 'manage_districts', 'super_admin']);

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

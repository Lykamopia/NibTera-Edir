'use server';

import { z } from 'zod';
import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import { failure } from '@/lib/action-result';

const BRANCH_MANAGER_PERMISSIONS = [
  'view_dashboard', 'view_branches',
  'register_edir', 'approve_edir_registration', 'approve_edir_update',
  'view_members', 'manage_members',
  'view_payments', 'record_payment', 'approve_payment',
  'view_approvals', 'view_audit_log', 'view_branch_dashboard',
  // Manage the branch's own platform users and recover the credentials of the
  // branch's Edir users (e.g. Edir Admin password resets).
  'view_users', 'manage_users', 'reset_password', 'lock_user', 'unlock_user',
];
const BRANCH_OPERATOR_PERMISSIONS = [
  'view_dashboard', 'view_branches', 'register_edir', 'view_members', 'view_payments', 'view_branch_dashboard',
  'view_users',
];

/** Provision the default Branch Manager / Operator roles for a new branch. */
async function provisionBranchRoles(branchId: string) {
  await prisma.role.createMany({
    data: [
      { name: 'Branch Manager', scope: 'BRANCH', branchId, permissions: BRANCH_MANAGER_PERMISSIONS.join(',') },
      { name: 'Branch Operator', scope: 'BRANCH', branchId, permissions: BRANCH_OPERATOR_PERMISSIONS.join(',') },
    ],
  });
}

export async function getBranches(districtId?: string | null) {
  try {
    const actor = await getActor();
    // Edir registrars/managers also read branches to pick one when registering an Edir.
    await assertPermission(actor, ['view_branches', 'manage_branches', 'create_branch', 'edit_branch', 'manage_districts', 'register_edir', 'approve_edir_registration', 'manage_edirs', 'create_edir', 'super_admin']);

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
    await assertPermission(actor, input.id ? ['edit_branch', 'manage_branches', 'manage_districts', 'super_admin'] : ['create_branch', 'manage_branches', 'manage_districts', 'super_admin']);

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

      // Auto-provision default roles for the branch
      await provisionBranchRoles(branch.id);

      await writeAudit({
        userId: actor.id,
        action: 'BRANCH_CREATED',
        targetType: 'Branch',
        targetId: branch.id,
        details: `Created branch: ${name} with default roles`,
      });
    }

    revalidatePath('/dashboard/system/branches');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

const importBranchRow = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  code: z.string().trim().min(1, 'Code is required'),
  district: z.string().trim().min(1, 'District (code or name) is required'),
  description: z.string().trim().optional().nullable(),
});

export interface ImportResult {
  success: true;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/**
 * Bulk create/update branches from imported rows. The `district` column matches a
 * district by code or name. Branches match by `code` for updates; new branches get
 * their default roles. District-scoped users may only import into their district.
 */
export async function importBranches(rows: unknown[]): Promise<ImportResult | { success: false; error: string }> {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['import_branches', 'manage_branches', 'manage_districts', 'super_admin']);
    if (!Array.isArray(rows) || rows.length === 0) return { success: false as const, error: 'No rows to import.' };
    if (rows.length > 1000) return { success: false as const, error: 'Too many rows (max 1000 per import).' };

    let created = 0, updated = 0;
    const errors: { row: number; message: string }[] = [];
    const districtCache = new Map<string, { id: string; name: string } | null>();

    const resolveDistrict = async (key: string) => {
      if (districtCache.has(key)) return districtCache.get(key)!;
      const d = await prisma.district.findFirst({ where: { OR: [{ code: key }, { name: key }] }, select: { id: true, name: true } });
      districtCache.set(key, d);
      return d;
    };

    for (let i = 0; i < rows.length; i++) {
      const parsed = importBranchRow.safeParse(rows[i]);
      if (!parsed.success) { errors.push({ row: i + 2, message: parsed.error.issues[0]?.message ?? 'Invalid row' }); continue; }
      const { name, code, district, description } = parsed.data;
      try {
        const dist = await resolveDistrict(district);
        if (!dist) { errors.push({ row: i + 2, message: `District "${district}" not found.` }); continue; }
        if (actor.orgScope === 'DISTRICT' && actor.districtId && actor.districtId !== dist.id) {
          errors.push({ row: i + 2, message: 'Outside your district scope.' }); continue;
        }
        const existing = await prisma.branch.findFirst({ where: { code } });
        if (existing) {
          await prisma.branch.update({ where: { id: existing.id }, data: { name, code, districtId: dist.id, description: description ?? null } });
          updated++;
        } else {
          const b = await prisma.branch.create({ data: { name, code, districtId: dist.id, description: description ?? null } });
          await provisionBranchRoles(b.id);
          created++;
        }
      } catch (e: any) {
        const msg = e?.code === 'P2002' ? 'Duplicate code or a branch with this name already exists in the district.' : (e instanceof Error ? e.message : 'Failed to import row.');
        errors.push({ row: i + 2, message: msg });
      }
    }

    await writeAudit({ userId: actor.id, action: 'BRANCHES_IMPORTED', targetType: 'Branch', targetId: null, details: `Imported branches: ${created} created, ${updated} updated, ${errors.length} error(s).` });
    revalidatePath('/dashboard/system/branches');
    return { success: true as const, created, updated, errors };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBranch(id: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['delete_branch', 'manage_branches', 'manage_districts', 'super_admin']);

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

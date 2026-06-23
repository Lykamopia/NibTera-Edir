'use server';

import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import { isValidEthiopianPhone, normalizeEthiopianPhone, normalizeNibEmail } from '@/lib/utils';

function failure(error: unknown): { success: false; error: string } {
  console.error('User management error:', error);
  const message = error instanceof Error ? error.message : 'An error occurred';
  return { success: false, error: message };
}

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase();
}

export async function createBranchUser(input: {
  email: string;
  phone: string;
  name: string;
  branchId: string;
  roleId?: string;
}) {
  try {
    const actor = await getActor();

    // Only Super-Admin or District users can create branch users
    if (!actor.isSuperAdmin && actor.orgScope !== 'DISTRICT') {
      return { success: false as const, error: 'Permission denied.' };
    }

    // District users can only create users in their district's branches
    if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      const branch = await prisma.branch.findUnique({
        where: { id: input.branchId },
        select: { districtId: true },
      });
      if (!branch || branch.districtId !== actor.districtId) {
        return { success: false as const, error: 'Cannot create users in branches outside your district.' };
      }
    }

    // Verify branch exists
    const branch = await prisma.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, name: true },
    });
    if (!branch) return { success: false as const, error: 'Branch not found.' };

    // Validate inputs
    if (!isValidEthiopianPhone(input.phone)) return { success: false as const, error: 'Invalid phone number.' };
    if (!input.name?.trim()) return { success: false as const, error: 'Name is required.' };

    const phone = normalizeEthiopianPhone(input.phone);
    const email = normalizeNibEmail(input.email);

    // Check for duplicates
    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'Email already in use.' };
    if (phoneTaken) return { success: false as const, error: 'Phone already in use.' };

    // Verify and validate role if provided
    if (input.roleId) {
      const role = await prisma.role.findUnique({
        where: { id: input.roleId },
        select: { scope: true, edirId: true },
      });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope !== 'BRANCH' && role.edirId) return { success: false as const, error: 'Invalid role for branch user.' };
    }

    // Create user with BRANCH scope
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        name: input.name,
        branchId: input.branchId,
        roleId: input.roleId || undefined,
        hashedPassword,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    await writeAudit({
      userId: actor.id,
      action: 'BRANCH_USER_CREATED',
      targetType: 'User',
      targetId: user.id,
      details: `Created branch user: ${input.name} in ${branch.name}`,
    });

    revalidatePath('/dashboard/people');
    return {
      success: true as const,
      userId: user.id,
      tempPassword, // In a real app, send this via email
    };
  } catch (error) {
    return failure(error);
  }
}

export async function createDistrictUser(input: {
  email: string;
  phone: string;
  name: string;
  districtId: string;
  roleId?: string;
}) {
  try {
    const actor = await getActor();

    // Only Super-Admin can create district users
    if (!actor.isSuperAdmin) {
      return { success: false as const, error: 'Permission denied.' };
    }

    // Verify district exists
    const district = await prisma.district.findUnique({
      where: { id: input.districtId },
      select: { id: true, name: true },
    });
    if (!district) return { success: false as const, error: 'District not found.' };

    // Validate inputs
    if (!isValidEthiopianPhone(input.phone)) return { success: false as const, error: 'Invalid phone number.' };
    if (!input.name?.trim()) return { success: false as const, error: 'Name is required.' };

    const phone = normalizeEthiopianPhone(input.phone);
    const email = normalizeNibEmail(input.email);

    // Check for duplicates
    const [emailTaken, phoneTaken] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { phone } }),
    ]);
    if (emailTaken) return { success: false as const, error: 'Email already in use.' };
    if (phoneTaken) return { success: false as const, error: 'Phone already in use.' };

    // Verify and validate role if provided
    if (input.roleId) {
      const role = await prisma.role.findUnique({
        where: { id: input.roleId },
        select: { scope: true },
      });
      if (!role) return { success: false as const, error: 'Role not found.' };
      if (role.scope !== 'DISTRICT' && role.scope !== 'SUPER_ADMIN') return { success: false as const, error: 'Invalid role for district user.' };
    }

    // Create user with DISTRICT scope
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        name: input.name,
        districtId: input.districtId,
        roleId: input.roleId || undefined,
        hashedPassword,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    await writeAudit({
      userId: actor.id,
      action: 'DISTRICT_USER_CREATED',
      targetType: 'User',
      targetId: user.id,
      details: `Created district user: ${input.name} in ${district.name}`,
    });

    revalidatePath('/dashboard/people');
    return {
      success: true as const,
      userId: user.id,
      tempPassword, // In a real app, send this via email
    };
  } catch (error) {
    return failure(error);
  }
}

export async function listBranchUsers(branchId: string) {
  try {
    const actor = await getActor();

    // Check permission
    if (actor.orgScope === 'DISTRICT' && actor.districtId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { districtId: true },
      });
      if (!branch || branch.districtId !== actor.districtId) {
        return { success: false as const, error: 'Permission denied.' };
      }
    } else if (!actor.isSuperAdmin) {
      return { success: false as const, error: 'Permission denied.' };
    }

    const users = await prisma.user.findMany({
      where: { branchId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        role: { select: { id: true, name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true as const, data: users };
  } catch (error) {
    return failure(error);
  }
}

export async function listDistrictUsers(districtId: string) {
  try {
    const actor = await getActor();

    // Only super-admin can list district users
    if (!actor.isSuperAdmin) {
      return { success: false as const, error: 'Permission denied.' };
    }

    const users = await prisma.user.findMany({
      where: { districtId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        role: { select: { id: true, name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { success: true as const, data: users };
  } catch (error) {
    return failure(error);
  }
}

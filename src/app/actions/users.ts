'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser, hasPermission } from './auth';
import { LogSeverity, Permission, User } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { NotAuthenticatedError } from '@/lib/errors';
import { getManagementScope, scopeWhereClause } from '@/lib/user-scope';

export async function exportAllUsers(filters: any = {}) {
    const actor = await getLoggedInUser();
    if (!actor) throw new NotAuthenticatedError();
    await hasPermission('manage_users');

    // Restrict the export to the caller's branch/district scope.
    const scope = getManagementScope(actor);
    const where: any = { AND: [scopeWhereClause(scope)] };

    if (filters.query) {
        where.AND.push({
            OR: [
                { name: { contains: filters.query, mode: 'insensitive' } },
                { email: { contains: filters.query, mode: 'insensitive' } },
            ]
        });
    }

    if (filters.status && filters.status !== 'all') where.AND.push({ status: filters.status });
    if (filters.roleId && filters.roleId !== 'all') where.AND.push({ roleId: filters.roleId });
    if (filters.officeId && filters.officeId !== 'all') where.AND.push({ officeId: filters.officeId });
    if (filters.departmentId && filters.departmentId !== 'all') where.AND.push({ departmentId: filters.departmentId });

    if (filters.signatureFilter && filters.signatureFilter !== 'all') {
        if (filters.signatureFilter === 'set') {
            where.AND.push({ signature: { not: null } });
        } else if (filters.signatureFilter === 'unset') {
            where.AND.push({ signature: null });
        }
    }

    const users = await prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
            role: true,
            office: true,
            department: true,
            division: true,
            district: true,
            branch: true,
        }
    });

    return users.map(u => {
        const { hashedPassword, ...rest } = u;
        return rest;
    });
}

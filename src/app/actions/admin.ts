'use server';

import prisma from '@/lib/prisma';
import { getLoggedInUser, hasPermission } from './auth';
import { LogSeverity, DelegationPermission } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { revalidatePath } from 'next/cache';
import Papa from 'papaparse';
import { Prisma } from '@prisma/client';
import { sendVerificationEmail, sendPasswordResetEmail } from '@/lib/email';
import crypto from 'crypto';
import { AccessDeniedError, NotAuthenticatedError, NotFoundError } from '@/lib/errors';
import { normalizeNibEmail } from '@/lib/utils';
import {
    getManagementScope,
    scopeWhereClause,
    assertCanManageUser,
    assertCanAssignRole,
    assertScopeAssignment,
    getAssignableRoles as getAssignableRolesForActor,
    getUserPermissions,
    parsePermissions,
    isPermissionSubset,
    describeScope,
    notifyUsers,
} from '@/lib/user-scope';

export async function getUserLockoutStatus(email: string) {
    if (!email) return null;

    // Normalize identifier — accepts "firstname.lastname" or full email
    const normalizedEmail = normalizeNibEmail(email);

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { lockoutUntil: true }
    });
    return user;
}

export async function getUsers() {
    return await prisma.user.findMany({
        include: {
            role: true,
            office: true,
            department: true,
            division: true,
            district: true,
            branch: true,
        },
    });
}

export async function getRoles() {
    return await prisma.role.findMany({
        include: { _count: { select: { users: true } } }
    });
}

export async function getOffices() {
    return await prisma.office.findMany({
        include: { departments: true, districts: true },
    });
}

export async function getDepartments() {
    return await prisma.department.findMany({
        include: { office: true },
    });
}

export async function getDivisions() {
    return await prisma.division.findMany({
        include: { department: true },
    });
}

function serializeBranch(branch: any) {
    return {
        ...branch,
        latitude: branch.latitude == null ? branch.latitude : Number(branch.latitude),
        longitude: branch.longitude == null ? branch.longitude : Number(branch.longitude),
    };
}

export async function getBranches() {
    const user = await getLoggedInUser();
    
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    // If user is a district manager, only return branches in their district
    const branches = user.districtId
        ? await prisma.branch.findMany({
            where: { districtId: user.districtId },
            include: { district: true },
        })
        : await prisma.branch.findMany({
            include: { district: true },
        });

    return branches.map(serializeBranch);
}

export async function getDistricts() {
    const user = await getLoggedInUser();
    
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    // If user is a district manager, only return their district
    if (user.districtId) {
        return await prisma.district.findMany({
            where: { id: user.districtId },
            include: { office: true },
        });
    }
    
    // Otherwise, return all districts
    return await prisma.district.findMany({
        include: { office: true },
    });
}

export async function getCustomers() {
    const user = await getLoggedInUser();
    
    if (!user) {
        throw new Error("Not authenticated");
    }

    const loadCustomers = async (where?: any) => {
        const customers = await prisma.customer.findMany({
            where,
            include: { 
                branch: true,
                district: true,
                createdBy: true,
                interactions: {
                    include: {
                        createdBy: true
                    },
                    orderBy: {
                        interactionDate: 'desc'
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return customers.map(customer => ({
            ...customer,
            branch: customer.branch ? serializeBranch(customer.branch) : customer.branch,
        }));
    };

    // If user is a district manager, only return customers in their district's branches
    if (user.districtId) {
        return await loadCustomers({
            branch: { 
                districtId: user.districtId 
            } 
        });
    }
    
    // If user is a branch manager, only return customers in their branch
    if (user.branchId) {
        return await loadCustomers({ branchId: user.branchId });
    }
    
    // Otherwise, return all customers
    return await loadCustomers();
}

export async function saveCustomer(data: { 
    id?: string; 
    firstName: string; 
    lastName: string; 
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    latitude?: number;
    longitude?: number;
    notes?: string;
    branchId?: string;
    accountNumber?: string;
    districtId?: string;
    businessSector?: string;
    businessType?: string;
    businessLicenseNumber?: string;
    annualRevenueRange?: string;
    employeeRange?: string;
}) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new NotAuthenticatedError();
    }
    
    const hasManageCustomers = user.role?.permissions?.includes('manage_customers');
    if (!hasManageCustomers) {
        throw new AccessDeniedError();
    }
    
    // If user is a district manager, ensure they're only managing customers in their district
    if (user.districtId && data.branchId) {
        const branch = await prisma.branch.findUnique({ where: { id: data.branchId } });
        if (!branch || branch.districtId !== user.districtId) {
            throw new Error("Access Denied: You can only manage customers in your assigned district.");
        }
    }
    
    // If user is a branch manager, ensure they're only managing customers in their branch
    if (user.branchId) {
        if (data.branchId && data.branchId !== user.branchId) {
            throw new Error("Access Denied: You can only manage customers in your assigned branch.");
        }
        // If no branchId provided, use user's branch
        if (!data.branchId) {
            data.branchId = user.branchId;
        }
    }
    
    if (data.id) {
        // Check if the existing customer is in the user's scope
        const existingCustomer = await prisma.customer.findUnique({ 
            where: { id: data.id },
            include: { branch: true }
        });
        
        if (!existingCustomer) {
            throw new Error("Customer not found.");
        }
        
        if (user.districtId && existingCustomer.branch?.districtId !== user.districtId) {
            throw new Error("Access Denied: You can only manage customers in your assigned district.");
        }
        
        if (user.branchId && existingCustomer.branchId !== user.branchId) {
            throw new Error("Access Denied: You can only manage customers in your assigned branch.");
        }
        
        const updatedCustomer = await prisma.customer.update({ 
            where: { id: data.id }, 
            data 
        });
        
        await logSecurityEvent({
            event: 'CUSTOMER_UPDATED',
            severity: LogSeverity.INFO,
            actor: user,
            details: `Updated customer '${data.firstName} ${data.lastName}' (ID: ${data.id}).`,
            targetId: data.id,
            targetType: 'Customer',
        });
        
        return updatedCustomer;
    } else {
        const newCustomer = await prisma.customer.create({
            data: {
                ...data,
                createdById: user.id
            }
        });
        
        await logSecurityEvent({
            event: 'CUSTOMER_CREATED',
            severity: LogSeverity.INFO,
            actor: user,
            details: `Created new customer '${data.firstName} ${data.lastName}'.`,
            targetId: newCustomer.id,
            targetType: 'Customer',
        });
        
        return newCustomer;
    }
}

export async function deleteCustomer(id: string) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new NotAuthenticatedError();
    }
    
    const hasManageCustomers = user.role?.permissions?.includes('manage_customers');
    if (!hasManageCustomers) {
        throw new AccessDeniedError();
    }
    
    // Get the customer first to check permissions
    const customer = await prisma.customer.findUnique({ 
        where: { id },
        include: { branch: true }
    });
    
    if (!customer) {
        throw new Error("Customer not found.");
    }
    
    // Check if user has permission to delete this customer
    if (user.districtId && customer.branch?.districtId !== user.districtId) {
        throw new Error("Access Denied: You can only manage customers in your assigned district.");
    }
    
    if (user.branchId && customer.branchId !== user.branchId) {
        throw new Error("Access Denied: You can only manage customers in your assigned branch.");
    }
    
    try {
        await prisma.customer.delete({ where: { id } });
        
        await logSecurityEvent({
            event: 'CUSTOMER_DELETED',
            severity: LogSeverity.WARN,
            actor: user,
            details: `Deleted customer '${customer.firstName} ${customer.lastName}' (ID: ${id}).`,
            targetId: id,
            targetType: 'Customer',
        });
        
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete customer. They have associated jobs or leads. Please reassign them first.',
            };
        }
        console.error('Error deleting customer:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function addCustomerInteraction(data: {
    customerId: string;
    type: string;
    summary: string;
    details?: string;
    interactionDate: Date;
    jobId?: string;
}) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    const hasManageCustomers = user.role?.permissions?.includes('manage_customers');
    if (!hasManageCustomers) {
        throw new Error("Access Denied: You do not have the required permissions.");
    }
    
    // Check if customer exists and is in user's scope
    const customer = await prisma.customer.findUnique({ 
        where: { id: data.customerId },
        include: { branch: true }
    });
    
    if (!customer) {
        throw new Error("Customer not found.");
    }
    
    if (user.districtId && customer.branch?.districtId !== user.districtId) {
        throw new Error("Access Denied: You can only manage customers in your assigned district.");
    }
    
    if (user.branchId && customer.branchId !== user.branchId) {
        throw new Error("Access Denied: You can only manage customers in your assigned branch.");
    }
    
    const interaction = await prisma.customerInteraction.create({
        data: {
            ...data,
            createdById: user.id
        }
    });
    
    await logSecurityEvent({
        event: 'CUSTOMER_INTERACTION_ADDED',
        severity: LogSeverity.INFO,
        actor: user,
        details: `Added interaction for customer '${customer.firstName} ${customer.lastName}'.`,
        targetId: interaction.id,
        targetType: 'CustomerInteraction',
    });
    
    return interaction;
}

export async function getGPSVerifications(page = 1, limit = 10, filters: { status?: string } = {}) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    const hasManageGPS = user.role?.permissions?.includes('manage_gps_verification');
    if (!hasManageGPS) {
        throw new Error("Access Denied: You do not have the required permissions.");
    }
    
    // Ensure page is at least 1
    page = Math.max(1, page);
    // Ensure limit is at least 1
    limit = Math.max(1, limit);
    
    let where: any = {};
    if (user.branchId) {
        where.job = { branchId: user.branchId };
    } else if (user.districtId) {
        where.job = { branch: { districtId: user.districtId } };
    }
    
    if (filters.status) where.status = filters.status;
    
    const [verifications, total] = await prisma.$transaction([
        prisma.gPSVerification.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                job: { include: { createdBy: true } },
                reviewedBy: true,
            },
        }),
        prisma.gPSVerification.count({ where }),
    ]);
    
    return { verifications, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function reviewGPSVerification(data: {
    id: string;
    status: 'VERIFIED' | 'REVIEWED';
    comment?: string;
}) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    const hasManageGPS = user.role?.permissions?.includes('manage_gps_verification');
    if (!hasManageGPS) {
        throw new Error("Access Denied: You do not have the required permissions.");
    }
    
    const verification = await prisma.gPSVerification.findUnique({
        where: { id: data.id },
        include: { job: true },
    });
    if (!verification) throw new Error("Verification not found");
    
    // Check user's scope
    if (user.branchId && verification.job?.branchId !== user.branchId) {
        throw new Error("Access Denied");
    }
    if (user.districtId) {
        const branch = await prisma.branch.findUnique({
            where: { id: verification.job?.branchId || '' },
        });
        if (branch?.districtId !== user.districtId) {
            throw new Error("Access Denied");
        }
    }
    
    const updated = await prisma.gPSVerification.update({
        where: { id: data.id },
        data: {
            status: data.status,
            reviewComment: data.comment,
            reviewedById: user.id,
            reviewedAt: new Date(),
        },
    });
    
    await logSecurityEvent({
        event: 'GPS_VERIFICATION_REVIEWED',
        severity: LogSeverity.INFO,
        actor: user,
        details: `Reviewed GPS verification for job ${verification.jobId}.`,
        targetId: data.id,
        targetType: 'GPSVerification',
    });
    
    revalidatePath('/dashboard/admin/gps-verifications');
    return updated;
}

export async function getAdminUsers(
    page = 1,
    limit = 10,
    filters: {
        query?: string;
        status?: string;
        roleId?: string;
        officeId?: string;
        departmentId?: string;
        districtId?: string;
        branchId?: string;
    } = {}
) {
    const actor = await getLoggedInUser();
    if (!actor) throw new NotAuthenticatedError();

    // Either view_users or manage_users grants access to the (scoped) list.
    const actorPerms = getUserPermissions(actor);
    if (!actorPerms.includes('view_users') && !actorPerms.includes('manage_users')) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor,
            details: `User '${actor.name}' (ID: ${actor.id}) denied permission for: view_users, manage_users.`,
        });
        throw new AccessDeniedError();
    }

    const scope = getManagementScope(actor);

    const where: any = { AND: [scopeWhereClause(scope)] };

    if (filters.query) {
        where.AND.push({
            OR: [
                { name: { contains: filters.query, mode: 'insensitive' } },
                { email: { contains: filters.query, mode: 'insensitive' } },
            ],
        });
    }

    if (filters.status && filters.status !== 'all') where.AND.push({ status: filters.status });
    if (filters.roleId && filters.roleId !== 'all') where.AND.push({ roleId: filters.roleId });
    if (filters.officeId && filters.officeId !== 'all') where.AND.push({ officeId: filters.officeId });
    if (filters.departmentId && filters.departmentId !== 'all')
        where.AND.push({ departmentId: filters.departmentId });
    if (filters.districtId && filters.districtId !== 'all') where.AND.push({ districtId: filters.districtId });
    if (filters.branchId && filters.branchId !== 'all') where.AND.push({ branchId: filters.branchId });

    const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { name: 'asc' },
            include: {
                role: true,
                office: true,
                department: true,
                division: true,
                district: true,
                branch: true,
            },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
}

export type BulkImportResult = {
    successCount: number;
    errorCount: number;
    errors: Array<{ rowIndex: number; email: string; error: string }>;
};

export async function bulkImportUsers(fileData: string): Promise<BulkImportResult> {
    const actor = await getLoggedInUser();
    if (!actor) throw new NotAuthenticatedError();
    await hasPermission('import_users');

    const scope = getManagementScope(actor);
    const actorPermSet = new Set(getUserPermissions(actor));

    const result: BulkImportResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    // Helper function to normalize keys
    const normalizeRow = (row: any) => {
        const normalized: any = {};
        for (const key in row) {
            const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '');
            normalized[normalizedKey] = row[key];
        }
        return normalized;
    };

    const parseResult = Papa.parse(fileData, { header: true, skipEmptyLines: true });
    const rows: any[] = parseResult.data.map(normalizeRow);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            // Trim all values to handle whitespace
            const name = row.name?.trim();
            const email = row.email?.trim();
            const office = row.office?.trim();
            const department = row.department?.trim();
            const division = row.division?.trim();
            const district = row.district?.trim();
            const branch = row.branch?.trim();
            const role = row.role?.trim();
            
            // Find or create related records
            const officeRecord = await prisma.office.findFirst({
                where: { name: { equals: office, mode: 'insensitive' } },
            });
            if (!officeRecord) throw new Error(`Office "${office}" not found`);

            const departmentRecord = department
                ? await prisma.department.findFirst({
                    where: {
                        name: { equals: department, mode: 'insensitive' },
                        officeId: officeRecord.id,
                    },
                })
                : null;

            const divisionRecord = division
                ? await prisma.division.findFirst({
                    where: {
                        name: { equals: division, mode: 'insensitive' },
                        departmentId: departmentRecord?.id,
                    },
                })
                : null;

            const districtRecord = district
                ? await prisma.district.findFirst({
                    where: {
                        name: { equals: district, mode: 'insensitive' },
                        officeId: officeRecord.id,
                    },
                })
                : null;

            const branchRecord = branch
                ? await prisma.branch.findFirst({
                    where: {
                        name: { equals: branch, mode: 'insensitive' },
                        districtId: districtRecord?.id,
                    },
                })
                : null;

            const roleRecord = await prisma.role.findFirst({
                where: { name: { equals: role, mode: 'insensitive' } },
            });
            if (!roleRecord) throw new Error(`Role "${role}" not found`);

            // Hierarchy: only allow assigning a role whose permissions are a
            // subset of the importer's own permissions.
            if (!isPermissionSubset(parsePermissions(roleRecord.permissions), [...actorPermSet])) {
                throw new Error(`You cannot assign the "${roleRecord.name}" role — it exceeds your authority.`);
            }

            // Scope: a branch/district manager may only import users into their
            // own branch/district.
            await assertScopeAssignment(actor, {
                districtId: districtRecord?.id ?? null,
                branchId: branchRecord?.id ?? null,
            });

            // Check if user already exists
            const existingUser = await prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
                include: { role: true, branch: { select: { districtId: true } } },
            });

            // For updates, the importer must already be allowed to manage the
            // existing user (cannot pull someone in from outside their scope).
            if (existingUser) {
                await assertCanManageUser(actor, existingUser);
            }

            if (existingUser) {
                // Update existing user
                await prisma.user.update({
                    where: { id: existingUser.id },
                    data: {
                        name,
                        roleId: roleRecord.id,
                        officeId: officeRecord.id,
                        departmentId: departmentRecord?.id,
                        divisionId: divisionRecord?.id,
                        districtId: districtRecord?.id,
                        branchId: branchRecord?.id,
                    },
                });
            } else {
                // Create new user
                const newUser = await prisma.user.create({
                    data: {
                        name,
                        email: normalizeNibEmail(email),
                        roleId: roleRecord.id,
                        officeId: officeRecord.id,
                        departmentId: departmentRecord?.id,
                        divisionId: divisionRecord?.id,
                        districtId: districtRecord?.id,
                        branchId: branchRecord?.id,
                        status: 'active',
                        onboardingCompleted: false,
                    },
                });

                // Generate password reset token
                const token = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 1);

                // Delete any existing token for this email first
                await prisma.passwordResetToken.deleteMany({
                    where: { email: newUser.email }
                });

                await prisma.passwordResetToken.create({
                    data: {
                        email: newUser.email,
                        token,
                        expires: expiresAt,
                    },
                });

                // Send verification email
                await sendVerificationEmail({
                    to: newUser.email,
                    name: newUser.name,
                    token,
                });
            }

            result.successCount++;
        } catch (error: any) {
            result.errorCount++;
            result.errors.push({
                rowIndex: i + 2, // +2 for header and 1-based index
                email: row.email?.trim() || 'Unknown',
                error: error.message,
            });
        }
    }

    await logSecurityEvent({
        event: SecurityEvent.BULK_USER_IMPORT,
        severity: LogSeverity.WARN,
        actor,
        details: `Bulk user import by '${actor.name}' into ${describeScope(scope)}: ${result.successCount} succeeded, ${result.errorCount} failed.`,
        targetType: 'User',
    });

    revalidatePath('/dashboard/admin/users');
    return result;
}

/**
 * Returns the roles the current user is allowed to assign — i.e. roles whose
 * permission set is a subset of the caller's own permissions. The UI uses this
 * to populate role pickers so managers can never select a role beyond their
 * authority. (Backend actions independently re-verify this.)
 */
export async function getAssignableRoles() {
    const actor = await getLoggedInUser();
    if (!actor) throw new NotAuthenticatedError();
    return getAssignableRolesForActor(actor);
}

/**
 * Describes the current user's user-management scope so the client can render a
 * clear "you are managing X" banner and lock org-unit selectors appropriately.
 */
export async function getUserManagementContext() {
    const actor = await getLoggedInUser();
    if (!actor) throw new NotAuthenticatedError();

    const scope = getManagementScope(actor);
    const perms = new Set(getUserPermissions(actor));

    let districtName: string | null = null;
    let branchName: string | null = null;
    if (scope.branchId) {
        const branch = await prisma.branch.findUnique({
            where: { id: scope.branchId },
            select: { name: true, district: { select: { name: true } } },
        });
        branchName = branch?.name ?? null;
        districtName = branch?.district?.name ?? null;
    } else if (scope.districtId) {
        const district = await prisma.district.findUnique({
            where: { id: scope.districtId },
            select: { name: true },
        });
        districtName = district?.name ?? null;
    }

    return {
        scope,
        districtName,
        branchName,
        label: describeScope(scope, { district: districtName, branch: branchName }),
        can: {
            manage: perms.has('manage_users'),
            view: perms.has('view_users') || perms.has('manage_users'),
            import: perms.has('import_users'),
            lock: perms.has('lock_user') || perms.has('manage_users'),
            unlock: perms.has('unlock_user') || perms.has('manage_users'),
            resetPassword: perms.has('reset_password'),
        },
    };
}

export async function bulkImportDepartments(fileData: string): Promise<BulkImportResult> {
    await hasPermission('import_departments');

    const result: BulkImportResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    // Helper function to normalize keys
    const normalizeRow = (row: any) => {
        const normalized: any = {};
        for (const key in row) {
            const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '');
            normalized[normalizedKey] = row[key];
        }
        return normalized;
    };

    const parseResult = Papa.parse(fileData, { header: true, skipEmptyLines: true });
    const rows: any[] = parseResult.data.map(normalizeRow);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            // Trim all values to handle whitespace
            const name = row.name?.trim();
            const code = row.code?.trim();
            const office = row.office?.trim();
            
            if (!name || !code || !office) {
                throw new Error('Name, code, and office are required');
            }
            const officeRecord = await prisma.office.findFirst({
                where: { name: { equals: office, mode: 'insensitive' } },
            });
            if (!officeRecord) throw new Error(`Office "${office}" not found`);

            const existing = await prisma.department.findFirst({
                where: {
                    OR: [
                        { name: { equals: name, mode: 'insensitive' } },
                        { code: { equals: code, mode: 'insensitive' } }
                    ],
                    officeId: officeRecord.id,
                },
            });

            if (existing) {
                await prisma.department.update({
                    where: { id: existing.id },
                    data: { name, code },
                });
            } else {
                await prisma.department.create({
                    data: {
                        name,
                        code,
                        officeId: officeRecord.id,
                    },
                });
            }

            result.successCount++;
        } catch (error: any) {
            result.errorCount++;
            result.errors.push({
                rowIndex: i + 2,
                email: row.name?.trim() || 'Unknown',
                error: error.message,
            });
        }
    }

    revalidatePath('/dashboard/admin/departments');
    return result;
}

export async function bulkImportDivisions(fileData: string): Promise<BulkImportResult> {
    await hasPermission('import_divisions');

    const result: BulkImportResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    // Helper function to normalize keys
    const normalizeRow = (row: any) => {
        const normalized: any = {};
        for (const key in row) {
            const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '');
            normalized[normalizedKey] = row[key];
        }
        return normalized;
    };

    const parseResult = Papa.parse(fileData, { header: true, skipEmptyLines: true });
    const rows: any[] = parseResult.data.map(normalizeRow);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            // Trim all values to handle whitespace
            const name = row.name?.trim();
            const code = row.code?.trim();
            const office = row.office?.trim();
            const department = row.department?.trim();
            
            if (!name || !code || !office || !department) {
                throw new Error('Name, code, office, and department are required');
            }
            const officeRecord = await prisma.office.findFirst({
                where: { name: { equals: office, mode: 'insensitive' } },
            });
            if (!officeRecord) throw new Error(`Office "${office}" not found`);

            const departmentRecord = await prisma.department.findFirst({
                where: {
                    name: { equals: department, mode: 'insensitive' },
                    officeId: officeRecord.id,
                },
            });
            if (!departmentRecord) throw new Error(`Department "${department}" not found`);

            const existing = await prisma.division.findFirst({
                where: {
                    OR: [
                        { name: { equals: name, mode: 'insensitive' } },
                        { code: { equals: code, mode: 'insensitive' } }
                    ],
                    departmentId: departmentRecord.id,
                },
            });

            if (existing) {
                await prisma.division.update({
                    where: { id: existing.id },
                    data: { name, code },
                });
            } else {
                await prisma.division.create({
                    data: {
                        name,
                        code,
                        departmentId: departmentRecord.id,
                    },
                });
            }

            result.successCount++;
        } catch (error: any) {
            result.errorCount++;
            result.errors.push({
                rowIndex: i + 2,
                email: row.name?.trim() || 'Unknown',
                error: error.message,
            });
        }
    }

    revalidatePath('/dashboard/admin/divisions');
    return result;
}

export async function bulkImportDistricts(fileData: string): Promise<BulkImportResult> {
    await hasPermission('import_districts');

    const result: BulkImportResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    // Helper function to normalize keys
    const normalizeRow = (row: any) => {
        const normalized: any = {};
        for (const key in row) {
            const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '');
            normalized[normalizedKey] = row[key];
        }
        return normalized;
    };

    const parseResult = Papa.parse(fileData, { header: true, skipEmptyLines: true });
    const rows: any[] = parseResult.data.map(normalizeRow);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            // Trim all values to handle whitespace
            const name = row.name?.trim();
            const code = row.code?.trim();
            const office = row.office?.trim();
            
            if (!name || !code || !office) {
                throw new Error('Name, code, and office are required');
            }
            const officeRecord = await prisma.office.findFirst({
                where: { name: { equals: office, mode: 'insensitive' } },
            });
            if (!officeRecord) throw new Error(`Office "${office}" not found`);

            const existing = await prisma.district.findFirst({
                where: {
                    OR: [
                        { name: { equals: name, mode: 'insensitive' } },
                        { code: { equals: code, mode: 'insensitive' } }
                    ],
                    officeId: officeRecord.id,
                },
            });

            if (existing) {
                await prisma.district.update({
                    where: { id: existing.id },
                    data: { name, code },
                });
            } else {
                await prisma.district.create({
                    data: {
                        name,
                        code,
                        officeId: officeRecord.id,
                    },
                });
            }

            result.successCount++;
        } catch (error: any) {
            result.errorCount++;
            result.errors.push({
                rowIndex: i + 2,
                email: row.name?.trim() || 'Unknown',
                error: error.message,
            });
        }
    }

    revalidatePath('/dashboard/admin/districts');
    return result;
}

export async function bulkImportBranches(fileData: string): Promise<BulkImportResult> {
    await hasPermission('import_branches');

    const result: BulkImportResult = {
        successCount: 0,
        errorCount: 0,
        errors: [],
    };

    // Helper function to normalize keys
    const normalizeRow = (row: any) => {
        const normalized: any = {};
        for (const key in row) {
            const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '');
            normalized[normalizedKey] = row[key];
        }
        return normalized;
    };

    const parseResult = Papa.parse(fileData, { header: true, skipEmptyLines: true });
    const rows: any[] = parseResult.data.map(normalizeRow);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
            // Trim all values to handle whitespace
            const name = row.name?.trim();
            const code = row.code?.trim();
            const office = row.office?.trim();
            const district = row.district?.trim();
            const latitude = row.latitude?.trim();
            const longitude = row.longitude?.trim();
            
            if (!name || !code || !office || !district) {
                throw new Error('Name, code, office, and district are required');
            }
            const officeRecord = await prisma.office.findFirst({
                where: { name: { equals: office, mode: 'insensitive' } },
            });
            if (!officeRecord) throw new Error(`Office "${office}" not found`);

            const districtRecord = await prisma.district.findFirst({
                where: {
                    name: { equals: district, mode: 'insensitive' },
                    officeId: officeRecord.id,
                },
            });
            if (!districtRecord) throw new Error(`District "${district}" not found`);

            const existing = await prisma.branch.findFirst({
                where: {
                    OR: [
                        { name: { equals: name, mode: 'insensitive' } },
                        { code: { equals: code, mode: 'insensitive' } }
                    ],
                    districtId: districtRecord.id,
                },
            });

            if (existing) {
                await prisma.branch.update({
                    where: { id: existing.id },
                    data: { 
                        name, 
                        code, 
                        ...(latitude && { latitude: new Prisma.Decimal(latitude) }), 
                        ...(longitude && { longitude: new Prisma.Decimal(longitude) }) 
                    },
                });
            } else {
                await prisma.branch.create({
                    data: {
                        name,
                        code,
                        districtId: districtRecord.id,
                        ...(latitude && { latitude: new Prisma.Decimal(latitude) }),
                        ...(longitude && { longitude: new Prisma.Decimal(longitude) }),
                    },
                });
            }

            result.successCount++;
        } catch (error: any) {
            result.errorCount++;
            result.errors.push({
                rowIndex: i + 2,
                email: row.name?.trim() || 'Unknown',
                error: error.message,
            });
        }
    }

    revalidatePath('/dashboard/admin/branches');
    return result;
}

export async function saveUser(data: {
    id?: string;
    name?: string;
    email?: string;
    roleId?: string;
    status?: string;
    officeId?: string;
    departmentId?: string;
    divisionId?: string;
    districtId?: string;
    branchId?: string;
}) {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('manage_users');

    const scope = getManagementScope(user);

    // Enforce role-assignment hierarchy: a manager may only grant a role whose
    // permission set is a subset of their own.
    if (data.roleId) {
        await assertCanAssignRole(user, data.roleId);
    }

    if (data.id) {
        // ── Update existing user ────────────────────────────────────────────────
        const existing = await prisma.user.findUnique({
            where: { id: data.id },
            include: { role: true, branch: { select: { districtId: true } } },
        });
        if (!existing) throw new NotFoundError('User not found');

        // The actor must be allowed to manage the user in their CURRENT placement…
        await assertCanManageUser(user, existing);

        // …and the user must remain within the actor's scope after the edit.
        await assertScopeAssignment(user, {
            districtId: data.districtId !== undefined ? data.districtId || null : existing.districtId,
            branchId: data.branchId !== undefined ? data.branchId || null : existing.branchId,
        });

        const updatedUser = await prisma.user.update({
            where: { id: data.id },
            data: {
                ...(data.name && { name: data.name }),
                ...(data.email && { email: normalizeNibEmail(data.email) }),
                ...(data.roleId && { roleId: data.roleId }),
                ...(data.status && { status: data.status }),
                ...(data.officeId && { officeId: data.officeId }),
                ...(data.departmentId !== undefined && { departmentId: data.departmentId || null }),
                ...(data.divisionId !== undefined && { divisionId: data.divisionId || null }),
                ...(data.districtId !== undefined && { districtId: data.districtId || null }),
                ...(data.branchId !== undefined && { branchId: data.branchId || null }),
            },
        });

        await logSecurityEvent({
            event: SecurityEvent.USER_UPDATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `User "${updatedUser.name}" updated (by ${describeScope(scope)} manager '${user.name}').`,
            targetId: updatedUser.id,
            targetType: 'User',
        });

        // Targeted audit + notifications for the high-signal changes.
        const roleChanged = !!data.roleId && data.roleId !== existing.roleId;
        if (roleChanged) {
            await logSecurityEvent({
                event: SecurityEvent.USER_ROLE_CHANGED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `Role of user "${updatedUser.name}" changed by '${user.name}'.`,
                targetId: updatedUser.id,
                targetType: 'User',
            });
            await notifyUsers([updatedUser.id], {
                type: 'account',
                priority: 'high',
                title: 'Your role was updated',
                body: `Your access role was changed by ${user.name ?? 'an administrator'}.`,
                entityId: updatedUser.id,
                entityType: 'User',
            });
        }

        const statusChanged = !!data.status && data.status !== existing.status;
        if (statusChanged) {
            await logSecurityEvent({
                event: SecurityEvent.USER_STATUS_CHANGED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `User "${updatedUser.name}" set to '${updatedUser.status}' by '${user.name}'.`,
                targetId: updatedUser.id,
                targetType: 'User',
            });
            await notifyUsers([updatedUser.id], {
                type: 'account',
                priority: 'high',
                title: updatedUser.status === 'active' ? 'Your account was activated' : 'Your account was deactivated',
                body: updatedUser.status === 'active'
                    ? `Your account was activated by ${user.name ?? 'an administrator'}.`
                    : `Your account was deactivated by ${user.name ?? 'an administrator'}. Contact your manager if this is unexpected.`,
                entityId: updatedUser.id,
                entityType: 'User',
            });
        }

        revalidatePath('/dashboard/admin/users');
        return { success: true, user: updatedUser };
    } else {
        // ── Create new user ─────────────────────────────────────────────────────
        // A scoped manager must place the new user inside their own scope. If they
        // omit the org assignment, default it to their own branch/district.
        const branchId = data.branchId || (scope.level === 'branch' ? scope.branchId : null);
        const districtId = data.districtId || (scope.level !== 'organization' ? scope.districtId : null);

        await assertScopeAssignment(user, { districtId, branchId });

        const newUser = await prisma.user.create({
            data: {
                name: data.name!,
                email: normalizeNibEmail(data.email!),
                roleId: data.roleId!,
                officeId: data.officeId!,
                departmentId: data.departmentId || null,
                divisionId: data.divisionId || null,
                districtId: districtId,
                branchId: branchId,
                status: data.status || 'active',
                onboardingCompleted: false,
            },
        });

        await logSecurityEvent({
            event: SecurityEvent.USER_CREATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `User "${newUser.name}" created (by ${describeScope(scope)} manager '${user.name}').`,
            targetId: newUser.id,
            targetType: 'User',
        });

        // Generate password reset token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);

        // Delete any existing token for this email first
        await prisma.passwordResetToken.deleteMany({
            where: { email: newUser.email! }
        });

        await prisma.passwordResetToken.create({
            data: {
                email: newUser.email!,
                token,
                expires: expiresAt,
            },
        });

        // Send verification email
        await sendVerificationEmail({
            to: newUser.email!,
            name: newUser.name!,
            token,
        });

        revalidatePath('/dashboard/admin/users');
        return { success: true, user: newUser };
    }
}

export async function deleteUser(id: string) {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();

    await hasPermission('manage_users');

    if (id === user.id) {
        return { error: 'You cannot delete your own account.' };
    }

    try {
        const userToDelete = await prisma.user.findUnique({
            where: { id },
            include: { role: true, branch: { select: { districtId: true } } },
        });
        if (!userToDelete) throw new NotFoundError('User not found');

        await assertCanManageUser(user, userToDelete);

        await prisma.user.delete({ where: { id } });

        await logSecurityEvent({
            event: SecurityEvent.USER_DELETED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User "${userToDelete.name}" deleted`,
            targetId: id,
            targetType: 'User',
        });

        revalidatePath('/dashboard/admin/users');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete user. They have associated records. Please reassign them first.',
            };
        }
        console.error('Error deleting user:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function lockUser(userId: string, lockUntil: Date) {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();
    await hasPermission('manage_users');

    if (userId === user.id) {
        throw new AccessDeniedError('You cannot lock your own account.');
    }

    const target = await prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, branch: { select: { districtId: true } } },
    });
    if (!target) throw new NotFoundError('User not found');
    await assertCanManageUser(user, target);

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
            lockoutUntil: lockUntil,
        }
    });

    await logSecurityEvent({
        event: SecurityEvent.USER_LOCKED,
        severity: LogSeverity.WARN,
        actor: user,
        details: `Locked user "${updatedUser.name}" until ${lockUntil.toLocaleString()}`,
        targetId: userId,
        targetType: 'User',
    });

    revalidatePath('/dashboard/admin/users');
    return { success: true };
}

export async function unlockUser(userId: string) {
    const user = await getLoggedInUser();
    if (!user) throw new NotAuthenticatedError();
    await hasPermission('manage_users');

    const target = await prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, branch: { select: { districtId: true } } },
    });
    if (!target) throw new NotFoundError('User not found');
    await assertCanManageUser(user, target);

    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
            lockoutUntil: null,
            failedLoginAttempts: 0,
        }
    });

    await logSecurityEvent({
        event: SecurityEvent.USER_UNLOCKED,
        severity: LogSeverity.INFO,
        actor: user,
        details: `Unlocked user "${updatedUser.name}"`,
        targetId: userId,
        targetType: 'User',
    });

    revalidatePath('/dashboard/admin/users');
    return { success: true };
}

export async function adminResetUserPassword(userId: string) {
    const adminUser = await getLoggedInUser();
    if (!adminUser) throw new NotAuthenticatedError();
    await hasPermission('reset_password');

    const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true, name: true, email: true,
            districtId: true, branchId: true,
            role: { select: { permissions: true } },
            branch: { select: { districtId: true } },
        },
    });

    if (!targetUser) throw new NotFoundError('User not found');
    await assertCanManageUser(adminUser, targetUser);
    if (!targetUser.email) {
        return { error: 'This user has no email address on file.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.upsert({
        where: { email: targetUser.email },
        update: { token, expires, createdAt: new Date() },
        create: { email: targetUser.email, token, expires },
    });

    await sendPasswordResetEmail({
        to: targetUser.email,
        name: targetUser.name ?? 'User',
        token,
    });

    await logSecurityEvent({
        event: SecurityEvent.PASSWORD_RESET_REQUEST,
        severity: LogSeverity.WARN,
        actor: adminUser,
        details: `Admin '${adminUser.name}' (ID: ${adminUser.id}) triggered a password reset for user '${targetUser.name}' (${targetUser.email}).`,
        targetId: targetUser.id,
        targetType: 'User',
    });

    await notifyUsers([targetUser.id], {
        type: 'security',
        priority: 'high',
        title: 'Password reset initiated',
        body: `${adminUser.name ?? 'An administrator'} started a password reset for your account. Check your email to set a new password.`,
        entityId: targetUser.id,
        entityType: 'User',
    });

    return { success: true };
}

export async function getEmailLogs(page = 1, limit = 10, filters: { status?: string; query?: string } = {}) {
    await hasPermission('manage_email_settings');

    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.query) {
        where.OR = [
            { to: { contains: filters.query, mode: 'insensitive' } },
            { subject: { contains: filters.query, mode: 'insensitive' } },
            { relatedEntityId: { contains: filters.query, mode: 'insensitive' } },
        ];
    }

    const [logs, total] = await prisma.$transaction([
        prisma.emailLog.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: 'desc' },
        }),
        prisma.emailLog.count({ where }),
    ]);
    return { logs, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getSecurityLogs(page = 1, limit = 15, filters: { severity?: string; query?: string } = {}) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new NotAuthenticatedError();
    }
    const userPermissions = user.role?.permissions?.split(',') || [];
    const canViewSecurityLogs = userPermissions.includes('view_security_logs') || userPermissions.includes('manage_security_logs');
    if (!canViewSecurityLogs) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User '${user.name}' (ID: ${user.id}) denied permission for: view_security_logs, manage_security_logs.`,
        });
        throw new AccessDeniedError();
    }

    const where: any = {};
    if (filters.severity) where.severity = filters.severity as LogSeverity;
    if (filters.query) {
        where.OR = [
            { event: { contains: filters.query, mode: 'insensitive' } },
            { details: { contains: filters.query, mode: 'insensitive' } },
            { actorId: { contains: filters.query, mode: 'insensitive' } },
            { targetId: { contains: filters.query, mode: 'insensitive' } },
            { ipAddress: { contains: filters.query, mode: 'insensitive' } },
        ];
    }

    const [logs, total] = await prisma.$transaction([
        prisma.securityLog.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { timestamp: 'desc' },
            include: { actor: true },
        }),
        prisma.securityLog.count({ where }),
    ]);

    return { logs, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function saveDivision(data: { id?: string; name: string; code: string; departmentId: string }) {
    const user = await hasPermission('manage_divisions');
    if (data.id) {
        await prisma.division.update({ where: { id: data.id }, data });
        await logSecurityEvent({
            event: SecurityEvent.DIVISION_UPDATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Updated division '${data.name}' (ID: ${data.id}).`,
            targetId: data.id,
            targetType: 'Division',
        });
    } else {
        const newDivision = await prisma.division.create({ data });
        await logSecurityEvent({
            event: SecurityEvent.DIVISION_CREATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Created new division '${data.name}'.`,
            targetId: newDivision.id,
            targetType: 'Division',
        });
    }
    revalidatePath('/dashboard/admin/divisions');
}

export async function deleteDivision(id: string) {
    const user = await hasPermission('manage_divisions');
    try {
        const division = await prisma.division.findUnique({ where: { id } });
        await prisma.division.delete({ where: { id } });
        if (division) {
            await logSecurityEvent({
                event: SecurityEvent.DIVISION_DELETED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `Deleted division '${division.name}' (ID: ${id}).`,
                targetId: id,
                targetType: 'Division',
            });
        }
        revalidatePath('/dashboard/admin/divisions');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete division. It has associated users or other records. Please reassign them first.',
            };
        }
        console.error('Error deleting division:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function saveDepartment(data: { id?: string; name: string; code: string; officeId: string }) {
    const user = await hasPermission('manage_departments');
    if (data.id) {
        await prisma.department.update({ where: { id: data.id }, data });
        await logSecurityEvent({
            event: SecurityEvent.DEPARTMENT_UPDATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Updated department '${data.name}' (ID: ${data.id}).`,
            targetId: data.id,
            targetType: 'Department',
        });
    } else {
        const newDept = await prisma.department.create({ data });
        await logSecurityEvent({
            event: SecurityEvent.DEPARTMENT_CREATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Created new department '${data.name}'.`,
            targetId: newDept.id,
            targetType: 'Department',
        });
    }
    revalidatePath('/dashboard/admin/departments');
}

export async function deleteDepartment(id: string) {
    const user = await hasPermission('manage_departments');
    try {
        const department = await prisma.department.findUnique({ where: { id } });
        await prisma.department.delete({ where: { id } });
        if (department) {
            await logSecurityEvent({
                event: SecurityEvent.DEPARTMENT_DELETED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `Deleted department '${department.name}' (ID: ${id}).`,
                targetId: id,
                targetType: 'Department',
            });
        }
        revalidatePath('/dashboard/admin/departments');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete department. It has associated divisions. Please reassign/delete them first.',
            };
        }
        console.error('Error deleting department:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function saveBranch(data: { id?: string; name: string; code: string; districtId: string; latitude?: number; longitude?: number }) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    const hasManageBranchesPermission = user.role?.permissions?.includes('manage_branches');
    const isDistrictManager = user.districtId !== null;
    
    if (!hasManageBranchesPermission) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User '${user.name}' (ID: ${user.id}) denied permission for: manage_branches.`,
        });
        throw new Error("Access Denied: You do not have the required permissions.");
    }
    
    // If user is a district manager (has districtId), ensure they're only managing branches in their district
    if (isDistrictManager) {
        if (data.districtId !== user.districtId) {
            await logSecurityEvent({
                event: SecurityEvent.PERMISSION_DENIED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `User '${user.name}' (ID: ${user.id}) tried to manage branch in district ${data.districtId}, but only has access to district ${user.districtId}.`,
            });
            throw new Error("Access Denied: You can only manage branches in your assigned district.");
        }
        
        if (data.id) {
            // Check if the existing branch is in their district
            const existingBranch = await prisma.branch.findUnique({
                where: { id: data.id },
            });
            
            if (!existingBranch) {
                throw new Error("Branch not found.");
            }
            
            if (existingBranch.districtId !== user.districtId) {
                await logSecurityEvent({
                    event: SecurityEvent.PERMISSION_DENIED,
                    severity: LogSeverity.WARN,
                    actor: user,
                    details: `User '${user.name}' (ID: ${user.id}) tried to edit branch ${data.id} which is not in their district.`,
                });
                throw new Error("Access Denied: You can only manage branches in your assigned district.");
            }
        }
    }

    if (data.id) {
        await prisma.branch.update({ where: { id: data.id }, data });
        await logSecurityEvent({
            event: SecurityEvent.BRANCH_UPDATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Updated branch '${data.name}' (ID: ${data.id}).`,
            targetId: data.id,
            targetType: 'Branch',
        });
    } else {
        const newBranch = await prisma.branch.create({ data });
        await logSecurityEvent({
            event: SecurityEvent.BRANCH_CREATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Created new branch '${data.name}'.`,
            targetId: newBranch.id,
            targetType: 'Branch',
        });
    }
    revalidatePath('/dashboard/admin/branches');
}

export async function deleteBranch(id: string) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new Error("Not authenticated");
    }
    
    const hasManageBranchesPermission = user.role?.permissions?.includes('manage_branches');
    const isDistrictManager = user.districtId !== null;
    
    if (!hasManageBranchesPermission) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User '${user.name}' (ID: ${user.id}) denied permission for: manage_branches.`,
        });
        throw new Error("Access Denied: You do not have the required permissions.");
    }
    
    // Get the branch first to check district if needed
    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) {
        throw new Error("Branch not found.");
    }
    
    // If user is a district manager, check if branch is in their district
    if (isDistrictManager && branch.districtId !== user.districtId) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User '${user.name}' (ID: ${user.id}) tried to delete branch ${id} which is not in their district.`,
        });
        throw new Error("Access Denied: You can only manage branches in your assigned district.");
    }

    try {
        await prisma.branch.delete({ where: { id } });
        if (branch) {
            await logSecurityEvent({
                event: SecurityEvent.BRANCH_DELETED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `Deleted branch '${branch.name}' (ID: ${id}).`,
                targetId: id,
                targetType: 'Branch',
            });
        }
        revalidatePath('/dashboard/admin/branches');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete branch. It has associated users. Please reassign them first.',
            };
        }
        console.error('Error deleting branch:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function saveDistrict(data: { id?: string; name: string; code: string; officeId: string }) {
    const user = await hasPermission('manage_districts');
    if (data.id) {
        await prisma.district.update({ where: { id: data.id }, data });
        await logSecurityEvent({
            event: SecurityEvent.DISTRICT_UPDATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Updated district '${data.name}' (ID: ${data.id}).`,
            targetId: data.id,
            targetType: 'District',
        });
    } else {
        const newDistrict = await prisma.district.create({ data });
        await logSecurityEvent({
            event: SecurityEvent.DISTRICT_CREATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Created new district '${data.name}'.`,
            targetId: newDistrict.id,
            targetType: 'District',
        });
    }
    revalidatePath('/dashboard/admin/districts');
}

export async function deleteDistrict(id: string) {
    const user = await hasPermission('manage_districts');
    try {
        const district = await prisma.district.findUnique({ where: { id } });
        await prisma.district.delete({ where: { id } });
        if (district) {
            await logSecurityEvent({
                event: SecurityEvent.DISTRICT_DELETED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `Deleted district '${district.name}' (ID: ${id}).`,
                targetId: id,
                targetType: 'District',
            });
        }
        revalidatePath('/dashboard/admin/districts');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete district. It has associated branches. Please reassign/delete them first.',
            };
        }
        console.error('Error deleting district:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function saveOffice(data: {
    id?: string;
    name: string;
    code: string;
    type?: 'division_office' | 'branch_office' | 'head_office';
}) {
    const user = await hasPermission('manage_offices');
    const payload = {
        name: data.name,
        code: data.code,
        type: data.type || 'branch_office',
    };
    if (data.id) {
        await prisma.office.update({ where: { id: data.id }, data: payload });
        await logSecurityEvent({
            event: SecurityEvent.OFFICE_UPDATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Updated office '${data.name}' (ID: ${data.id}).`,
            targetId: data.id,
            targetType: 'Office',
        });
    } else {
        const newOffice = await prisma.office.create({ data: payload });
        await logSecurityEvent({
            event: SecurityEvent.OFFICE_CREATED,
            severity: LogSeverity.INFO,
            actor: user,
            details: `Created new office '${data.name}'.`,
            targetId: newOffice.id,
            targetType: 'Office',
        });
    }
    revalidatePath('/dashboard/admin/offices');
}

export async function deleteOffice(id: string) {
    const user = await hasPermission('manage_offices');
    try {
        const office = await prisma.office.findUnique({ where: { id } });
        await prisma.office.delete({ where: { id } });
        if (office) {
            await logSecurityEvent({
                event: SecurityEvent.OFFICE_DELETED,
                severity: LogSeverity.WARN,
                actor: user,
                details: `Deleted office '${office.name}' (ID: ${id}).`,
                targetId: id,
                targetType: 'Office',
            });
        }
        revalidatePath('/dashboard/admin/offices');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete office. It has associated users, departments, or districts. Please reassign/delete them first.',
            };
        }
        console.error('Error deleting office:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function saveRole(data: { id?: string; name: string; permissions: any; scope?: 'BRANCH' | 'DISTRICT' | 'HEAD_OFFICE' }) {
    const user = await hasPermission('manage_roles');
    const permissionsCsv = data.permissions.join(',');
    const scope = data.scope ?? 'BRANCH';
    if (data.id) {
        await prisma.role.update({
            where: { id: data.id },
            data: { name: data.name, permissions: permissionsCsv, scope },
        });
        await logSecurityEvent({
            event: SecurityEvent.ROLE_UPDATED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `Admin updated role '${data.name}' (ID: ${data.id}, scope: ${scope}). Permissions: ${permissionsCsv}`,
            targetId: data.id,
            targetType: 'Role',
        });
    } else {
        const newRole = await prisma.role.create({
            data: { name: data.name, permissions: permissionsCsv, scope },
        });
        await logSecurityEvent({
            event: SecurityEvent.ROLE_CREATED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `Admin created new role '${data.name}' (scope: ${scope}). Permissions: ${permissionsCsv}`,
            targetId: newRole.id,
            targetType: 'Role',
        });
    }
    revalidatePath('/dashboard/admin/roles');
    revalidatePath('/dashboard/admin/users');
}

export async function deleteRole(id: string) {
    const user = await hasPermission('manage_roles');
    try {
        const roleToDelete = await prisma.role.findUnique({ where: { id } });
        if (roleToDelete?.name === 'Admin') {
            return { error: 'The default Admin role cannot be deleted.' };
        }

        await prisma.role.delete({ where: { id: id } });

        await logSecurityEvent({
            event: SecurityEvent.ROLE_DELETED,
            severity: LogSeverity.CRITICAL,
            actor: user,
            details: `Admin deleted role '${roleToDelete?.name}' (ID: ${id}).`,
            targetId: id,
            targetType: 'Role',
        });
        revalidatePath('/dashboard/admin/roles');
        return { success: true };
    } catch (error: any) {
        if (
            (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') ||
            (error.message as string)?.includes('foreign key constraint')
        ) {
            return {
                error: 'Cannot delete role. It is currently assigned to one or more users.',
            };
        }
        console.error('Error deleting role:', error);
        return { error: 'An unexpected error occurred.' };
    }
}

export async function saveEmailSettings(settings: {
    notificationsEnabled: boolean;
    headerText: string;
    bodyText: string;
    footerText: string;
}) {
    const user = await hasPermission('manage_email_settings');
    await prisma.setting.upsert({
        where: { key: 'email' },
        update: { value: settings },
        create: { key: 'email', value: settings },
    });
    await logSecurityEvent({
        event: SecurityEvent.SETTINGS_UPDATED,
        severity: LogSeverity.WARN,
        actor: user,
        details: 'Email settings were updated.',
    });
    revalidatePath('/dashboard/admin/email');
    return { success: true };
}

export async function updateUserProfile(userId: string, data: { avatar?: string }) {
  const user = await getLoggedInUser();
  if (!user || (user.id !== userId && !user.actingUser)) {
    throw new Error("Unauthorized");
  }

  const currentUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!currentUser) {
    return { success: false, error: "User not found." };
  }

  // Only allow updating avatar as other fields are managed by AD
  const updateData: any = {
    avatar: data.avatar,
  };

  await prisma.user.update({ where: { id: userId }, data: updateData });
  await logSecurityEvent({ event: SecurityEvent.PROFILE_UPDATED, severity: LogSeverity.INFO, actor: user, details: `User updated their profile (avatar).`, targetId: userId, targetType: 'User' });

  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  return { success: true };
}

export async function getConcurrentLoginLogs(userId: string) {
    const user = await getLoggedInUser();
    if (!user || user.id !== userId) return [];

    const logs = await prisma.securityLog.findMany({
        where: {
            actorId: userId,
            event: 'CONCURRENT_LOGIN_ATTEMPT',
            timestamp: {
                gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
            }
        },
        orderBy: {
            timestamp: 'desc'
        }
    });

    return logs;
}

export async function addOrUpdateDelegate(data: { delegateId: string, permissions: DelegationPermission[] }) {
    const user = await getLoggedInUser();
    if (!user) throw new Error("Not authenticated");

    const existingDelegation = await prisma.delegation.findFirst({
        where: { delegatorId: user.id, delegateId: data.delegateId },
        include: { delegate: true }
    });

    if (existingDelegation) {
        await prisma.delegation.update({ where: { id: existingDelegation.id }, data: { permissions: data.permissions.join(',') } });
        await logSecurityEvent({ event: SecurityEvent.DELEGATION_UPDATED, severity: LogSeverity.WARN, actor: user, details: `User '${user.name}' updated delegation for '${existingDelegation.delegate.name}'. Permissions: ${data.permissions.join(',')}`, targetId: data.delegateId, targetType: 'User' });
    } else {
        await prisma.delegation.create({ data: { delegatorId: user.id, delegateId: data.delegateId, permissions: data.permissions.join(',') } });
        const delegateUser = await prisma.user.findUnique({where: {id: data.delegateId}});
        await logSecurityEvent({ event: SecurityEvent.DELEGATION_GRANTED, severity: LogSeverity.WARN, actor: user, details: `User '${user.name}' granted delegation to '${delegateUser?.name}'. Permissions: ${data.permissions.join(',')}`, targetId: data.delegateId, targetType: 'User' });
    }

    await revokeUserTokens(data.delegateId);

    revalidatePath('/dashboard/profile');
}

export async function removeDelegate(delegationId: string) {
    const user = await getLoggedInUser();
    if (!user) throw new Error("Not authenticated");

    const delegation = await prisma.delegation.findUnique({ where: { id: delegationId }, include: { delegate: true } });
    if (!delegation || delegation.delegatorId !== user.id) {
        throw new Error("You are not authorized to remove this delegation.");
    }

    await logSecurityEvent({ event: SecurityEvent.DELEGATION_REVOKED, severity: LogSeverity.WARN, actor: user, details: `User '${user.name}' revoked delegation from '${delegation.delegate.name}'.`, targetId: delegation.delegateId, targetType: 'User' });

    await prisma.delegation.delete({ where: { id: delegationId } });

    await revokeUserTokens(delegation.delegateId);

    revalidatePath('/dashboard/profile');
}

'use server';

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { LogSeverity, Permission, User } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { getGeneralSettings } from './settings';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AccessDeniedError, NotAuthenticatedError } from '@/lib/errors';
import { pagePermissions } from '@/lib/permissions';
import { normalizeNibEmail } from '@/lib/utils';
import { sendPasswordResetEmail, sendPasswordChangedNotificationEmail } from '@/lib/email';
import { passwordSchema } from '@/lib/password-policy';

/**
 * Returns the first application page this user is allowed to access,
 * optionally validating a preferred URL first (e.g. from NextAuth callbackUrl).
 */
export async function getFirstAccessiblePage(preferredUrl?: string | null): Promise<string> {
  const user = await getLoggedInUser();
  if (!user) return '/login';

  const userPerms = ((user.role?.permissions ?? '').split(',').filter(Boolean)) as Permission[];

  const canAccess = (pageDef: (typeof pagePermissions)[0]): boolean => {
    return pageDef.accessPermissions.some(p => userPerms.includes(p));
  };

  // Validate the preferred URL if provided
  if (preferredUrl && preferredUrl.startsWith('/dashboard')) {
    if (preferredUrl === '/dashboard/account') return preferredUrl;

    if (preferredUrl.startsWith('/dashboard/admin')) {
      const hasAdmin = pagePermissions
        .filter(p => p.section !== 'main')
        .some(p => canAccess(p));
      if (hasAdmin) return preferredUrl;
    }

    const matchingPage = pagePermissions.find(p => preferredUrl.startsWith(p.path));
    if (matchingPage && canAccess(matchingPage)) return preferredUrl;
  }

  // Walk main pages in definition order
  for (const page of pagePermissions.filter(p => p.section === 'main')) {
    if (canAccess(page)) return page.path;
  }

  // Any admin page grants entry to admin dashboard
  const hasAdmin = pagePermissions
    .filter(p => p.section !== 'main')
    .some(p => canAccess(p));
  if (hasAdmin) return '/dashboard/admin';

  // Account self-service is always accessible
  return '/dashboard/account';
}

export async function getLoggedInUser(): Promise<User | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return null;
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
            role: true,
            edir: true,
        }
    });

    if (!user) return null;

    return user as User;
}

export async function hasPermission(permission: Permission | Permission[]): Promise<void> {
    const user = await getLoggedInUser();
    if (!user) {
        throw new NotAuthenticatedError();
    }

    const requiredPermissions = Array.isArray(permission) ? permission : [permission];
    const userPermissions = user.role?.permissions ? user.role.permissions.split(',') : [];
    
    const hasRequiredPermission = requiredPermissions.every(p => userPermissions.includes(p));

    if (!hasRequiredPermission) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User '${user.name}' (ID: ${user.id}) denied permission for: ${requiredPermissions.join(', ')}.`,
        });
        throw new AccessDeniedError();
    }
}

export async function revokeUserTokens(userId: string) {
    const user = await getLoggedInUser();
    if (!user || (user.id !== userId && !(user.role?.permissions?.includes('manage_users')))) {
        throw new Error("Unauthorized to revoke tokens.");
    }

    await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } }
    });

    await logSecurityEvent({ event: SecurityEvent.LOGOUT, severity: LogSeverity.INFO, actor: user, details: `All sessions for user ID ${userId} were revoked by ${user?.name}.`, targetId: userId, targetType: 'User' });

    return { success: true };
}

// Verify password reset token
export async function verifyPasswordResetToken(token: string) {
    const resetToken = await prisma.passwordResetToken.findUnique({
        where: { token }
    });

    if (!resetToken) {
        return { valid: false, error: "Invalid or expired token" };
    }

    if (new Date() > resetToken.expires) {
        return { valid: false, error: "Token has expired" };
    }

    return { valid: true, email: resetToken.email };
}

// Set password (handles both initial account setup and password resets)
export async function setPassword(token: string, newPassword: string) {
    const result = await verifyPasswordResetToken(token);
    if (!result.valid) {
        return { success: false, error: result.error };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const user = await prisma.user.findUnique({
        where: { email: result.email },
        select: { id: true, name: true, email: true, onboardingCompleted: true },
    });

    if (!user) {
        return { success: false, error: 'User not found' };
    }

    const isReset = user.onboardingCompleted === true;

    await prisma.user.update({
        where: { id: user.id },
        data: { hashedPassword, onboardingCompleted: true },
    });

    await prisma.passwordResetToken.delete({ where: { token } });

    await logSecurityEvent({
        event: SecurityEvent.PASSWORD_CHANGE_SUCCESS,
        severity: LogSeverity.INFO,
        actor: user as any,
        details: isReset
            ? `User '${user.name}' (ID: ${user.id}) successfully reset their password.`
            : `User '${user.name}' (ID: ${user.id}) completed initial password setup.`,
        targetId: user.id,
        targetType: 'User',
    });

    // For password resets (not initial setup) send a security notification
    if (isReset && user.email) {
        await sendPasswordChangedNotificationEmail({
            to: user.email,
            name: user.name ?? 'User',
        });
    }

    return { success: true };
}

/**
 * Complete the mandatory first-login password change. The account stays in the
 * "First Login Required" state (mustChangePassword) until this succeeds; only
 * then is full access granted. No current password is required because the user
 * is already authenticated and just used their temporary password to sign in.
 */
export async function completeFirstLoginPasswordChange(newPassword: string) {
  const user = await getLoggedInUser();
  if (!user) {
    return { success: false, error: 'Your session has ended. Please sign in again.' };
  }
  // Only valid while the account is actually in the first-login state.
  if (!(user as any).mustChangePassword) {
    return { success: false, error: 'No password change is required for this account.' };
  }

  const validation = await passwordSchema.safeParseAsync(newPassword);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message || 'Password does not meet the security requirements.' };
  }
  if (user.hashedPassword && await bcrypt.compare(newPassword, user.hashedPassword)) {
    return { success: false, error: 'Please choose a password different from your temporary one.' };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword, mustChangePassword: false, onboardingCompleted: true, passwordChangedAt: new Date() },
  });

  await logSecurityEvent({
    event: SecurityEvent.PASSWORD_CHANGE_SUCCESS,
    severity: LogSeverity.INFO,
    actor: user,
    details: `User '${user.name}' (ID: ${user.id}) completed the mandatory first-login password change.`,
    targetId: user.id,
    targetType: 'User',
  });

  return { success: true };
}

// Change password for the currently authenticated user
export async function changePassword(currentPassword: string, newPassword: string) {
    const user = await getLoggedInUser();
    if (!user) {
        throw new NotAuthenticatedError();
    }

    if (!user.hashedPassword) {
        return { success: false, error: 'No password is set for this account.' };
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.hashedPassword);
    if (!isCurrentPasswordValid) {
        await logSecurityEvent({
            event: SecurityEvent.PASSWORD_CHANGE_FAILURE,
            severity: LogSeverity.WARN,
            actor: user,
            details: `User '${user.name}' (ID: ${user.id}) provided an incorrect current password while attempting to change their password.`,
            targetId: user.id,
            targetType: 'User',
        });
        return { success: false, error: 'Current password is incorrect.' };
    }

    if (currentPassword === newPassword) {
        return { success: false, error: 'New password must be different from your current password.' };
    }

    const validation = await passwordSchema.safeParseAsync(newPassword);
    if (!validation.success) {
        return { success: false, error: validation.error.issues[0]?.message || 'Password does not meet the security requirements.' };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
        where: { id: user.id },
        data: { hashedPassword, tokenVersion: { increment: 1 } },
    });

    await logSecurityEvent({
        event: SecurityEvent.PASSWORD_CHANGE_SUCCESS,
        severity: LogSeverity.INFO,
        actor: user,
        details: `User '${user.name}' (ID: ${user.id}) changed their own password.`,
        targetId: user.id,
        targetType: 'User',
    });

    if (user.email) {
        await sendPasswordChangedNotificationEmail({
            to: user.email,
            name: user.name ?? 'User',
        });
    }

    return { success: true };
}

// Request a self-service password reset link
export async function requestPasswordReset(email: string): Promise<{ success: true }> {
    const normalizedEmail = normalizeNibEmail(email);

    try {
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true, name: true, email: true },
        });

        if (user) {
            // Rate limit: allow one request every 5 minutes per email address
            const existing = await prisma.passwordResetToken.findUnique({
                where: { email: normalizedEmail },
            });
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

            if (!existing || existing.createdAt <= fiveMinutesAgo) {
                const token = crypto.randomBytes(32).toString('hex');
                const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

                await prisma.passwordResetToken.upsert({
                    where:  { email: normalizedEmail },
                    update: { token, expires, createdAt: new Date() },
                    create: { email: normalizedEmail, token, expires },
                });

                await sendPasswordResetEmail({
                    to: normalizedEmail,
                    name: user.name ?? 'User',
                    token,
                });

                await logSecurityEvent({
                    event: SecurityEvent.PASSWORD_RESET_REQUEST,
                    severity: LogSeverity.INFO,
                    actor: user as any,
                    details: `Password reset link requested for '${user.name}' (${normalizedEmail}).`,
                    targetId: user.id,
                    targetType: 'User',
                });
            }
            // If within rate-limit window, silently skip — still return success
        }
    } catch (error) {
        // Swallow errors silently — never reveal whether the address is registered
        console.error('requestPasswordReset error:', error);
    }

    // Always return success to prevent user-enumeration attacks
    return { success: true };
}



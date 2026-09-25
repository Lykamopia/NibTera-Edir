'use server';

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { LogSeverity, Permission, User } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcrypt';
import { AccessDeniedError, NotAuthenticatedError } from '@/lib/errors';
import { pagePermissions } from '@/lib/permissions';
import { IMPLEMENTED_PAGES } from '@/lib/nav';
import { normalizeNibEmail } from '@/lib/utils';
import { sendPasswordChangedNotificationEmail } from '@/lib/email';
import { issueSetPasswordLink } from '@/lib/set-password-link';
import { validatePassword } from '@/lib/password-policy';
import { getCurrentSessionId, revokeAllUserSessions } from '@/lib/sessions';
import { enforceServerActionCsrf } from '@/lib/csrf';
import { getActor, actorHasPermission, assertSameTenant } from '@/lib/tenant-scope';

/**
 * Returns the first application page this user is allowed to access,
 * optionally validating a preferred URL first (e.g. from NextAuth callbackUrl).
 */
export async function getFirstAccessiblePage(preferredUrl?: string | null): Promise<string> {
  const user = await getLoggedInUser();
  if (!user) return '/login';

  const userPerms = ((user.role?.permissions ?? '').split(',').filter(Boolean)) as Permission[];
  const isSuperAdmin = userPerms.includes('super_admin' as Permission);

  // Super-Admins land on the platform dashboard.
  if (isSuperAdmin) return '/dashboard';

  const canAccess = (pageDef: (typeof pagePermissions)[0]): boolean =>
    pageDef.accessPermissions.some(p => userPerms.includes(p));

  // Honour a valid preferred URL (e.g. NextAuth callbackUrl) when it maps to a
  // real, implemented page the user can access. Account is always allowed.
  const SAFE_DASHBOARD_PATH = /^\/dashboard(\/[A-Za-z0-9_-]+)*\/?(\?[A-Za-z0-9_=&%.-]*)?$/;
  if (typeof preferredUrl === 'string' && preferredUrl.length <= 300 && SAFE_DASHBOARD_PATH.test(preferredUrl)) {
    if (preferredUrl === '/dashboard/account') return preferredUrl;
    const matching = [...pagePermissions]
      .filter(p => IMPLEMENTED_PAGES.has(p.id) && preferredUrl.startsWith(p.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (matching && canAccess(matching)) return preferredUrl;
  }

  // First accessible, implemented page in definition order (Dashboard first).
  for (const page of pagePermissions) {
    if (IMPLEMENTED_PAGES.has(page.id) && canAccess(page)) return page.path;
  }

  // Default for everyone else: self-service account (always available).
  return '/dashboard/account';
}

export async function getLoggedInUser(): Promise<User | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
        return null;
    }

    // Every authenticated server action resolves its caller here (or via
    // getActor), so this is where a forged action is stopped: no valid
    // session-bound CSRF token, no user — and no state change.
    await enforceServerActionCsrf(session.user as { id: string; name?: string | null });

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
            role: true,
            edir: true,
        }
    });

    if (!user) return null;

    // Never let the password hash leave the server boundary. This object is
    // returned from a 'use server' action and may be serialized to client
    // components; the hash is verified only via dedicated server-side lookups.
    (user as any).hashedPassword = null;

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
    // Authorize inside the action (never rely on routing): a user may revoke their
    // own sessions; revoking someone else's needs manage_users AND the target must
    // be within the actor's tenant scope (super-admin: any).
    const actor = await getActor();
    const user = { id: actor.id, name: actor.name ?? actor.id };
    if (typeof userId !== 'string' || !userId) throw new AccessDeniedError('Unauthorized to revoke tokens.');
    if (actor.id !== userId) {
        if (!actorHasPermission(actor, 'manage_users')) throw new AccessDeniedError('Unauthorized to revoke tokens.');
        const target = await prisma.user.findUnique({ where: { id: userId }, select: { edirId: true } });
        if (!target) throw new AccessDeniedError('Unauthorized to revoke tokens.');
        if (!actor.isSuperAdmin) await assertSameTenant(actor, target.edirId);
    }

    const count = await revokeAllUserSessions(userId, actor.id === userId ? 'user_revoked' : 'admin_revoked');

    await logSecurityEvent({ event: SecurityEvent.SESSIONS_REVOKED, severity: LogSeverity.WARN, actor: user, details: `All sessions (${count}) for user ID ${userId} were revoked by ${user.name}.`, targetId: userId, targetType: 'User' });

    return { success: true };
}

// Verify password reset token
export async function verifyPasswordResetToken(token: string) {
    // Tokens are 32 random bytes, hex-encoded (src/lib/set-password-link.ts).
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
        return { valid: false, error: "Invalid or expired token" };
    }
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
    if (typeof newPassword !== 'string' || newPassword.length > 256) return { success: false, error: 'Invalid password.' };
    const result = await verifyPasswordResetToken(token);
    if (!result.valid) {
        return { success: false, error: result.error };
    }

    const user = await prisma.user.findUnique({
        where: { email: result.email },
        select: { id: true, name: true, email: true, phone: true, onboardingCompleted: true, status: true },
    });

    if (!user) {
        return { success: false, error: 'User not found' };
    }

    // Same policy as every other password-setting path — this one covers both
    // invitation (account registration) and password reset. The token is only
    // consumed once a compliant password is accepted.
    const policy = await validatePassword(newPassword, user);
    if (!policy.ok) {
        return { success: false, error: policy.error };
    }
    // Fetch the hash separately so it never rides along on `user` (logged below).
    const cred = await prisma.user.findUnique({ where: { id: user.id }, select: { hashedPassword: true } });
    if (cred?.hashedPassword && await bcrypt.compare(newPassword, cred.hashedPassword)) {
        return { success: false, error: 'Please choose a password different from your current one.' };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const isReset = user.onboardingCompleted === true;

    await prisma.user.update({
        where: { id: user.id },
        data: {
            hashedPassword,
            onboardingCompleted: true,
            // The user has now set their own password — clear the first-login flag,
            // and activate an invited account so they can sign in. (Don't reactivate
            // a SUSPENDED/INACTIVE account via a reset.)
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            ...(user.status === 'INVITED' ? { status: 'ACTIVE' as const } : {}),
        },
    });

    // A password reset means the old password may be known to someone else:
    // end every existing session on every device (and bump tokenVersion).
    await revokeAllUserSessions(user.id, 'password_reset');

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
 *
 * CSRF: enforced (like every authenticated server action) by the middleware and
 * by getLoggedInUser, before anything below is inspected.
 */
export async function completeFirstLoginPasswordChange(newPassword: string) {
  if (typeof newPassword !== 'string' || newPassword.length > 256) return { success: false, error: 'Invalid password.' };
  const user = await getLoggedInUser();
  if (!user) {
    return { success: false, error: 'Your session has ended. Please sign in again.' };
  }

  // Only valid while the account is actually in the first-login state.
  if (!(user as any).mustChangePassword) {
    return { success: false, error: 'No password change is required for this account.' };
  }

  // Full server-side policy, including the user's own name/email/phone.
  const policy = await validatePassword(newPassword, user);
  if (!policy.ok) {
    return { success: false, error: policy.error };
  }
  // Fetch the hash directly (getLoggedInUser strips it from its response).
  const cred = await prisma.user.findUnique({ where: { id: user.id }, select: { hashedPassword: true } });
  if (cred?.hashedPassword && await bcrypt.compare(newPassword, cred.hashedPassword)) {
    return { success: false, error: 'Please choose a password different from your temporary one.' };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword, mustChangePassword: false, onboardingCompleted: true, passwordChangedAt: new Date() },
  });

  // The temporary password may have been seen by others: end every session
  // except the one that just proved it knows the new password.
  await revokeAllUserSessions(user.id, 'password_change', { exceptSessionId: await getCurrentSessionId() });

  await logSecurityEvent({
    event: SecurityEvent.PASSWORD_CHANGE_SUCCESS,
    severity: LogSeverity.INFO,
    actor: user,
    details: `User '${user.name}' (ID: ${user.id}) completed the mandatory first-login password change.`,
    targetId: user.id,
    targetType: 'User',
  });

  // The client then calls NextAuth `update()`, which rotates the session's CSRF
  // binding so no token issued before the change remains valid.
  return { success: true };
}

// Change password for the currently authenticated user. CSRF is enforced by the
// middleware and by getLoggedInUser before the current password is verified, so
// the endpoint cannot double as a cross-site password-guessing oracle.
export async function changePassword(currentPassword: string, newPassword: string) {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || currentPassword.length > 256 || newPassword.length > 256) {
        return { success: false, error: 'Invalid password.' };
    }
    const user = await getLoggedInUser();
    if (!user) {
        throw new NotAuthenticatedError();
    }

    // Fetch the hash directly (getLoggedInUser strips it from its response).
    const cred = await prisma.user.findUnique({ where: { id: user.id }, select: { hashedPassword: true } });
    if (!cred?.hashedPassword) {
        return { success: false, error: 'No password is set for this account.' };
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, cred.hashedPassword);
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

    // Full server-side policy, including the user's own name/email/phone.
    const policy = await validatePassword(newPassword, user);
    if (!policy.ok) {
        return { success: false, error: policy.error };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
        where: { id: user.id },
        data: { hashedPassword, passwordChangedAt: new Date() },
    });

    // End every other session (a changed password usually means the old one
    // may be compromised). The current session — which just re-proved the
    // current password — stays signed in.
    const endedSessions = await revokeAllUserSessions(user.id, 'password_change', { exceptSessionId: await getCurrentSessionId() });

    await logSecurityEvent({
        event: SecurityEvent.PASSWORD_CHANGE_SUCCESS,
        severity: LogSeverity.INFO,
        actor: user,
        details: `User '${user.name}' (ID: ${user.id}) changed their own password; ${endedSessions} other session(s) were signed out.`,
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
    // Same response for malformed input as for unknown accounts (no enumeration).
    if (typeof email !== 'string' || email.length > 254 || /[\s<>\u0000-\u001F]/.test(email.trim())) return { success: true };
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
                // Mint the 1h token and email the reset link (shared with every
                // other credential flow) — enumeration protection still returns
                // success regardless of the delivery result.
                await issueSetPasswordLink({ email: normalizedEmail, name: user.name, mode: 'reset' });

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



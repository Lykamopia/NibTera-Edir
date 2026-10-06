import { cookies } from 'next/headers';
import { getToken } from 'next-auth/jwt';
import prisma from './prisma';
import { SESSION_COOKIE_NAME } from './session-cookie';

/**
 * Centralized server-side session management.
 *
 * Every sign-in creates a `UserSession` row; the (encrypted, httpOnly) session
 * JWT carries its id as `sid`. The NextAuth `jwt` callback — which runs on every
 * server-side session read (pages, server actions, API routes) — calls
 * `validateSession`, so the database row, not the cookie, decides whether a
 * session is alive:
 *
 *  - revoked      → logout, "sign out" of a device, password reset/change,
 *                   admin action, suspected hijack
 *  - idle         → no activity for SESSION_IDLE_TIMEOUT_MS
 *  - expired      → older than SESSION_ABSOLUTE_TIMEOUT_MS, regardless of activity
 *  - invalidated  → user.tokenVersion moved on (role/status change etc. — the
 *                   existing "revoke everything" switch keeps working)
 */

/** Idle timeout: a session with no server activity for this long is dead. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Absolute lifetime: re-authentication is required after this, active or not. */
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
/**
 * Concurrent sessions allowed per user. A fresh sign-in (re-authentication)
 * revokes every other session of that user, so only the newest one is ever
 * valid. Tokens held by other browsers/devices die on their next request
 * (checked in src/proxy.ts and in the NextAuth jwt callback).
 */
export const MAX_ACTIVE_SESSIONS_PER_USER = 1;
/** Activity is written at most this often per session (keeps reads cheap). */
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

export type SessionRevokeReason =
  | 'logout'
  | 'user_revoked'
  | 'user_revoked_others'
  | 'password_reset'
  | 'password_change'
  | 'admin_revoked'
  | 'idle_timeout'
  | 'expired'
  | 'invalidated'
  | 'session_limit'
  | 'superseded'
  | 'ip_mismatch'
  | 'user_agent_mismatch';

export type SessionValidation = { valid: true } | { valid: false; reason: SessionRevokeReason | 'unknown_session' };

export async function createUserSession(input: {
  userId: string;
  tokenVersion: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string; expiresAt: Date }> {
  const now = new Date();
  const session = await prisma.userSession.create({
    data: {
      userId: input.userId,
      tokenVersion: input.tokenVersion,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS),
    },
    select: { id: true, expiresAt: true },
  });

  // Enforce the concurrent-session cap: keep the new session plus the newest
  // (MAX - 1) others. Every other unrevoked row is revoked — whatever its
  // tokenVersion or idle state — so no older token can ever come back to life.
  const others = await prisma.userSession.findMany({
    where: { userId: input.userId, revokedAt: null, id: { not: session.id } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const excess = others.slice(Math.max(0, MAX_ACTIVE_SESSIONS_PER_USER - 1)).map((s) => s.id);
  if (excess.length > 0) {
    await prisma.userSession.updateMany({
      where: { id: { in: excess }, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'superseded' },
    });
  }

  return session;
}

/**
 * Check that `sessionId` is a live session of `userId` at `tokenVersion`, and
 * record activity. A session that fails because of idleness or age is marked
 * revoked so it can never come back.
 */
export async function validateSession(sessionId: unknown, userId: string, tokenVersion: number): Promise<SessionValidation> {
  if (typeof sessionId !== 'string' || !sessionId) return { valid: false, reason: 'unknown_session' };

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, tokenVersion: true, lastActiveAt: true, expiresAt: true, revokedAt: true, revokedReason: true },
  });
  if (!session || session.userId !== userId) return { valid: false, reason: 'unknown_session' };
  if (session.revokedAt) return { valid: false, reason: (session.revokedReason as SessionRevokeReason) ?? 'user_revoked' };

  const now = Date.now();
  let failure: SessionRevokeReason | null = null;
  if (session.tokenVersion !== tokenVersion) failure = 'invalidated';
  else if (now >= session.expiresAt.getTime()) failure = 'expired';
  else if (now - session.lastActiveAt.getTime() >= SESSION_IDLE_TIMEOUT_MS) failure = 'idle_timeout';

  if (failure) {
    await revokeSession(sessionId, failure);
    return { valid: false, reason: failure };
  }

  if (now - session.lastActiveAt.getTime() >= ACTIVITY_WRITE_INTERVAL_MS) {
    await prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastActiveAt: new Date(now) },
    });
  }
  return { valid: true };
}

/**
 * Read-only liveness check for long-lived connections (SSE streams): is the
 * session still unrevoked, within its idle/absolute limits and at the user's
 * current tokenVersion? Unlike `validateSession` it never records activity, so
 * an open background stream cannot keep an idle session alive.
 */
export async function isSessionActive(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: {
      userId: true, tokenVersion: true, lastActiveAt: true, expiresAt: true, revokedAt: true,
      user: { select: { tokenVersion: true } },
    },
  });
  if (!session || session.userId !== userId || session.revokedAt) return false;
  const now = Date.now();
  return (
    session.tokenVersion === session.user.tokenVersion &&
    now < session.expiresAt.getTime() &&
    now - session.lastActiveAt.getTime() < SESSION_IDLE_TIMEOUT_MS
  );
}

/** Revoke one session. Returns true if it was live. */
export async function revokeSession(sessionId: string, reason: SessionRevokeReason, userId?: string): Promise<boolean> {
  const { count } = await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null, ...(userId ? { userId } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count > 0;
}

/**
 * Revoke every session of `userId`, optionally keeping one (the caller's own,
 * for "sign out other devices" or a password change). Revoking *all* also bumps
 * user.tokenVersion, so any token not backed by a row dies as well.
 */
export async function revokeAllUserSessions(
  userId: string,
  reason: SessionRevokeReason,
  options: { exceptSessionId?: string | null } = {},
): Promise<number> {
  const except = options.exceptSessionId ?? null;
  const { count } = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null, ...(except ? { id: { not: except } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  if (!except) {
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  }
  return count;
}

/** Prisma filter for a user's currently live sessions. */
export function activeSessionWhere(userId: string, tokenVersion: number) {
  const now = new Date();
  return {
    userId,
    tokenVersion,
    revokedAt: null,
    expiresAt: { gt: now },
    lastActiveAt: { gt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS) },
  };
}

/** The `sid` of the session making the current request (from the encrypted JWT). */
export async function getCurrentSessionId(): Promise<string | null> {
  const token = await getToken({
    req: { cookies: await cookies(), headers: {} } as any,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: SESSION_COOKIE_NAME,
  });
  return typeof token?.sid === 'string' ? token.sid : null;
}

/** Delete session rows that can never be valid again (keeps the table small). */
export async function purgeDeadSessions(retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.userSession.deleteMany({
    where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
  });
  return count;
}

/** Short human label for a user agent, e.g. "Chrome on Windows". */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
}

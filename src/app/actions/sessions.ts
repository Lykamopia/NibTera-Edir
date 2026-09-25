'use server';

import prisma from '@/lib/prisma';
import { LogSeverity } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { NotAuthenticatedError } from '@/lib/errors';
import {
  activeSessionWhere,
  describeUserAgent,
  getCurrentSessionId,
  revokeAllUserSessions,
  revokeSession,
} from '@/lib/sessions';
import { getLoggedInUser } from './auth';

export type ActiveSessionView = {
  id: string;
  device: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
};

async function requireUser() {
  const user = await getLoggedInUser();
  if (!user) throw new NotAuthenticatedError();
  return user;
}

/** The signed-in user's live sessions (devices), newest activity first. */
export async function listMySessions(): Promise<ActiveSessionView[]> {
  const user = await requireUser();
  const currentId = await getCurrentSessionId();
  const sessions = await prisma.userSession.findMany({
    where: activeSessionWhere(user.id, user.tokenVersion),
    orderBy: { lastActiveAt: 'desc' },
    select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastActiveAt: true, expiresAt: true },
  });
  return sessions.map((s) => ({
    id: s.id,
    device: describeUserAgent(s.userAgent),
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    lastActiveAt: s.lastActiveAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentId,
  }));
}

/**
 * Sign one of the user's own sessions out. Scoped to the caller's user id, so
 * a session id belonging to someone else is simply "not found".
 */
export async function revokeMySession(sessionId: string): Promise<{ success: boolean; error?: string; signedOutSelf?: boolean }> {
  const user = await requireUser();
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return { success: false, error: 'Session not found.' };

  const revoked = await revokeSession(sessionId, 'user_revoked', user.id);
  if (!revoked) return { success: false, error: 'Session not found or already signed out.' };

  await logSecurityEvent({
    event: SecurityEvent.SESSION_REVOKED,
    severity: LogSeverity.INFO,
    actor: user,
    details: `User '${user.name}' (ID: ${user.id}) signed out session ${sessionId}.`,
    targetId: user.id,
    targetType: 'User',
  });
  return { success: true, signedOutSelf: sessionId === (await getCurrentSessionId()) };
}

/** Sign out every session except the one making this request. */
export async function revokeMyOtherSessions(): Promise<{ success: boolean; count: number }> {
  const user = await requireUser();
  const currentId = await getCurrentSessionId();
  if (!currentId) throw new NotAuthenticatedError();

  const count = await revokeAllUserSessions(user.id, 'user_revoked_others', { exceptSessionId: currentId });
  await logSecurityEvent({
    event: SecurityEvent.SESSIONS_REVOKED,
    severity: LogSeverity.INFO,
    actor: user,
    details: `User '${user.name}' (ID: ${user.id}) signed out ${count} other session(s).`,
    targetId: user.id,
    targetType: 'User',
  });
  return { success: true, count };
}

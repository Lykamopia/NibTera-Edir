// Deliberately NOT 'use server': these helpers take caller-supplied user ids and
// perform no authentication, so they must only be called from server code that
// has already resolved the actor (getActor/requireActor). Exposing them as
// Server Actions would let anyone forge approval events or read approval data.

import 'server-only'; // build fails if a client component ever imports this module

import prisma from '@/lib/prisma';
import { type ApprovalModule } from '@prisma/client';

/**
 * Approval Tracking System
 * Manages maker-checker workflow with history, comments, and notifications
 */

export interface ApprovalHistory {
  id: string;
  requestId: string;
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'RESUBMITTED';
  actorId: string;
  actorName: string;
  actorEmail: string;
  comment: string | null;
  timestamp: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED';
}

/**
 * Check if a user can approve a request (prevent maker from being checker)
 */
export async function canUserApprove(
  requestId: string,
  userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: { makerId: true, status: true },
    });

    if (!request) {
      return { allowed: false, reason: 'Approval request not found' };
    }

    // Cannot approve if already processed
    if (request.status !== 'PENDING') {
      return { allowed: false, reason: 'This request has already been processed' };
    }

    // Cannot approve if you are the maker (same user)
    if (request.makerId === userId) {
      return { allowed: false, reason: 'You cannot approve your own submission' };
    }

    return { allowed: true };
  } catch (error) {
    return { allowed: false, reason: 'Error checking approval eligibility' };
  }
}

/**
 * Get approval history with all events and comments
 */
/** ApprovalEvent.type → the coarse status the history UI displays. */
const EVENT_STATUS: Record<string, ApprovalHistory['status']> = {
  SUBMITTED: 'PENDING', COMMENTED: 'PENDING', RESUBMITTED: 'PENDING',
  APPROVED: 'APPROVED', EXECUTED: 'APPROVED', REJECTED: 'REJECTED', RETURNED: 'RETURNED',
};

export async function getApprovalHistory(requestId: string): Promise<ApprovalHistory[]> {
  try {
    const events = await prisma.approvalEvent.findMany({
      where: { requestId },
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return events.map((event) => ({
      id: event.id,
      requestId: event.requestId,
      action: event.type as any,
      actorId: event.actor.id,
      actorName: event.actor.name || 'System',
      actorEmail: event.actor.email || '',
      comment: event.comment,
      timestamp: event.createdAt,
      status: EVENT_STATUS[event.type] ?? 'PENDING',
    }));
  } catch (error) {
    console.error('Failed to get approval history:', error);
    return [];
  }
}

/**
 * Create approval event with comment (for history tracking)
 */
export async function createApprovalEvent(
  requestId: string,
  userId: string,
  type: 'SUBMITTED' | 'COMMENTED' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'RETURNED' | 'RESUBMITTED',
  comment?: string
) {
  try {
    const event = await prisma.approvalEvent.create({
      data: {
        requestId,
        actorId: userId,
        type,
        comment: comment || null,
      },
      include: {
        actor: { select: { name: true, email: true } },
      },
    });

    return { success: true, event };
  } catch (error) {
    console.error('Failed to create approval event:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get approval statistics for a scope
 */
export async function getApprovalStats(
  scope: 'BRANCH' | 'DISTRICT' | 'HEAD_OFFICE',
  scopeId?: string
) {
  try {
    const where: any = {};

    if (scope === 'BRANCH' && scopeId) {
      where.edir = { branchId: scopeId };
    } else if (scope === 'DISTRICT' && scopeId) {
      where.edir = { branch: { districtId: scopeId } };
    }

    const [total, pending, approved, rejected, returned] = await Promise.all([
      prisma.approvalRequest.count({ where }),
      prisma.approvalRequest.count({ where: { ...where, status: 'PENDING' } }),
      prisma.approvalRequest.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.approvalRequest.count({ where: { ...where, status: 'REJECTED' } }),
      prisma.approvalRequest.count({ where: { ...where, status: 'RETURNED' } }),
    ]);

    return {
      success: true,
      data: {
        total,
        pending,
        approved,
        rejected,
        returned,
        averageResolutionTime: 'N/A', // Could be calculated from timestamps
      },
    };
  } catch (error) {
    console.error('Failed to get approval stats:', error);
    return { success: false, error: 'Failed to load statistics' };
  }
}

/**
 * Get pending approvals for a user based on their checker permissions
 */
export async function getPendingApprovalsForUser(userId: string, module?: ApprovalModule) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { permissions: true } } },
    });

    if (!user) return { success: false, error: 'User not found' };

    const permissions = (user.role?.permissions ?? '').split(',').map((p) => p.trim()).filter(Boolean);

    // Build where clause based on module and permissions
    const where: any = {
      status: 'PENDING',
      NOT: { makerId: userId }, // Exclude own submissions
    };

    if (module) {
      where.module = module;
    }

    const approvals = await prisma.approvalRequest.findMany({
      where,
      include: {
        edir: { select: { id: true, name: true } },
        maker: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    return { success: true, data: approvals };
  } catch (error) {
    console.error('Failed to get pending approvals:', error);
    return { success: false, error: 'Failed to load approvals' };
  }
}

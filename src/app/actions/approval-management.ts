'use server';

import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import {
  canUserApprove,
  getPendingApprovalsForUser,
  getApprovalHistory,
} from '@/lib/approval-tracking';
import { approveRequest, rejectRequest, returnRequest, commentOnRequest } from '@/lib/approval-engine';

function failure(error: unknown) {
  console.error('Approval management error:', error);
  return { success: false as const, error: error instanceof Error ? error.message : 'An error occurred' };
}

/**
 * Approve an approval request (Checker action)
 */
export async function approveApprovalRequest(requestId: string, comment?: string) {
  try {
    // Delegate to the single generic engine — it validates the checker (not the
    // maker, holds the module's checker permission), runs the module executor,
    // records APPROVED/EXECUTED events, audits, and notifies, all in one
    // transaction with the correct schema.
    await approveRequest(requestId, comment);
    revalidatePath('/dashboard/approvals');
    return { success: true as const, message: 'Request approved successfully' };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Reject an approval request (Checker action)
 */
export async function rejectApprovalRequest(requestId: string, reason: string) {
  try {
    if (!reason?.trim()) return failure(new Error('Rejection reason is required'));
    await rejectRequest(requestId, reason);
    revalidatePath('/dashboard/approvals');
    return { success: true as const, message: 'Request rejected' };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Return a request for revision (Checker action)
 */
export async function returnApprovalForRevision(requestId: string, revisionNotes: string) {
  try {
    if (!revisionNotes?.trim()) return failure(new Error('Revision notes are required'));
    await returnRequest(requestId, revisionNotes);
    revalidatePath('/dashboard/approvals');
    return { success: true as const, message: 'Request returned for revision' };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Get approval request details with full history
 */
export async function getApprovalRequestDetail(requestId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'view_approvals');

    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: {
        edir: true,
        maker: { select: { id: true, name: true, email: true } },
        checker: { select: { id: true, name: true, email: true } },
      },
    });

    if (!request) return failure(new Error('Request not found'));

    const history = await getApprovalHistory(requestId);

    // Check if current user can approve
    const canApprove = await canUserApprove(requestId, actor.id);

    return {
      success: true as const,
      data: {
        ...request,
        history,
        canApprove: canApprove.allowed,
        cannotApproveReason: canApprove.allowed ? null : canApprove.reason,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Get all pending approvals for the current user
 */
export async function getMyPendingApprovals(module?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'view_approvals');

    const result = await getPendingApprovalsForUser(actor.id, module as any);
    return result;
  } catch (error) {
    return failure(error);
  }
}

/**
 * Add comment to approval history (for discussion)
 */
export async function addApprovalComment(requestId: string, comment: string) {
  try {
    if (!comment?.trim()) return failure(new Error('Comment is required'));
    // The engine records a COMMENTED event without changing status.
    await commentOnRequest(requestId, comment);
    revalidatePath('/dashboard/approvals');
    return { success: true as const, message: 'Comment added' };
  } catch (error) {
    return failure(error);
  }
}

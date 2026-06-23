'use server';

import { getActor, assertPermission } from '@/lib/tenant-scope';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { writeAudit } from '@/lib/audit';
import {
  canUserApprove,
  createApprovalEvent,
  notifyApprovalStatusChange,
  getPendingApprovalsForUser,
  getApprovalHistory,
} from '@/lib/approval-tracking';
import { approveRequest, rejectRequest, returnRequest } from '@/lib/approval-engine';

function failure(error: unknown) {
  console.error('Approval management error:', error);
  return { success: false as const, error: error instanceof Error ? error.message : 'An error occurred' };
}

/**
 * Approve an approval request (Checker action)
 */
export async function approveApprovalRequest(requestId: string, comment?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, 'view_approvals');

    // Check if user can approve (not the maker)
    const canApprove = await canUserApprove(requestId, actor.id);
    if (!canApprove.allowed) {
      return failure(new Error(canApprove.reason || 'Cannot approve this request'));
    }

    // Get the request
    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: { edir: true, maker: true },
    });

    if (!request) return failure(new Error('Approval request not found'));
    if (request.status !== 'PENDING') return failure(new Error('Request already processed'));

    // Create approval event with comment
    await createApprovalEvent(requestId, actor.id, 'APPROVED', 'APPROVED', comment);

    // Update request status
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        checkerId: actor.id,
        checkedAt: new Date(),
      },
    });

    // Execute the approval (run the module executor)
    await approveRequest(requestId);

    // Write audit log
    await writeAudit({
      userId: actor.id,
      action: 'APPROVAL_GRANTED',
      targetType: 'ApprovalRequest',
      targetId: requestId,
      details: `Approved ${request.module} for ${request.edir.name}${comment ? ` - Comment: ${comment}` : ''}`,
    });

    // Notify maker
    await notifyApprovalStatusChange(
      requestId,
      request.module,
      'APPROVED',
      `Your ${request.module} submission for "${request.edir.name}" has been approved.`
    );

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
    const actor = await getActor();
    await assertPermission(actor, 'view_approvals');

    if (!reason?.trim()) return failure(new Error('Rejection reason is required'));

    // Check if user can approve (not the maker)
    const canApprove = await canUserApprove(requestId, actor.id);
    if (!canApprove.allowed) {
      return failure(new Error(canApprove.reason || 'Cannot reject this request'));
    }

    // Get the request
    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: { edir: true, maker: true },
    });

    if (!request) return failure(new Error('Approval request not found'));
    if (request.status !== 'PENDING') return failure(new Error('Request already processed'));

    // Create approval event with rejection reason
    await createApprovalEvent(requestId, actor.id, 'REJECTED', 'REJECTED', reason);

    // Update request status
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        checkerId: actor.id,
        checkedAt: new Date(),
      },
    });

    // Execute rejection (may reverse changes if needed)
    await rejectRequest(requestId);

    // Write audit log
    await writeAudit({
      userId: actor.id,
      action: 'APPROVAL_REJECTED',
      targetType: 'ApprovalRequest',
      targetId: requestId,
      details: `Rejected ${request.module} for ${request.edir.name} - Reason: ${reason}`,
    });

    // Notify maker
    await notifyApprovalStatusChange(
      requestId,
      request.module,
      'REJECTED',
      `Your ${request.module} submission for "${request.edir.name}" has been rejected. Reason: ${reason}`
    );

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
    const actor = await getActor();
    await assertPermission(actor, 'view_approvals');

    if (!revisionNotes?.trim()) return failure(new Error('Revision notes are required'));

    // Check if user can approve (not the maker)
    const canApprove = await canUserApprove(requestId, actor.id);
    if (!canApprove.allowed) {
      return failure(new Error(canApprove.reason || 'Cannot return this request'));
    }

    // Get the request
    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: { edir: true, maker: true },
    });

    if (!request) return failure(new Error('Approval request not found'));
    if (request.status !== 'PENDING') return failure(new Error('Request already processed'));

    // Create approval event with return notes
    await createApprovalEvent(requestId, actor.id, 'RETURNED', 'RETURNED', revisionNotes);

    // Update request status to RETURNED (not final)
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: 'RETURNED',
        checkerId: actor.id,
        checkedAt: new Date(),
      },
    });

    // Execute return (may undo partial changes)
    await returnRequest(requestId);

    // Write audit log
    await writeAudit({
      userId: actor.id,
      action: 'APPROVAL_RETURNED',
      targetType: 'ApprovalRequest',
      targetId: requestId,
      details: `Returned ${request.module} for revision - Notes: ${revisionNotes}`,
    });

    // Notify maker
    await notifyApprovalStatusChange(
      requestId,
      request.module,
      'RETURNED',
      `Your ${request.module} submission for "${request.edir.name}" has been returned for revision. Notes: ${revisionNotes}`
    );

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
    const actor = await getActor();
    await assertPermission(actor, 'view_approvals');

    if (!comment?.trim()) return failure(new Error('Comment is required'));

    // Check if user has access to this request
    const request = await prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: { edir: true, status: true },
    });

    if (!request) return failure(new Error('Request not found'));

    // Create a comment event (doesn't change status)
    await createApprovalEvent(requestId, actor.id, 'SUBMITTED', request.status as any, comment);

    await writeAudit({
      userId: actor.id,
      action: 'APPROVAL_COMMENT_ADDED',
      targetType: 'ApprovalRequest',
      targetId: requestId,
      details: `Added comment: ${comment.substring(0, 100)}...`,
    });

    revalidatePath(`/dashboard/approvals?id=${requestId}`);
    return { success: true as const, message: 'Comment added' };
  } catch (error) {
    return failure(error);
  }
}

'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, assertPermission, resolveEdirId, tenantWhere, tenantEdirIds, actorHasPermission } from '@/lib/tenant-scope';
import { submitForApproval } from '@/lib/approval-engine';
import { approveApprovalRequest, rejectApprovalRequest } from '@/app/actions/approval-management';
import '@/lib/approval-modules';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// Maker action → the maker permission that authorizes proposing it.
const ACTION_PERMISSION: Record<string, any> = {
  upload: ['upload_document'],
  edit: ['edit_document', 'upload_document'],
  classify: ['classify_document', 'upload_document'],
  share: ['share_document', 'upload_document'],
  revoke: ['revoke_document_access', 'review_document'],
  archive: ['archive_document', 'upload_document'],
  delete: ['delete_document'],
};

const ACTION_LABEL: Record<string, string> = {
  upload: 'Upload', edit: 'Edit', classify: 'Re-classify', share: 'Share', revoke: 'Revoke access', archive: 'Archive', delete: 'Delete',
};

function fileTypeOf(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

const createSchema = z.object({
  title: z.string().trim().min(2, 'A title is required.'),
  category: z.string().trim().min(1).default('General'),
  tags: z.string().trim().optional().nullable(),
  purpose: z.string().trim().optional().nullable(),
  fileUrl: z.string().trim().min(1, 'A file is required.'),
  fileName: z.string().trim().min(1),
  visibility: z.enum(['staff', 'committee', 'all']).default('staff'),
});

/** Maker uploads a document → created PENDING and submitted for checker approval. */
export async function createDmsDocument(input: z.infer<typeof createSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['upload_document', 'super_admin']);
    const edirId = await resolveEdirId(actor);
    const data = createSchema.parse(input);

    const doc = await prisma.dmsDocument.create({
      data: {
        edirId, title: data.title, category: data.category, tags: data.tags || null, purpose: data.purpose || null,
        fileUrl: data.fileUrl, fileName: data.fileName, fileType: fileTypeOf(data.fileName),
        status: 'PENDING', visibility: data.visibility, pendingAction: 'upload',
        uploadedById: actor.id,
      },
    });

    const requestId = await submitForApproval(actor, {
      edirId, module: 'DOCUMENT_ACTION',
      title: `Document upload: ${data.title}`,
      summary: `${data.category}${data.purpose ? ` · ${data.purpose}` : ''}`,
      payload: { documentId: doc.id, action: 'upload' },
      targetType: 'DmsDocument', targetId: doc.id,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'DOCUMENT_UPLOAD_SUBMITTED', targetType: 'DmsDocument', targetId: doc.id, details: `Uploaded "${data.title}" — pending approval.` });
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, documentId: doc.id, requestId };
  } catch (error) {
    return failure(error);
  }
}

const actionSchema = z.object({
  documentId: z.string().min(1),
  action: z.enum(['edit', 'classify', 'share', 'revoke', 'archive', 'delete']),
  changes: z.record(z.any()).optional(),
});

/** Maker proposes a sensitive action on a document → routed through approval. */
export async function submitDocumentAction(input: z.infer<typeof actionSchema>) {
  try {
    const actor = await getActor();
    const data = actionSchema.parse(input);
    await assertPermission(actor, [...ACTION_PERMISSION[data.action], 'super_admin']);

    const doc = await prisma.dmsDocument.findUnique({ where: { id: data.documentId } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    const ids = tenantEdirIds(actor);
    if (ids && !ids.includes(doc.edirId)) return { success: false as const, error: 'Outside your scope.' };
    if (doc.pendingAction) return { success: false as const, error: 'This document already has a pending action awaiting approval.' };
    if (doc.status !== 'APPROVED' && data.action !== 'delete') return { success: false as const, error: 'Only approved documents can be modified.' };

    await prisma.dmsDocument.update({
      where: { id: doc.id },
      data: { pendingAction: data.action, pendingPayload: (data.changes ?? {}) as Prisma.InputJsonValue },
    });

    const requestId = await submitForApproval(actor, {
      edirId: doc.edirId, module: 'DOCUMENT_ACTION',
      title: `Document ${ACTION_LABEL[data.action].toLowerCase()}: ${doc.title}`,
      summary: data.action === 'classify' ? `→ ${data.changes?.category ?? doc.category}` : data.action === 'share' ? `→ visibility ${data.changes?.visibility}` : undefined,
      payload: { documentId: doc.id, action: data.action, changes: data.changes ?? {} },
      targetType: 'DmsDocument', targetId: doc.id,
    });

    await writeAudit({ edirId: doc.edirId, userId: actor.id, action: 'DOCUMENT_ACTION_SUBMITTED', targetType: 'DmsDocument', targetId: doc.id, details: `${ACTION_LABEL[data.action]} requested for "${doc.title}".` });
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

/** Checker approves the document's open action → runs the executor (status flips). */
export async function approveDmsDocument(documentId: string, comment?: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['approve_document', 'super_admin']);
    const req = await prisma.approvalRequest.findFirst({
      where: { module: 'DOCUMENT_ACTION', targetId: documentId, status: { in: ['PENDING', 'RETURNED'] } },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (!req) return { success: false as const, error: 'No pending action to approve.' };
    const res = await approveApprovalRequest(req.id, comment);
    revalidatePath('/dashboard/documents');
    return res?.success ? { success: true as const } : { success: false as const, error: (res as any)?.error || 'Approval failed.' };
  } catch (error) {
    return failure(error);
  }
}

/** Checker rejects the open action. Also updates the document (the generic reject
 *  flow doesn't run the executor): a rejected upload → REJECTED; a rejected change
 *  → the proposed action is dropped and the document keeps its prior state. */
export async function rejectDmsDocument(documentId: string, reason: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['reject_document', 'approve_document', 'super_admin']);
    if (!reason?.trim()) return { success: false as const, error: 'A rejection reason is required.' };
    const doc = await prisma.dmsDocument.findUnique({ where: { id: documentId } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    const req = await prisma.approvalRequest.findFirst({
      where: { module: 'DOCUMENT_ACTION', targetId: documentId, status: { in: ['PENDING', 'RETURNED'] } },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (!req) return { success: false as const, error: 'No pending action to reject.' };

    const res = await rejectApprovalRequest(req.id, reason);
    if (!res?.success) return { success: false as const, error: (res as any)?.error || 'Reject failed.' };

    await prisma.dmsDocument.update({
      where: { id: doc.id },
      data: doc.pendingAction === 'upload'
        ? { status: 'REJECTED', rejectionReason: reason, reviewedById: actor.id, reviewedAt: new Date(), pendingAction: null, pendingPayload: Prisma.DbNull }
        : { rejectionReason: reason, reviewedById: actor.id, reviewedAt: new Date(), pendingAction: null, pendingPayload: Prisma.DbNull },
    });
    revalidatePath('/dashboard/documents');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Scope-aware, role-aware list of repository documents with rich filters. */
export async function listDmsDocuments(params: { query?: string; category?: string; status?: string; tag?: string; visibility?: string } = {}) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['view_documents', 'upload_document', 'approve_document', 'super_admin']);
    const isStaff = actor.isSuperAdmin || actorHasPermission(actor, ['view_documents', 'upload_document', 'approve_document', 'review_document']);

    const where: Prisma.DmsDocumentWhereInput = { ...(tenantWhere(actor) as any) };
    if (params.category && params.category !== 'all') where.category = params.category;
    if (params.status && params.status !== 'all') where.status = params.status as any;
    if (params.visibility && params.visibility !== 'all') where.visibility = params.visibility;
    if (params.query?.trim()) {
      const q = params.query.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { fileName: { contains: q, mode: 'insensitive' } },
        { tags: { contains: q, mode: 'insensitive' } },
        { purpose: { contains: q, mode: 'insensitive' } },
      ];
    }
    // Non-staff (plain members) only ever see approved, member-shared documents.
    if (!isStaff) { where.status = 'APPROVED'; where.visibility = 'all'; }

    const docs = await prisma.dmsDocument.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 500 });
    const filtered = params.tag ? docs.filter(d => (d.tags ?? '').split(',').map(t => t.trim()).includes(params.tag!)) : docs;

    // Folder/category list with counts — across the whole scope (ignoring the
    // active category filter) so the sidebar always shows every folder.
    const baseWhere: Prisma.DmsDocumentWhereInput = { ...(tenantWhere(actor) as any) };
    if (!isStaff) { baseWhere.status = 'APPROVED'; baseWhere.visibility = 'all'; }
    const grouped = await prisma.dmsDocument.groupBy({ by: ['category'], where: baseWhere, _count: { _all: true } });
    const categoryCounts = grouped.map(g => ({ name: g.category, count: g._count._all })).sort((a, b) => a.name.localeCompare(b.name));

    const userIds = Array.from(new Set(filtered.flatMap(d => [d.uploadedById, d.reviewedById, d.approvedById]).filter(Boolean))) as string[];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
    const nameById = new Map(users.map(u => [u.id, u.name ?? u.email ?? 'Unknown']));

    const categories = Array.from(new Set(docs.map(d => d.category))).sort();
    const allTags = Array.from(new Set(docs.flatMap(d => (d.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)))).sort();

    return {
      success: true as const,
      isStaff,
      categories,
      categoryCounts,
      tags: allTags,
      stats: {
        total: docs.length,
        draft: docs.filter(d => d.status === 'DRAFT').length,
        pending: docs.filter(d => d.status === 'PENDING').length,
        approved: docs.filter(d => d.status === 'APPROVED').length,
        rejected: docs.filter(d => d.status === 'REJECTED').length,
        archived: docs.filter(d => d.status === 'ARCHIVED').length,
      },
      items: filtered.map(d => ({
        id: d.id, title: d.title, category: d.category, tags: (d.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
        purpose: d.purpose, fileUrl: d.fileUrl, fileName: d.fileName, fileType: d.fileType,
        status: d.status, visibility: d.visibility, pendingAction: d.pendingAction,
        uploadedBy: d.uploadedById ? nameById.get(d.uploadedById) ?? 'Unknown' : null,
        reviewedBy: d.reviewedById ? nameById.get(d.reviewedById) ?? 'Unknown' : null,
        approvedBy: d.approvedById ? nameById.get(d.approvedById) ?? 'Unknown' : null,
        rejectionReason: d.rejectionReason,
        createdAt: d.createdAt, approvedAt: d.approvedAt,
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

/** Full detail incl. the approval/workflow timeline for one document. */
export async function getDmsDocumentDetail(documentId: string) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['view_documents', 'upload_document', 'approve_document', 'super_admin']);
    const doc = await prisma.dmsDocument.findUnique({ where: { id: documentId } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    const ids = tenantEdirIds(actor);
    if (ids && !ids.includes(doc.edirId)) return { success: false as const, error: 'Outside your scope.' };

    const requests = await prisma.approvalRequest.findMany({
      where: { module: 'DOCUMENT_ACTION', targetId: doc.id },
      orderBy: { createdAt: 'desc' },
      include: { events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, email: true } } } }, maker: { select: { name: true, email: true } }, checker: { select: { name: true, email: true } } },
    });

    const timeline = requests.flatMap(r => r.events.map(e => ({
      id: e.id, action: e.type, by: e.actor?.name ?? e.actor?.email ?? 'System', at: e.createdAt, comment: e.comment,
      module: ACTION_LABEL[(r.payload as any)?.action] ?? 'Action', status: r.status,
    })));

    const openRequest = requests.find(r => r.status === 'PENDING' || r.status === 'RETURNED');
    const canApprove = !!openRequest && actorHasPermission(actor, ['approve_document', 'super_admin']) && openRequest.makerId !== actor.id;

    const userIds = Array.from(new Set([doc.uploadedById, doc.reviewedById, doc.approvedById].filter(Boolean))) as string[];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
    const nameById = new Map(users.map(u => [u.id, u.name ?? u.email ?? 'Unknown']));

    return {
      success: true as const,
      document: {
        id: doc.id, title: doc.title, category: doc.category, tags: (doc.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
        purpose: doc.purpose, fileUrl: doc.fileUrl, fileName: doc.fileName, fileType: doc.fileType,
        status: doc.status, visibility: doc.visibility, pendingAction: doc.pendingAction,
        uploadedBy: doc.uploadedById ? nameById.get(doc.uploadedById) ?? null : null,
        reviewedBy: doc.reviewedById ? nameById.get(doc.reviewedById) ?? null : null,
        approvedBy: doc.approvedById ? nameById.get(doc.approvedById) ?? null : null,
        rejectionReason: doc.rejectionReason, createdAt: doc.createdAt, approvedAt: doc.approvedAt,
      },
      timeline,
      openRequestId: openRequest?.id ?? null,
      canApprove,
    };
  } catch (error) {
    return failure(error);
  }
}

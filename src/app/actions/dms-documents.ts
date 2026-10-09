'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, assertPermission, resolveEdirId, tenantWhere, tenantEdirIds, actorHasPermission } from '@/lib/tenant-scope';
import { submitForApproval, approveRequest, rejectRequest } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { claimUpload } from '@/lib/uploads';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { zId, zText, zOptionalText, zUploadPath, zOptionalUploadPath, zComment, zRequiredComment, zSearch, zFilter, zDateRange, parseArgs } from '@/lib/validation';

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
  title: zText('Title', { min: 2, max: 200 }),
  category: zText('Category', { min: 1, max: 60 }).default('General'),
  tags: zOptionalText('Tags', { max: 300 }),
  purpose: zOptionalText('Purpose', { max: 1000, multiline: true }),
  fileUrl: zUploadPath,
  fileName: zOptionalText('File name', { max: 255 }), // ignored — the server's upload record names the file
  visibility: z.enum(['staff', 'committee', 'all']).default('staff'),
});

/** Maker uploads a document → created PENDING and submitted for checker approval. */
export async function createDmsDocument(input: z.infer<typeof createSchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['upload_document', 'super_admin']);
    const edirId = await resolveEdirId(actor);
    const data = createSchema.parse(input);
    // The file must be one this user uploaded; its name and type come from the
    // server's upload record — the client-sent fileName is ignored.
    const file = (await claimUpload(actor.id, data.fileUrl, { kinds: ['documents'] }))!;

    const doc = await prisma.dmsDocument.create({
      data: {
        edirId, title: data.title, category: data.category, tags: data.tags || null, purpose: data.purpose || null,
        fileUrl: file.path, fileName: file.name, fileType: file.fileType,
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
  documentId: zId,
  action: z.enum(['edit', 'classify', 'share', 'revoke', 'archive', 'delete']),
  // Allowlisted fields only — the executor writes these straight onto the document.
  changes: z.object({
    title: zText('Title', { min: 2, max: 200 }).optional(),
    purpose: zOptionalText('Purpose', { max: 1000, multiline: true }),
    fileUrl: zOptionalUploadPath,
    fileName: zOptionalText('File name', { max: 255 }),
    fileType: z.enum(['image', 'pdf', 'file']).optional(),
    category: zText('Category', { min: 1, max: 60 }).optional(),
    tags: zOptionalText('Tags', { max: 300 }),
    visibility: z.enum(['staff', 'committee', 'all']).optional(),
  }).optional(),
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

    // A replacement file must be the actor's own upload; its name/type are the
    // server's, never the client's. Without a new file, name/type stay as-is.
    if (data.changes) {
      delete data.changes.fileName;
      delete data.changes.fileType;
      if (data.changes.fileUrl && data.changes.fileUrl !== doc.fileUrl) {
        const file = (await claimUpload(actor.id, data.changes.fileUrl, { kinds: ['documents'] }))!;
        Object.assign(data.changes, { fileUrl: file.path, fileName: file.name, fileType: file.fileType });
      } else {
        delete data.changes.fileUrl;
      }
    }

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
    [documentId, comment] = parseArgs([zId, zComment()], [documentId, comment]) as [string, string | undefined];
    const actor = await getActor();
    await assertPermission(actor, ['approve_document', 'super_admin']);
    const req = await prisma.approvalRequest.findFirst({
      where: { module: 'DOCUMENT_ACTION', targetId: documentId, status: { in: ['PENDING', 'RETURNED'] } },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (!req) return { success: false as const, error: 'No pending action to approve.' };
    // Use the generic engine — it runs the DOCUMENT_ACTION executor (flips the
    // document to APPROVED) in one transaction with the correct schema fields.
    await approveRequest(req.id, comment);
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/approvals');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Checker rejects the document's open action. The engine's DOCUMENT_ACTION
 *  onReject hook reconciles the document (rejected upload → REJECTED; rejected
 *  change → drop the proposed action), so this just routes through the engine. */
export async function rejectDmsDocument(documentId: string, reason: string) {
  try {
    [documentId, reason] = parseArgs([zId, zRequiredComment('Rejection reason')], [documentId, reason]) as [string, string];
    const actor = await getActor();
    await assertPermission(actor, ['reject_document', 'approve_document', 'super_admin']);
    if (!reason?.trim()) return { success: false as const, error: 'A rejection reason is required.' };
    const req = await prisma.approvalRequest.findFirst({
      where: { module: 'DOCUMENT_ACTION', targetId: documentId, status: { in: ['PENDING', 'RETURNED'] } },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (!req) return { success: false as const, error: 'No pending action to reject.' };

    await rejectRequest(req.id, reason);
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/approvals');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Scope-aware, role-aware list of repository documents with rich filters. */
export async function listDmsDocuments(params: { query?: string; category?: string; status?: string; tag?: string; visibility?: string; range?: DateRangeParam } = {}) {
  try {
    params = z.object({ query: zSearch, category: zOptionalText('Category', { max: 60 }), status: zFilter(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED']), tag: zOptionalText('Tag', { max: 60 }), visibility: zFilter(['staff', 'committee', 'all']), range: zDateRange }).parse(params) as typeof params;
    const actor = await getActor();
    // Keep this in sync with the /dashboard/documents route gate in middleware.ts.
    await assertPermission(actor, ['view_documents', 'upload_document', 'approve_document', 'review_document', 'super_admin']);
    const isStaff = actor.isSuperAdmin || actorHasPermission(actor, ['view_documents', 'upload_document', 'approve_document', 'review_document']);
    const canUpload = actor.isSuperAdmin || actorHasPermission(actor, 'upload_document');

    const where: Prisma.DmsDocumentWhereInput = { ...(tenantWhere(actor) as any), ...dateWhere('createdAt', params.range) };
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
    // active category filter, but honoring the date range) so the sidebar
    // counts stay consistent with the filtered list.
    const baseWhere: Prisma.DmsDocumentWhereInput = { ...(tenantWhere(actor) as any), ...dateWhere('createdAt', params.range) };
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
      canUpload,
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
    documentId = zId.parse(documentId);
    const actor = await getActor();
    await assertPermission(actor, ['view_documents', 'upload_document', 'approve_document', 'review_document', 'super_admin']);
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

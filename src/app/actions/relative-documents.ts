'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getActor, actorHasPermission, assertPermission, assertSameTenant } from '@/lib/tenant-scope';
import { submitForApproval, approveRequest, rejectRequest } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { claimUpload } from '@/lib/uploads';
import { zId, zOptionalId, zUploadPath, zOptionalText } from '@/lib/validation';

// Module-local only — a "use server" file may export *only* async functions, so
// this constant must not be exported (Next throws "can only export async functions").
const RELATIVE_DOC_CATEGORIES = ['National ID', 'Birth Certificate', 'Passport', 'Medical Certificate', 'Marriage Certificate', 'Proof of Relationship', 'Photo', 'Other'] as const;

// Managing a dependent's documents is part of managing the dependent, so anyone who
// can manage relatives (manage_relatives) may upload/edit/delete here too — it still
// routes through Maker–Checker. manage_documents / manage_members also qualify.
const MAKER_PERMS = ['manage_relatives', 'manage_documents', 'manage_members'] as const;

function fileTypeOf(name: string | null | undefined): 'image' | 'pdf' | 'file' {
  const s = (name || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(s)) return 'image';
  if (s.endsWith('.pdf')) return 'pdf';
  return 'file';
}

const uploadSchema = z.object({
  fileUrl: zUploadPath,
  fileName: zOptionalText('File name', { max: 255 }),
  documentName: zOptionalText('Document name', { max: 160 }),
  category: z.enum([...RELATIVE_DOC_CATEGORIES, 'General']) /* 'General' = legacy default */.default('Other'),
  remarks: zOptionalText('Remarks', { max: 1000, multiline: true }),
  supersedesId: zOptionalId, // set when uploading a new version
});

async function loadRelative(relativeId: string) {
  return prisma.relative.findUnique({ where: { id: relativeId }, include: { member: { select: { edirId: true, name: true, userId: true } } } });
}

/** Maker action: upload a relative/dependent document (or a new version). Lands PENDING until a Checker approves. */
export async function submitRelativeDocument(relativeId: string, input: z.infer<typeof uploadSchema>) {
  try {
    relativeId = zId.parse(relativeId);
    const actor = await getActor();
    const rel = await loadRelative(relativeId);
    if (!rel) return { success: false as const, error: 'Relative not found.' };
    // A member may upload a proof document for their OWN dependent (self-service);
    // staff need a maker permission. Either path lands PENDING for Checker approval.
    const isOwner = !!rel.member.userId && rel.member.userId === actor.id;
    if (!isOwner) await assertPermission(actor, [...MAKER_PERMS]);
    await assertSameTenant(actor, rel.member.edirId);
    const data = uploadSchema.parse(input);
    // Must be the actor's own upload; the stored name/type come from the server.
    const file = (await claimUpload(actor.id, data.fileUrl, { kinds: ['documents'] }))!;

    let version = 1;
    if (data.supersedesId) {
      const prev = await prisma.relativeDocument.findUnique({ where: { id: data.supersedesId }, select: { relativeId: true, version: true } });
      if (!prev || prev.relativeId !== relativeId) return { success: false as const, error: 'The version being replaced is invalid.' };
      version = prev.version + 1;
    }

    const doc = await prisma.relativeDocument.create({
      data: {
        relativeId,
        category: data.category || 'General',
        documentName: data.documentName || null,
        fileUrl: file.path,
        fileName: file.name,
        fileType: file.fileType,
        remarks: data.remarks || null,
        status: 'PENDING',
        pendingAction: 'upload',
        version,
        supersedesId: data.supersedesId || null,
        uploadedById: actor.id,
      },
    });

    await submitForApproval(actor, {
      edirId: rel.member.edirId,
      module: 'RELATIVE_DOCUMENT_ACTION',
      title: `Relative document: ${data.documentName || data.fileName || 'Upload'}`,
      summary: `${data.supersedesId ? 'New version' : 'Upload'} for ${rel.name} (${rel.member.name ?? ''})`,
      payload: { documentId: doc.id, action: 'upload' },
      targetType: 'RelativeDocument',
      targetId: doc.id,
    });

    await writeAudit({ edirId: rel.member.edirId, userId: actor.id, action: 'RELATIVE_DOCUMENT_SUBMITTED', targetType: 'RelativeDocument', targetId: doc.id, details: `${data.documentName || data.fileName || 'Document'} for ${rel.name}.` });
    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, documentId: doc.id };
  } catch (error) {
    return failure(error);
  }
}

const editSchema = z.object({
  documentName: zOptionalText('Document name', { max: 160 }),
  category: z.enum([...RELATIVE_DOC_CATEGORIES, 'General']) /* 'General' = legacy default */.optional().nullable(),
  remarks: zOptionalText('Remarks', { max: 1000, multiline: true }),
});

/** Maker action: edit a document's metadata (category/name/remarks) — routed through approval. */
export async function submitRelativeDocumentUpdate(documentId: string, input: z.infer<typeof editSchema>) {
  try {
    documentId = zId.parse(documentId);
    const actor = await getActor();
    await assertPermission(actor, [...MAKER_PERMS]);
    const doc = await prisma.relativeDocument.findUnique({ where: { id: documentId }, include: { relative: { include: { member: { select: { edirId: true, name: true } } } } } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    await assertSameTenant(actor, doc.relative.member.edirId);
    if (doc.pendingAction) return { success: false as const, error: 'This document already has a pending change awaiting approval.' };
    const changes = editSchema.parse(input);

    await prisma.relativeDocument.update({ where: { id: documentId }, data: { pendingAction: 'edit', pendingPayload: changes } });
    await submitForApproval(actor, {
      edirId: doc.relative.member.edirId,
      module: 'RELATIVE_DOCUMENT_ACTION',
      title: `Edit relative document: ${doc.documentName || doc.fileName || 'document'}`,
      summary: `Metadata update for ${doc.relative.name}`,
      payload: { documentId, action: 'edit', changes },
      targetType: 'RelativeDocument',
      targetId: documentId,
    });
    await writeAudit({ edirId: doc.relative.member.edirId, userId: actor.id, action: 'RELATIVE_DOCUMENT_EDIT_SUBMITTED', targetType: 'RelativeDocument', targetId: documentId });
    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard/approvals');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Maker action: request deletion of a document — routed through approval. */
export async function submitRelativeDocumentDelete(documentId: string) {
  try {
    documentId = zId.parse(documentId);
    const actor = await getActor();
    await assertPermission(actor, [...MAKER_PERMS]);
    const doc = await prisma.relativeDocument.findUnique({ where: { id: documentId }, include: { relative: { include: { member: { select: { edirId: true, name: true } } } } } });
    if (!doc) return { success: false as const, error: 'Document not found.' };
    await assertSameTenant(actor, doc.relative.member.edirId);
    if (doc.pendingAction) return { success: false as const, error: 'This document already has a pending change awaiting approval.' };

    await prisma.relativeDocument.update({ where: { id: documentId }, data: { pendingAction: 'delete' } });
    await submitForApproval(actor, {
      edirId: doc.relative.member.edirId,
      module: 'RELATIVE_DOCUMENT_ACTION',
      title: `Delete relative document: ${doc.documentName || doc.fileName || 'document'}`,
      summary: `Deletion request for ${doc.relative.name}`,
      payload: { documentId, action: 'delete' },
      targetType: 'RelativeDocument',
      targetId: documentId,
    });
    await writeAudit({ edirId: doc.relative.member.edirId, userId: actor.id, action: 'RELATIVE_DOCUMENT_DELETE_SUBMITTED', targetType: 'RelativeDocument', targetId: documentId });
    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard/approvals');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Checker action: approve the document's pending request (delegates to the engine). */
export async function approveRelativeDocument(documentId: string, comment?: string) {
  try {
    // Authenticate before touching data; approveRequest/rejectRequest then enforce
    // checker permission, tenant scope and maker≠checker.
    await getActor();
    const req = await prisma.approvalRequest.findFirst({ where: { module: 'RELATIVE_DOCUMENT_ACTION', targetId: documentId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (!req) return { success: false as const, error: 'No pending approval for this document.' };
    await approveRequest(req.id, comment);
    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard/approvals');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Checker action: reject the document's pending request (delegates to the engine). */
export async function rejectRelativeDocument(documentId: string, comment?: string) {
  try {
    // Authenticate before touching data; approveRequest/rejectRequest then enforce
    // checker permission, tenant scope and maker≠checker.
    await getActor();
    const req = await prisma.approvalRequest.findFirst({ where: { module: 'RELATIVE_DOCUMENT_ACTION', targetId: documentId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (!req) return { success: false as const, error: 'No pending approval for this document.' };
    await rejectRequest(req.id, comment);
    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard/approvals');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

function serializeDoc(d: any, names: Map<string, string | null>) {
  return {
    id: d.id,
    category: d.category,
    documentName: d.documentName,
    fileName: d.fileName,
    fileUrl: d.fileUrl,
    fileType: d.fileType,
    status: d.status as string,
    remarks: d.remarks,
    rejectionReason: d.rejectionReason,
    pendingAction: d.pendingAction,
    version: d.version,
    supersedesId: d.supersedesId,
    archivedAt: d.archivedAt,
    createdAt: d.createdAt,
    approvedAt: d.approvedAt,
    uploaderName: d.uploadedById ? names.get(d.uploadedById) ?? null : null,
    reviewerName: d.reviewedById ? names.get(d.reviewedById) ?? null : null,
  };
}

/** Document lines (latest version + history) for a relative, plus the actor's capabilities. */
export async function getRelativeDocuments(relativeId: string) {
  relativeId = zId.parse(relativeId);
  const actor = await getActor();
  await assertPermission(actor, ['view_members', 'manage_members', 'manage_relatives', 'manage_documents', 'review_member_documents']);
  const rel = await loadRelative(relativeId);
  if (!rel) return null;
  await assertSameTenant(actor, rel.member.edirId);

  const docs = await prisma.relativeDocument.findMany({
    where: { relativeId },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
  });

  // Resolve uploader/reviewer display names (uploadedById/reviewedById are plain
  // User ids — no relation — so look them up in one query).
  const userIds = [...new Set(docs.flatMap(d => [d.uploadedById, d.reviewedById]).filter(Boolean) as string[])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map<string, string | null>(users.map(u => [u.id, u.name ?? u.email ?? null]));

  // Group into version chains: a "head" is a document no newer version supersedes.
  const supersededIds = new Set(docs.filter(d => d.supersedesId).map(d => d.supersedesId));
  const byId = new Map(docs.map(d => [d.id, d]));
  const heads = docs.filter(d => !supersededIds.has(d.id));

  const lines = heads.map(head => {
    const chain: any[] = [];
    let cur: any = head;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) { guard.add(cur.id); chain.push(cur); cur = cur.supersedesId ? byId.get(cur.supersedesId) : null; }
    return { current: serializeDoc(head, names), versions: chain.map(d => serializeDoc(d, names)) };
  }).sort((a, b) => +new Date(b.current.createdAt) - +new Date(a.current.createdAt));

  return {
    lines,
    caps: {
      canUpload: actorHasPermission(actor, [...MAKER_PERMS]),
      canEdit: actorHasPermission(actor, [...MAKER_PERMS]),
      canDelete: actorHasPermission(actor, [...MAKER_PERMS]),
      canReview: actorHasPermission(actor, ['review_member_documents']),
    },
    categories: RELATIVE_DOC_CATEGORIES,
  };
}

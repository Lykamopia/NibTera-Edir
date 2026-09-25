'use server';

import prisma from '@/lib/prisma';
import { getActor, actorHasPermission, assertPermission, tenantWhere } from '@/lib/tenant-scope';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { approveDmsDocument, rejectDmsDocument } from './dms-documents';
import { approveRelativeDocument, rejectRelativeDocument } from './relative-documents';
import { reviewMemberDocument } from './members';
import { resolveOwnMembership } from '@/lib/membership-policy';
import { z } from 'zod';
import { zId, zComment, zOptionalText, zSearch, zFilter, zDateRange } from '@/lib/validation';

export type DocSource = 'DMS' | 'MEMBER' | 'RELATIVE' | 'REQUEST';

export type RepoDocItem = {
  key: string; // unique React key across all sources
  source: DocSource;
  sourceLabel: string;
  id: string; // raw source-record id used to dispatch review actions
  title: string;
  category: string;
  tags: string[];
  fileUrl: string;
  fileName: string;
  fileType: 'image' | 'pdf' | 'file';
  status: string; // DRAFT | PENDING | APPROVED | REJECTED | ARCHIVED
  pendingAction: string | null;
  visibility: string | null;
  uploadedBy: string | null;
  owner: { name: string; code: string; memberId: string } | null;
  relatedLabel: string;
  relatedHref: string;
  purpose: string | null;
  notes: string | null;
  rejectionReason: string | null;
  needsReview: boolean; // has an open decision awaiting a checker
  canReview: boolean; // this actor may approve/reject it here
  createdAt: Date;
  approvedAt: Date | null;
};

// Route-gate permissions (kept in sync with middleware.ts + listDmsDocuments).
const VIEW_PERMS = ['view_documents', 'upload_document', 'approve_document', 'review_document', 'super_admin'] as const;
// Anyone holding one of these is treated as staff (sees the whole tenant scope).
const STAFF_PERMS = [
  'view_documents', 'upload_document', 'approve_document', 'review_document',
  'manage_members', 'view_members', 'review_member_documents', 'handle_member_requests',
  'manage_documents', 'manage_relatives',
] as const;

function fileTypeOf(name: string | null | undefined): 'image' | 'pdf' | 'file' {
  const ext = ((name || '').split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

/** Normalize a MemberRequest attachment entry ({name,url} | url string) → {name,url}. */
function attachmentOf(att: any): { name: string; url: string } | null {
  if (!att) return null;
  if (typeof att === 'string') return { url: att, name: att.split('/').pop() || 'Attachment' };
  if (typeof att === 'object' && att.url) return { url: att.url, name: att.name || att.url.split('/').pop() || 'Attachment' };
  return null;
}

/**
 * Central document repository. Aggregates every uploaded document across modules —
 * repository (DmsDocument), member documents (MemberDocument), dependent/relative
 * documents (RelativeDocument) and member-request attachments — into one normalized,
 * scope- and permission-aware list. Each item carries its source and whether the
 * current actor may approve/reject it, so the documents page can review any pending
 * document in place. Approvals dispatch back to each module's own workflow
 * (see reviewRepositoryDocument), so a decision here is reflected globally.
 */
export async function listRepositoryDocuments(params: {
  query?: string; source?: string; category?: string; status?: string; tag?: string; visibility?: string; range?: DateRangeParam;
} = {}) {
  try {
    params = z.object({
      query: zSearch, source: zFilter(['DMS', 'MEMBER', 'RELATIVE', 'REQUEST']), category: zOptionalText('Category', { max: 60 }),
      status: z.preprocess(v => (v === '' ? null : v), z.string().max(32).regex(/^[A-Za-z_]+$/, 'Invalid status.').nullable().optional()),
      tag: zOptionalText('Tag', { max: 60 }), visibility: zFilter(['staff', 'committee', 'all']), range: zDateRange,
    }).parse(params) as typeof params;
    const actor = await getActor();
    await assertPermission(actor, [...VIEW_PERMS]);
    const isStaff = actor.isSuperAdmin || actorHasPermission(actor, [...STAFF_PERMS]);
    const canUpload = actor.isSuperAdmin || actorHasPermission(actor, 'upload_document');
    const canReviewMemberDocs = actorHasPermission(actor, ['review_member_documents']);
    const canApproveDms = actorHasPermission(actor, ['approve_document', 'super_admin']);

    // Scope: staff → their tenant Edir(s); a plain member → only their own record.
    let ownMemberId: string | null = null;
    if (!isStaff) {
      // Multi-Edir members resolve to their home Edir's membership.
      const m = await resolveOwnMembership(actor.id, { homeEdirId: actor.edirId });
      if (!m) return { success: true as const, isStaff: false, canUpload: false, items: [], categories: [], categoryCounts: [], tags: [], stats: { total: 0, pending: 0, approved: 0, rejected: 0, archived: 0 } };
      ownMemberId = m.id;
    }

    // Single canonical Edir scope, applied to DMS (direct) and member-linked docs (nested).
    const scope = tenantWhere(actor) as { edirId?: string | { in: string[] } };
    const dmsWhere: any = { ...scope, ...dateWhere('createdAt', params.range) };
    const memberWhere: any = isStaff
      ? (scope.edirId ? { edirId: scope.edirId } : {})
      : { id: ownMemberId ?? '__none__' };
    // A plain member only ever sees approved, member-shared repository documents.
    if (!isStaff) { dmsWhere.status = 'APPROVED'; dmsWhere.visibility = 'all'; }

    const dateFilter = dateWhere('createdAt', params.range);
    const [dmsDocs, memberDocs, relativeDocsRaw, requests] = await Promise.all([
      prisma.dmsDocument.findMany({ where: dmsWhere, orderBy: { updatedAt: 'desc' }, take: 500 }),
      prisma.memberDocument.findMany({
        where: { member: memberWhere, ...dateFilter },
        include: { member: { select: { id: true, name: true, memberId: true } } },
        orderBy: { createdAt: 'desc' }, take: 500,
      }),
      prisma.relativeDocument.findMany({
        where: { relative: { member: memberWhere }, ...dateFilter },
        include: { relative: { include: { member: { select: { id: true, name: true, memberId: true } } } } },
        orderBy: { createdAt: 'desc' }, take: 500,
      }),
      prisma.memberRequest.findMany({
        where: { member: memberWhere, ...dateFilter },
        include: { member: { select: { id: true, name: true, memberId: true } } },
        orderBy: { createdAt: 'desc' }, take: 500,
      }),
    ]);

    // Relative docs: collapse version chains to their head (latest, un-superseded).
    const supersededIds = new Set(relativeDocsRaw.filter(d => d.supersedesId).map(d => d.supersedesId));
    const relativeDocs = relativeDocsRaw.filter(d => !supersededIds.has(d.id));

    // Resolve uploader display names (DMS + relative store plain User ids).
    const userIds = Array.from(new Set([
      ...dmsDocs.flatMap(d => [d.uploadedById, d.reviewedById, d.approvedById]),
      ...relativeDocs.map(d => d.uploadedById),
    ].filter(Boolean))) as string[];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
    const nameById = new Map(users.map(u => [u.id, u.name ?? u.email ?? 'Unknown']));

    const items: RepoDocItem[] = [];

    for (const d of dmsDocs) {
      const needsReview = d.status === 'PENDING' || !!d.pendingAction;
      items.push({
        key: `DMS:${d.id}`, source: 'DMS', sourceLabel: 'Repository', id: d.id,
        title: d.title, category: d.category, tags: (d.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
        fileUrl: d.fileUrl, fileName: d.fileName, fileType: d.fileType as any,
        status: d.status, pendingAction: d.pendingAction, visibility: d.visibility,
        uploadedBy: d.uploadedById ? nameById.get(d.uploadedById) ?? null : null,
        owner: null, relatedLabel: d.category, relatedHref: '/dashboard/documents',
        purpose: d.purpose, notes: d.purpose, rejectionReason: d.rejectionReason,
        needsReview, canReview: needsReview && canApproveDms,
        createdAt: d.createdAt, approvedAt: d.approvedAt,
      });
    }

    for (const d of memberDocs) {
      const m = d.member;
      const needsReview = d.status === 'PENDING';
      items.push({
        key: `MEMBER:${d.id}`, source: 'MEMBER', sourceLabel: 'Member document', id: d.id,
        title: d.fileName || d.category.replace(/_/g, ' '), category: d.category, tags: [],
        fileUrl: d.fileUrl, fileName: d.fileName || 'Document', fileType: fileTypeOf(d.fileName || d.fileUrl),
        status: d.status, pendingAction: null, visibility: null,
        uploadedBy: null,
        owner: m ? { name: m.name, code: m.memberId, memberId: m.id } : null,
        relatedLabel: m?.name ?? '—', relatedHref: m ? `/dashboard/members/${m.id}` : '/dashboard/members',
        purpose: null, notes: d.notes, rejectionReason: d.status === 'REJECTED' ? d.notes : null,
        needsReview, canReview: needsReview && canReviewMemberDocs,
        createdAt: d.createdAt, approvedAt: null,
      });
    }

    for (const d of relativeDocs) {
      const m = d.relative.member;
      const needsReview = d.status === 'PENDING' || !!d.pendingAction;
      items.push({
        key: `RELATIVE:${d.id}`, source: 'RELATIVE', sourceLabel: 'Dependent document', id: d.id,
        title: d.documentName || d.fileName || 'Document', category: d.category, tags: [],
        fileUrl: d.fileUrl, fileName: d.fileName || 'Document', fileType: (d.fileType as any) || fileTypeOf(d.fileName || d.fileUrl),
        status: d.status, pendingAction: d.pendingAction, visibility: null,
        uploadedBy: d.uploadedById ? nameById.get(d.uploadedById) ?? null : null,
        owner: m ? { name: m.name, code: m.memberId, memberId: m.id } : null,
        relatedLabel: `${d.relative.name} · ${d.relative.relationship}`,
        relatedHref: m ? `/dashboard/members/${m.id}` : '/dashboard/members',
        purpose: null, notes: d.remarks, rejectionReason: d.rejectionReason,
        needsReview, canReview: needsReview && canReviewMemberDocs,
        createdAt: d.createdAt, approvedAt: d.approvedAt,
      });
    }

    for (const r of requests) {
      const atts = Array.isArray(r.attachments) ? r.attachments : [];
      atts.forEach((raw, i) => {
        const att = attachmentOf(raw);
        if (!att) return;
        items.push({
          key: `REQUEST:${r.id}:${i}`, source: 'REQUEST', sourceLabel: `${r.type} request`, id: r.id,
          title: att.name, category: r.type, tags: [],
          fileUrl: att.url, fileName: att.name, fileType: fileTypeOf(att.name),
          status: r.status, pendingAction: null, visibility: null,
          uploadedBy: r.member?.name ?? null,
          owner: r.member ? { name: r.member.name, code: r.member.memberId, memberId: r.member.id } : null,
          relatedLabel: r.subject, relatedHref: '/dashboard/requests',
          purpose: null, notes: r.subject, rejectionReason: null,
          // Request attachments are governed by the request's own workflow, not here.
          needsReview: false, canReview: false,
          createdAt: r.createdAt, approvedAt: r.reviewedAt,
        });
      });
    }

    // ── Filters ────────────────────────────────────────────────────────────────
    const q = params.query?.trim().toLowerCase();
    const filtered = items.filter(d =>
      (!params.source || params.source === 'all' || d.source === params.source) &&
      (!params.category || params.category === 'all' || d.category === params.category) &&
      (!params.status || params.status === 'all' || d.status === params.status) &&
      (!params.visibility || params.visibility === 'all' || d.visibility === params.visibility) &&
      (!params.tag || params.tag === 'all' || d.tags.includes(params.tag)) &&
      (!q
        || d.title.toLowerCase().includes(q)
        || d.fileName.toLowerCase().includes(q)
        || d.category.toLowerCase().includes(q)
        || (d.owner?.name.toLowerCase().includes(q) ?? false)
        || (d.owner?.code.toLowerCase().includes(q) ?? false)
        || d.relatedLabel.toLowerCase().includes(q)
        || d.tags.some(t => t.toLowerCase().includes(q))),
    ).sort((a, b) => +new Date(b.approvedAt ?? b.createdAt) - +new Date(a.approvedAt ?? a.createdAt));

    // Folder counts across the full scope (respecting only the date range / source),
    // so the sidebar stays consistent with the list.
    const scopedForCounts = items.filter(d => !params.source || params.source === 'all' || d.source === params.source);
    const countByCategory = new Map<string, number>();
    for (const d of scopedForCounts) countByCategory.set(d.category, (countByCategory.get(d.category) ?? 0) + 1);
    const categoryCounts = Array.from(countByCategory, ([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));

    // DMS folders feed the upload dialog's folder picker.
    const categories = Array.from(new Set(dmsDocs.map(d => d.category))).sort();
    const tags = Array.from(new Set(dmsDocs.flatMap(d => (d.tags ?? '').split(',').map(t => t.trim()).filter(Boolean)))).sort();

    return {
      success: true as const,
      isStaff,
      canUpload,
      categories,
      categoryCounts,
      tags,
      stats: {
        total: items.length,
        pending: items.filter(d => d.needsReview).length,
        approved: items.filter(d => d.status === 'APPROVED').length,
        rejected: items.filter(d => d.status === 'REJECTED').length,
        archived: items.filter(d => d.status === 'ARCHIVED').length,
      },
      items: filtered.slice(0, 400),
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Single approve/reject entry-point for the documents page. Routes each decision to
 * the owning module's existing maker–checker workflow, so the outcome is reflected
 * everywhere the source record appears (member profile, dependents, approvals).
 */
export async function reviewRepositoryDocument(input: { source: DocSource; id: string; decision: 'APPROVED' | 'REJECTED'; reason?: string }) {
  try {
    input = z.object({ source: z.enum(['DMS', 'MEMBER', 'RELATIVE', 'REQUEST']), id: zId, decision: z.enum(['APPROVED', 'REJECTED']), reason: zComment('Reason') }).parse(input) as typeof input;
    const { source, id, decision, reason } = input;
    const approving = decision === 'APPROVED';
    let result: { success: boolean; error?: string };

    switch (source) {
      case 'DMS':
        if (!approving && !reason?.trim()) return { success: false as const, error: 'A rejection reason is required.' };
        result = approving ? await approveDmsDocument(id, reason) : await rejectDmsDocument(id, reason!.trim());
        break;
      case 'RELATIVE':
        result = approving ? await approveRelativeDocument(id, reason) : await rejectRelativeDocument(id, reason);
        break;
      case 'MEMBER':
        result = await reviewMemberDocument(id, decision, reason);
        break;
      default:
        return { success: false as const, error: 'This document type is reviewed from its own page.' };
    }

    if (result.success) revalidatePath('/dashboard/documents');
    return result;
  } catch (error) {
    return failure(error);
  }
}

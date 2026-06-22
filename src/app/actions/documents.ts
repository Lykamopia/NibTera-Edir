'use server';

import prisma from '@/lib/prisma';
import { getActor } from '@/lib/tenant-scope';

export type DocItem = {
  id: string;
  source: 'MEMBER' | 'RELATIVE' | 'REQUEST';
  sourceLabel: string;
  category: string;
  fileName: string;
  fileUrl: string;
  fileType: 'image' | 'pdf' | 'file';
  status: string;
  ownerName: string;
  ownerCode: string;
  ownerMemberId: string;
  relatedType: string;
  relatedLabel: string;
  relatedHref: string;
  uploadedAt: Date;
};

function fileTypeOf(name: string): DocItem['fileType'] {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

const STAFF_PERMS = ['view_documents', 'manage_members', 'view_members', 'review_member_documents', 'handle_member_requests'];

/**
 * Centralized, permission- and scope-aware document repository. Aggregates every
 * uploaded document across modules (member documents, relative/beneficiary
 * documents, and member-request attachments) into one normalized list, each
 * linked to its owning member and related record. Staff see their whole tenant;
 * a plain member sees only their own documents.
 */
export async function getDocuments(params: { query?: string; source?: string; status?: string; type?: string } = {}) {
  const actor = await getActor();
  const isStaff = actor.isSuperAdmin || STAFF_PERMS.some(p => actor.permissions.includes(p));

  // Scope: staff → tenant; member → only their own record.
  let ownMemberId: string | null = null;
  if (!isStaff) {
    const m = await prisma.member.findFirst({ where: { userId: actor.id }, select: { id: true } });
    if (!m) return { items: [], isStaff: false };
    ownMemberId = m.id;
  }

  const memberWhere = isStaff
    ? (actor.isSuperAdmin ? {} : { edirId: actor.edirId ?? '__none__' })
    : { id: ownMemberId ?? '__none__' };

  const [memberDocs, relativeDocs, requests] = await Promise.all([
    prisma.memberDocument.findMany({
      where: { member: memberWhere },
      include: { member: { select: { id: true, name: true, memberId: true } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    }),
    prisma.relativeDocument.findMany({
      where: { relative: { member: memberWhere } },
      include: { relative: { include: { member: { select: { id: true, name: true, memberId: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    }),
    prisma.memberRequest.findMany({
      where: { member: memberWhere },
      include: { member: { select: { id: true, name: true, memberId: true } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    }),
  ]);

  const items: DocItem[] = [];

  for (const d of memberDocs) {
    items.push({
      id: `M-${d.id}`, source: 'MEMBER', sourceLabel: 'Member document', category: d.category,
      fileName: d.fileName || 'Document', fileUrl: d.fileUrl, fileType: fileTypeOf(d.fileName || d.fileUrl),
      status: d.status, ownerName: d.member?.name ?? '—', ownerCode: d.member?.memberId ?? '—', ownerMemberId: d.member?.id ?? '',
      relatedType: 'Member', relatedLabel: d.member?.name ?? '—', relatedHref: `/dashboard/members/${d.member?.id}`,
      uploadedAt: d.createdAt,
    });
  }
  for (const d of relativeDocs) {
    const m = d.relative.member;
    items.push({
      id: `R-${d.id}`, source: 'RELATIVE', sourceLabel: 'Relative document', category: 'PROOF_OF_RELATIONSHIP',
      fileName: d.fileName || 'Document', fileUrl: d.fileUrl, fileType: fileTypeOf(d.fileName || d.fileUrl),
      status: d.status, ownerName: m?.name ?? '—', ownerCode: m?.memberId ?? '—', ownerMemberId: m?.id ?? '',
      relatedType: 'Relative', relatedLabel: `${d.relative.name} (${d.relative.relationship})`, relatedHref: `/dashboard/members/${m?.id}`,
      uploadedAt: d.createdAt,
    });
  }
  for (const r of requests) {
    const atts = Array.isArray(r.attachments) ? (r.attachments as string[]) : [];
    atts.forEach((url, i) => {
      const name = url.split('/').pop() || 'Attachment';
      items.push({
        id: `Q-${r.id}-${i}`, source: 'REQUEST', sourceLabel: `${r.type} request`, category: r.type,
        fileName: name, fileUrl: url, fileType: fileTypeOf(name),
        status: r.status, ownerName: r.member?.name ?? '—', ownerCode: r.member?.memberId ?? '—', ownerMemberId: r.member?.id ?? '',
        relatedType: `${r.type} request`, relatedLabel: r.subject, relatedHref: '/dashboard/requests',
        uploadedAt: r.createdAt,
      });
    });
  }

  // Filters
  const q = params.query?.trim().toLowerCase();
  const filtered = items.filter(d =>
    (!params.source || params.source === 'all' || d.source === params.source) &&
    (!params.status || params.status === 'all' || d.status === params.status) &&
    (!params.type || params.type === 'all' || d.fileType === params.type) &&
    (!q || d.fileName.toLowerCase().includes(q) || d.ownerName.toLowerCase().includes(q) || d.ownerCode.toLowerCase().includes(q) || d.relatedLabel.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)),
  ).sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));

  return {
    items: filtered.slice(0, 400),
    isStaff,
    stats: {
      total: items.length,
      pending: items.filter(d => d.status === 'PENDING').length,
      approved: items.filter(d => d.status === 'APPROVED').length,
      rejected: items.filter(d => d.status === 'REJECTED').length,
    },
  };
}

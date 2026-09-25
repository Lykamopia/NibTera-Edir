'use server';

import prisma from '@/lib/prisma';
import { Prisma, type ApprovalModule } from '@prisma/client';
import { getActor, actorHasPermission, tenantWhere } from '@/lib/tenant-scope';
import { MODULE_CHECKER_PERMISSION, MODULE_LABEL } from '@/lib/permissions';
import {
  approveRequest, rejectRequest, returnRequest, commentOnRequest, resubmitRequest,
  pendingApprovalCountForActor, eligibleModulesFor, pendingScopeWhere, canCheckRequest,
} from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { toCsv } from '@/lib/csv';
import { z } from 'zod';
import { zId, zSearch, zDateRange, parseArgs } from '@/lib/validation';

export type ApprovalTab = 'pending' | 'mine' | 'history';

// Module-local (a 'use server' file may only export async functions).
const tabSchema = z.enum(['pending', 'mine', 'history']);
const filtersSchema = z.object({
  module: z.preprocess(v => (v === '' ? null : v), z.string().max(64).regex(/^[A-Za-z_]+$/, 'Invalid filter.').nullable().optional()),
  status: z.preprocess(v => (v === '' ? null : v), z.string().max(64).regex(/^[A-Za-z_]+$/, 'Invalid filter.').nullable().optional()),
  query: zSearch,
  range: zDateRange,
});

export interface ApprovalFilters {
  module?: string;
  status?: string;
  query?: string;
  range?: DateRangeParam;
}

/** Build the tab + filter `where` clause shared by the list and export.
 *  Returns null when the actor can act on nothing (so the caller returns empty). */
function buildApprovalWhere(
  actor: Awaited<ReturnType<typeof getActor>>,
  tab: ApprovalTab,
  filters: ApprovalFilters,
): Prisma.ApprovalRequestWhereInput | null {
  const date = dateWhere('createdAt', filters.range);
  const query: Prisma.ApprovalRequestWhereInput | null = filters.query?.trim()
    ? { OR: [
        { title: { contains: filters.query.trim(), mode: 'insensitive' } },
        { summary: { contains: filters.query.trim(), mode: 'insensitive' } },
      ] }
    : null;

  if (tab === 'pending') {
    // Role/scope-aware visibility: narrow the actor's checkable modules to the UI
    // filter first, then let pendingScopeWhere apply governance/operational scoping.
    let eligible = eligibleModulesFor(actor);
    if (filters.module && filters.module !== 'all') {
      eligible = eligible.filter(m => m === (filters.module as ApprovalModule));
    }
    const scope = pendingScopeWhere(actor, eligible);
    if (scope === null) return null;
    // Combine via AND so a scope OR-clause and the search OR-clause don't clobber.
    return {
      AND: query ? [scope, query] : [scope],
      ...date,
      status: 'PENDING',
      makerId: { not: actor.id },
    };
  }

  // mine / history: the actor's own submissions, tenant-scoped.
  const where: Prisma.ApprovalRequestWhereInput = {
    ...tenantWhere(actor), ...date, ...(query ?? {}), makerId: actor.id,
  };
  if (tab === 'history') where.status = { in: ['CLOSED', 'REJECTED'] };
  if (filters.module && filters.module !== 'all') where.module = filters.module as ApprovalModule;
  if (filters.status && filters.status !== 'all') where.status = filters.status as any;
  return where;
}

function serialize(r: any) {
  return {
    id: r.id,
    module: r.module,
    moduleLabel: MODULE_LABEL[r.module as ApprovalModule],
    title: r.title,
    summary: r.summary,
    status: r.status,
    makerId: r.makerId,
    makerName: r.maker?.name ?? r.maker?.email ?? null,
    checkerName: r.checker?.name ?? r.checker?.email ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Resolved, human-readable entities referenced by an approval payload, so the
 *  detail view can show real names/amounts/documents rather than raw IDs. Driven
 *  by the payload's id keys, so it covers every module generically. Best-effort:
 *  a failed lookup just omits that slice. */
export interface ApprovalContext {
  member?: { name: string; code: string; phone: string | null; photoUrl: string | null };
  claim?: { memberName: string | null; memberCode: string | null; typeName: string | null; affectedPerson: string | null; description: string | null; date: string | null; approvedAmount: number | null };
  document?: { title: string; fileName: string; fileUrl: string; fileType: string; category: string };
  issuance?: { assetName: string | null; memberName: string | null; memberCode: string | null; issuedQty: number };
  category?: { name: string; benefitEligible: boolean; emergencyEligible: boolean };
  role?: { name: string };
  // Dependent/relative context — so a checker can see who the document belongs to
  // and every supporting document on file before approving a relative-document action.
  relative?: { name: string; relationship: string; phone: string | null; dateOfBirth: string | null; isBeneficiary: boolean; isDependent: boolean; memberName: string | null; memberCode: string | null };
  relativeDocuments?: { title: string; fileName: string; fileUrl: string; fileType: string; category: string; status: string; version: number }[];
  // Manual-payment context: the recorded payment log (reference, evidence, dates)
  // so the checker sees every detail of what they are settling.
  payment?: { transactionId: string; method: string; status: string; receiptUrl: string | null; createdAt: string; amount: number; memberBalance: number | null };
  // Rules & Bylaws publication: the full sanitized softcopy + attachments so a
  // checker can read exactly the rules they are approving.
  rulesVersion?: {
    title: string; versionNumber: number; content: string; changeSummary: string | null;
    effectiveDate: string | null; authorName: string | null;
    attachments: { name: string; fileUrl: string; fileType: string }[];
  };
  // Edir-lifecycle context: the full registration profile plus the uploaded
  // Rules & Laws (agreement) document, shown to the checker before approval.
  edir?: {
    name: string; status: string; description: string | null; accountNumber: string | null; address: string | null;
    branchName: string | null; districtName: string | null;
    contactPersonName: string | null; contactMobile: string | null; contactEmail: string | null;
    agreementDocUrl: string | null; createdAt: string;
  };
  edirName?: string | null;
}

async function resolveApprovalContext(edirId: string, module: string, rawPayload: unknown): Promise<ApprovalContext> {
  const p = (rawPayload ?? {}) as Record<string, any>;
  const ctx: ApprovalContext = {};
  const safe = async (fn: () => Promise<void>) => { try { await fn(); } catch { /* best-effort enrichment */ } };

  await Promise.all([
    safe(async () => {
      // Relative/dependent document approval: the checker should see the dependent's
      // details AND every supporting document already on file before deciding.
      if (module !== 'RELATIVE_DOCUMENT_ACTION' || !p.documentId) return;
      const doc = await prisma.relativeDocument.findUnique({
        where: { id: p.documentId },
        include: {
          relative: {
            include: {
              member: { select: { name: true, memberId: true } },
              documents: { orderBy: [{ createdAt: 'desc' }], select: { documentName: true, fileName: true, fileUrl: true, fileType: true, category: true, status: true, version: true } },
            },
          },
        },
      });
      if (!doc) return;
      const rel = doc.relative;
      ctx.document = { title: doc.documentName || doc.fileName || 'Document', fileName: doc.fileName || 'Document', fileUrl: doc.fileUrl, fileType: doc.fileType || 'file', category: doc.category };
      ctx.relative = {
        name: rel.name, relationship: rel.relationship, phone: rel.phone,
        dateOfBirth: rel.dateOfBirth ? rel.dateOfBirth.toISOString() : null,
        isBeneficiary: rel.isBeneficiary, isDependent: rel.isDependent,
        memberName: rel.member?.name ?? null, memberCode: rel.member?.memberId ?? null,
      };
      ctx.relativeDocuments = rel.documents.map(d => ({
        title: d.documentName || d.fileName || 'Document', fileName: d.fileName || 'Document',
        fileUrl: d.fileUrl, fileType: d.fileType || 'file', category: d.category, status: d.status as string, version: d.version,
      }));
    }),
    safe(async () => {
      if (!p.memberId) return;
      const m = await prisma.member.findUnique({ where: { id: p.memberId }, select: { name: true, memberId: true, phone: true, photoUrl: true } });
      if (m) ctx.member = { name: m.name, code: m.memberId, phone: m.phone, photoUrl: m.photoUrl };
    }),
    safe(async () => {
      if (!p.claimId) return;
      const c = await prisma.emergencyClaim.findUnique({
        where: { id: p.claimId },
        select: { affectedPerson: true, description: true, date: true, approvedAmount: true, member: { select: { name: true, memberId: true } }, type: { select: { name: true } } },
      });
      if (c) ctx.claim = {
        memberName: c.member?.name ?? null, memberCode: c.member?.memberId ?? null, typeName: c.type?.name ?? null,
        affectedPerson: c.affectedPerson, description: c.description, date: c.date ? c.date.toISOString() : null,
        approvedAmount: c.approvedAmount != null ? Number(c.approvedAmount) : null,
      };
    }),
    safe(async () => {
      if (module !== 'DOCUMENT_ACTION' || !p.documentId) return;
      const d = await prisma.dmsDocument.findUnique({ where: { id: p.documentId }, select: { title: true, fileName: true, fileUrl: true, fileType: true, category: true } });
      if (d) ctx.document = d;
    }),
    safe(async () => {
      if (!p.issuanceId) return;
      const i = await prisma.assetIssuance.findUnique({ where: { id: p.issuanceId }, select: { issuedQty: true, asset: { select: { name: true } }, member: { select: { name: true, memberId: true } } } });
      if (i) ctx.issuance = { assetName: i.asset?.name ?? null, memberName: i.member?.name ?? null, memberCode: i.member?.memberId ?? null, issuedQty: i.issuedQty };
    }),
    safe(async () => {
      if (!p.categoryId) return;
      const cat = await prisma.relationshipCategory.findUnique({ where: { id: p.categoryId }, select: { name: true, benefitEligible: true, emergencyEligible: true } });
      if (cat) ctx.category = cat;
    }),
    safe(async () => {
      if (!p.roleId) return;
      const r = await prisma.role.findUnique({ where: { id: p.roleId }, select: { name: true } });
      if (r) ctx.role = r;
    }),
    safe(async () => {
      // Manual payment / payment void: surface the payment log (reference,
      // evidence, amount, member balance) so the checker reviews the full picture.
      if ((module !== 'MANUAL_PAYMENT' && module !== 'PAYMENT_VOID') || !p.paymentLogId) return;
      const log = await prisma.paymentLog.findUnique({
        where: { id: p.paymentLogId },
        select: {
          transactionId: true, method: true, status: true, receiptUrl: true, createdAt: true, amount: true,
          member: { select: { name: true, memberId: true, phone: true, photoUrl: true, paymentStatus: { select: { balance: true } } } },
        },
      });
      if (!log) return;
      ctx.payment = {
        transactionId: log.transactionId, method: log.method, status: log.status,
        receiptUrl: log.receiptUrl, createdAt: log.createdAt.toISOString(), amount: Number(log.amount),
        memberBalance: log.member?.paymentStatus ? Number(log.member.paymentStatus.balance) : null,
      };
      // The void request carries no memberId in its payload; resolve the subject
      // from the payment's own member so the approval shows who it belongs to.
      if (!ctx.member && log.member) ctx.member = { name: log.member.name, code: log.member.memberId, phone: log.member.phone, photoUrl: log.member.photoUrl };
      if (log.receiptUrl) {
        const fileName = log.receiptUrl.split('/').pop() ?? 'receipt';
        ctx.document = {
          title: 'Payment receipt / evidence', fileName, fileUrl: log.receiptUrl,
          fileType: fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image', category: 'Payment Receipts',
        };
      }
    }),
    safe(async () => {
      // Edir registration/update: full profile + the uploaded Rules & Laws
      // (agreement) document for review before the decision.
      if (module !== 'EDIR_REGISTRATION' && module !== 'EDIR_UPDATE') return;
      const e = await prisma.edir.findUnique({
        where: { id: (p.edirId as string) || edirId },
        select: {
          name: true, status: true, description: true, accountNumber: true, address: true,
          contactPersonName: true, contactMobile: true, contactEmail: true, agreementDocUrl: true, createdAt: true,
          branch: { select: { name: true, district: { select: { name: true } } } },
        },
      });
      if (!e) return;
      ctx.edir = {
        name: e.name, status: e.status, description: e.description, accountNumber: e.accountNumber, address: e.address,
        branchName: e.branch?.name ?? null, districtName: e.branch?.district?.name ?? null,
        contactPersonName: e.contactPersonName, contactMobile: e.contactMobile, contactEmail: e.contactEmail,
        agreementDocUrl: e.agreementDocUrl, createdAt: e.createdAt.toISOString(),
      };
      // Only a real uploaded path is presentable (older records stored a bare file name).
      if (e.agreementDocUrl && /^(\/|https?:)/.test(e.agreementDocUrl)) {
        const fileName = e.agreementDocUrl.split('/').pop() ?? 'agreement';
        ctx.document = {
          title: 'Edir Rules & Laws (agreement document)', fileName, fileUrl: e.agreementDocUrl,
          fileType: fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image', category: 'Agreement',
        };
      }
    }),
    safe(async () => {
      // Rules & Bylaws publication — load the full softcopy + attachments so the
      // checker reads the exact rules they're approving.
      if (module !== 'RULE_CHANGE' || (p.kind !== 'RULES_VERSION_PUBLISH') || !p.versionId) return;
      const v = await prisma.rulesVersion.findUnique({
        where: { id: p.versionId },
        include: { attachments: true, author: { select: { name: true, email: true } } },
      });
      if (!v) return;
      const fileType = (name: string) => { const e = (name.split('.').pop() || '').toLowerCase(); return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(e) ? 'image' : e === 'pdf' ? 'pdf' : 'file'; };
      ctx.rulesVersion = {
        // Rendered via dangerouslySetInnerHTML in the approval view — re-sanitize.
        title: v.title, versionNumber: v.versionNumber, content: sanitizeHtml(v.content), changeSummary: v.changeSummary,
        effectiveDate: v.effectiveDate ? v.effectiveDate.toISOString() : null,
        authorName: v.author?.name ?? v.author?.email ?? null,
        attachments: v.attachments.map(a => ({ name: a.name, fileUrl: a.url, fileType: fileType(a.name) })),
      };
    }),
    safe(async () => {
      ctx.edirName = (await prisma.edir.findUnique({ where: { id: edirId }, select: { name: true } }))?.name ?? null;
    }),
  ]);
  return ctx;
}

export async function getApprovals(tab: ApprovalTab, filters: ApprovalFilters = {}) {
  [tab, filters] = parseArgs([tabSchema, filtersSchema], [tab, filters]) as [ApprovalTab, ApprovalFilters];
  const actor = await getActor();
  const where = buildApprovalWhere(actor, tab, filters);
  if (!where) return [];

  const items = await prisma.approvalRequest.findMany({
    where,
    include: { maker: true, checker: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  return items.map(serialize);
}

/** Tenant-scoped KPI counts for the Approvals Center stat cards. */
export async function getApprovalStats() {
  const actor = await getActor();
  const base = tenantWhere(actor);
  // Pending count mirrors the Pending list's role/scope-aware visibility.
  const pendingWhere = buildApprovalWhere(actor, 'pending', {});

  const [pending, mine, byStatus] = await Promise.all([
    pendingWhere ? prisma.approvalRequest.count({ where: pendingWhere }) : Promise.resolve(0),
    prisma.approvalRequest.count({ where: { ...base, makerId: actor.id } }),
    prisma.approvalRequest.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ]);

  const counts = Object.fromEntries(byStatus.map(r => [r.status, r._count._all]));
  return {
    pending,
    mine,
    approved: counts.CLOSED ?? 0,
    rejected: counts.REJECTED ?? 0,
    returned: counts.RETURNED ?? 0,
    total: byStatus.reduce((s, r) => s + r._count._all, 0),
    // Module options for the filter dropdown (all modules; the list query still
    // scopes the pending tab to the actor's checkable modules).
    modules: (Object.keys(MODULE_LABEL) as ApprovalModule[]).map(id => ({ id, label: MODULE_LABEL[id] })),
  };
}

/** CSV export of the current tab + filters. */
export async function exportApprovalsCsv(tab: ApprovalTab, filters: ApprovalFilters = {}) {
  [tab, filters] = parseArgs([tabSchema, filtersSchema], [tab, filters]) as [ApprovalTab, ApprovalFilters];
  const actor = await getActor();
  const where = buildApprovalWhere(actor, tab, filters);
  const rows = where
    ? await prisma.approvalRequest.findMany({ where, include: { maker: true, checker: true }, orderBy: { updatedAt: 'desc' }, take: 5000 })
    : [];
  const header = ['Module', 'Title', 'Summary', 'Maker', 'Checker', 'Status', 'Submitted', 'Updated'];
  const body = rows.map(r => [
    MODULE_LABEL[r.module as ApprovalModule] ?? r.module,
    r.title, r.summary ?? '',
    r.maker?.name ?? r.maker?.email ?? '',
    r.checker?.name ?? r.checker?.email ?? '',
    r.status,
    r.createdAt.toISOString(), r.updatedAt.toISOString(),
  ]);
  return toCsv([header, ...body]);
}

export async function getApprovalDetail(id: string) {
  id = zId.parse(id);
  const actor = await getActor();
  const request = await prisma.approvalRequest.findUnique({
    where: { id },
    include: {
      maker: true,
      checker: true,
      events: { include: { actor: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!request) return null;

  // Authorized to view if: super-admin, the maker, OR a checker in scope for this
  // module class (governance → org hierarchy; operational → the Edir's own users).
  const isMaker = request.makerId === actor.id;
  const checkerPerm = MODULE_CHECKER_PERMISSION[request.module];
  const inScope = actorHasPermission(actor, checkerPerm) && await canCheckRequest(actor, request);

  if (!actor.isSuperAdmin && !isMaker && !inScope) {
    return null;
  }

  const canCheck = !isMaker && request.status === 'PENDING' && inScope;
  const canResubmit = isMaker && request.status === 'RETURNED';

  return {
    ...serialize(request),
    payload: request.payload,
    context: await resolveApprovalContext(request.edirId, request.module, request.payload),
    timeline: request.events.map(e => ({
      id: e.id, type: e.type, comment: e.comment, createdAt: e.createdAt,
      actorName: e.actor?.name ?? e.actor?.email ?? 'Unknown',
    })),
    canCheck,
    isMaker,
    canResubmit,
  };
}

export async function getPendingApprovalCount() {
  try {
    const actor = await getActor();
    return await pendingApprovalCountForActor(actor);
  } catch {
    return 0;
  }
}

export async function approveAction(id: string, comment?: string) {
  try { await approveRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function rejectAction(id: string, comment?: string) {
  try { await rejectRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function returnAction(id: string, comment?: string) {
  try { await returnRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function commentAction(id: string, comment: string) {
  try { await commentOnRequest(id, comment); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}
export async function resubmitAction(id: string, summary?: string) {
  try { await resubmitRequest(id, undefined, summary); revalidatePath('/dashboard/approvals'); return { success: true as const }; }
  catch (error) { return failure(error); }
}

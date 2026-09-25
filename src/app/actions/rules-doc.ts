'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, resolveEdirId, tenantWhere } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { sanitizeHtml, htmlToText } from '@/lib/sanitize-html';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { zId, zText, zUploadPath, zSearch } from '@/lib/validation';

const OPEN: Prisma.ApprovalRequestWhereInput['status'] = { in: ['PENDING', 'RETURNED'] };

async function openRequestMap(versionIds: string[]) {
  if (versionIds.length === 0) return new Map<string, string>();
  const reqs = await prisma.approvalRequest.findMany({
    where: { module: 'RULE_CHANGE', targetType: 'RulesVersion', targetId: { in: versionIds } },
    select: { targetId: true, status: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  const m = new Map<string, string>();
  for (const r of reqs) { if (r.targetId && !m.has(r.targetId)) m.set(r.targetId, r.status); }
  return m;
}

function serialize(v: any, reqStatus?: string) {
  return {
    // Content is sanitized on write; re-sanitize on read so legacy/seeded rows
    // can never reach dangerouslySetInnerHTML unfiltered.
    id: v.id, versionNumber: v.versionNumber, title: v.title, content: sanitizeHtml(v.content),
    changeSummary: v.changeSummary, effectiveDate: v.effectiveDate, status: v.status,
    authorName: v.author?.name ?? v.author?.email ?? null,
    approverName: v.approver?.name ?? v.approver?.email ?? null,
    approvedAt: v.approvedAt, comment: v.comment, createdAt: v.createdAt, updatedAt: v.updatedAt,
    attachments: (v.attachments ?? []).map((a: any) => ({ id: a.id, name: a.name, url: a.url })),
    requestStatus: reqStatus ?? null, // PENDING | RETURNED | REJECTED | CLOSED | null
    pending: reqStatus === 'PENDING' || reqStatus === 'RETURNED',
  };
}

/** The live, member-visible approved rules (read-only). */
export async function getCurrentRules() {
  const actor = await getActor();
  await assertPermission(actor, ['view_rules', 'manage_rules']);
  const edirId = await resolveEdirId(actor);
  const v = await prisma.rulesVersion.findFirst({
    where: { edirId, status: 'APPROVED' },
    include: { author: true, approver: true, attachments: true },
    orderBy: { versionNumber: 'desc' },
  });
  return v ? serialize(v) : null;
}

/** All versions for history/audit, newest first, with derived approval status. */
export async function getRulesHistory() {
  const actor = await getActor();
  await assertPermission(actor, ['view_rules', 'manage_rules']);
  const edirId = await resolveEdirId(actor);
  const versions = await prisma.rulesVersion.findMany({
    where: { edirId },
    include: { author: true, approver: true, attachments: true },
    orderBy: [{ createdAt: 'desc' }],
  });
  const reqMap = await openRequestMap(versions.map(v => v.id));
  const canManage = actor.isSuperAdmin || actor.permissions.includes('manage_rules');
  return versions.map(v => ({ ...serialize(v, reqMap.get(v.id)), canManage }));
}

/** Everything the Rules & Bylaws page needs in one call. */
export async function getRulesPage() {
  const actor = await getActor();
  await assertPermission(actor, ['view_rules', 'manage_rules']);
  if (actor.isSuperAdmin && !actor.activeEdirId) return { needsEdir: true as const, canManage: false, current: null, history: [] as any[] };
  const edirId = await resolveEdirId(actor);
  const versions = await prisma.rulesVersion.findMany({
    where: { edirId },
    include: { author: true, approver: true, attachments: true },
    orderBy: [{ createdAt: 'desc' }],
  });
  const reqMap = await openRequestMap(versions.map(v => v.id));
  const canManage = actor.isSuperAdmin || actor.permissions.includes('manage_rules');
  const history = versions.map(v => serialize(v, reqMap.get(v.id)));
  const current = history.find(v => v.status === 'APPROVED') ?? null;
  return { canManage, current, history };
}

export async function getRulesVersion(id: string) {
  id = zId.parse(id);
  const actor = await getActor();
  await assertPermission(actor, ['view_rules', 'manage_rules']);
  const v = await prisma.rulesVersion.findUnique({ where: { id }, include: { author: true, approver: true, attachments: true } });
  if (!v) return null;
  await assertSameTenant(actor, v.edirId);
  const reqMap = await openRequestMap([v.id]);
  return serialize(v, reqMap.get(v.id));
}

// Plain-text fields (title, change summary) are rendered as text, never HTML.
// Reject markup and control characters at the boundary so they can't be
// smuggled into audit logs, notifications, emails or print output.
const NO_MARKUP = /^[^<>]*$/;
const NO_CONTROL_CHARS = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;
const plainText = (label: string, max: number) =>
  z.string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .regex(NO_MARKUP, `${label} must not contain < or > characters.`)
    .regex(NO_CONTROL_CHARS, `${label} contains invalid characters.`);

const changeSummarySchema = plainText('Change summary', 1000).optional().nullable();

const draftSchema = z.object({
  title: plainText('Title', 200).pipe(z.string().min(2, 'A title is required.')),
  content: z.string().min(1, 'Rules content cannot be empty.').max(500_000, 'Rules content is too large.'),
  changeSummary: changeSummarySchema,
  effectiveDate: z.string().trim().optional().nullable()
    .refine((d) => !d || !Number.isNaN(Date.parse(d)), 'Effective date is invalid.'),
});

export async function createDraft(input: z.infer<typeof draftSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_rules');
    const data = draftSchema.parse(input);
    const last = await prisma.rulesVersion.findFirst({ where: { edirId }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } });
    const version = await prisma.rulesVersion.create({
      data: {
        edirId, versionNumber: (last?.versionNumber ?? 0) + 1,
        title: data.title, content: sanitizeHtml(data.content), changeSummary: data.changeSummary || null,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
        status: 'DRAFT', authorId: actor.id,
      },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_DRAFT_CREATED', targetType: 'RulesVersion', targetId: version.id, details: `v${version.versionNumber}: ${data.title}` });
    revalidatePath('/dashboard/rules');
    return { success: true as const, id: version.id };
  } catch (error) {
    return failure(error);
  }
}

/** Start a new draft pre-filled from the current approved version. */
export async function cloneCurrentToDraft() {
  try {
    const { actor, edirId } = await requireActor('manage_rules');
    const current = await prisma.rulesVersion.findFirst({ where: { edirId, status: 'APPROVED' }, orderBy: { versionNumber: 'desc' } });
    const last = await prisma.rulesVersion.findFirst({ where: { edirId }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } });
    const version = await prisma.rulesVersion.create({
      data: {
        edirId, versionNumber: (last?.versionNumber ?? 0) + 1,
        title: current?.title ?? 'Rules & Bylaws', content: current?.content ?? '<h1>Rules &amp; Bylaws</h1><p></p>',
        status: 'DRAFT', authorId: actor.id, changeSummary: current ? `Revision of v${current.versionNumber}` : 'Initial version',
      },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_DRAFT_CREATED', targetType: 'RulesVersion', targetId: version.id, details: `v${version.versionNumber} (cloned)` });
    revalidatePath('/dashboard/rules');
    return { success: true as const, id: version.id };
  } catch (error) {
    return failure(error);
  }
}

async function loadEditableDraft(actor: Awaited<ReturnType<typeof getActor>>, id: string) {
  const v = await prisma.rulesVersion.findUnique({ where: { id } });
  if (!v) return { error: 'Version not found.' as const };
  await assertSameTenant(actor, v.edirId);
  if (v.status !== 'DRAFT') return { error: 'Only draft versions can be edited.' as const };
  const open = await prisma.approvalRequest.count({ where: { module: 'RULE_CHANGE', targetType: 'RulesVersion', targetId: id, status: OPEN } });
  if (open > 0) return { error: 'This version is awaiting approval and cannot be edited.' as const };
  return { version: v };
}

export async function updateDraft(id: string, input: z.infer<typeof draftSchema>) {
  try {
    id = zId.parse(id);
    const { actor, edirId } = await requireActor('manage_rules');
    const data = draftSchema.parse(input);
    const res = await loadEditableDraft(actor, id);
    if ('error' in res) return { success: false as const, error: res.error };
    await prisma.rulesVersion.update({
      where: { id },
      data: { title: data.title, content: sanitizeHtml(data.content), changeSummary: data.changeSummary || null, effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_DRAFT_UPDATED', targetType: 'RulesVersion', targetId: id });
    revalidatePath('/dashboard/rules');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDraft(id: string) {
  try {
    id = zId.parse(id);
    const { actor, edirId } = await requireActor('manage_rules');
    const res = await loadEditableDraft(actor, id);
    if ('error' in res) return { success: false as const, error: res.error };
    await prisma.rulesVersion.delete({ where: { id } });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_DRAFT_DELETED', targetType: 'RulesVersion', targetId: id });
    revalidatePath('/dashboard/rules');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function submitRulesVersion(id: string, summary?: string) {
  try {
    id = zId.parse(id);
    const { actor, edirId } = await requireActor('manage_rules');
    summary = changeSummarySchema.parse(summary) ?? undefined;
    const res = await loadEditableDraft(actor, id);
    if ('error' in res) return { success: false as const, error: res.error };
    const v = res.version;

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'RULE_CHANGE',
      title: `Publish Rules & Bylaws v${v.versionNumber}: ${v.title}`,
      summary: summary || v.changeSummary || undefined,
      payload: { kind: 'RULES_VERSION_PUBLISH', versionId: v.id, title: v.title, versionNumber: v.versionNumber },
      targetType: 'RulesVersion',
      targetId: v.id,
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_VERSION_SUBMITTED', targetType: 'RulesVersion', targetId: v.id, details: `v${v.versionNumber}` });
    revalidatePath('/dashboard/rules');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

// ─── Attachments ─────────────────────────────────────────────────────────────

const attachmentSchema = z.object({ name: zText('File name', { min: 1, max: 255 }), url: zUploadPath });

export async function addRulesAttachment(versionId: string, input: z.infer<typeof attachmentSchema>) {
  try {
    versionId = zId.parse(versionId);
    const { actor, edirId } = await requireActor('manage_rules');
    const res = await loadEditableDraft(actor, versionId);
    if ('error' in res) return { success: false as const, error: res.error };
    const data = attachmentSchema.parse(input);
    await prisma.rulesAttachment.create({ data: { versionId, name: data.name, url: data.url } });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_ATTACHMENT_ADDED', targetType: 'RulesVersion', targetId: versionId, details: data.name });
    revalidatePath('/dashboard/rules');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function removeRulesAttachment(attachmentId: string) {
  try {
    attachmentId = zId.parse(attachmentId);
    const { actor, edirId } = await requireActor('manage_rules');
    const att = await prisma.rulesAttachment.findUnique({ where: { id: attachmentId }, include: { version: true } });
    if (!att) return { success: false as const, error: 'Attachment not found.' };
    await assertSameTenant(actor, att.version.edirId);
    if (att.version.status !== 'DRAFT') return { success: false as const, error: 'Attachments can only be changed on a draft.' };
    await prisma.rulesAttachment.delete({ where: { id: attachmentId } });
    await writeAudit({ edirId, userId: actor.id, action: 'RULES_ATTACHMENT_REMOVED', targetType: 'RulesVersion', targetId: att.versionId });
    revalidatePath('/dashboard/rules');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Lightweight search across version titles + plain-text content (audit/compliance). */
export async function searchRules(query: string) {
  query = zSearch.parse(query) ?? '';
  const actor = await getActor();
  await assertPermission(actor, ['view_rules', 'manage_rules']);
  const edirId = await resolveEdirId(actor);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const versions = await prisma.rulesVersion.findMany({ where: { edirId }, orderBy: { createdAt: 'desc' } });
  return versions
    .map(v => ({ id: v.id, versionNumber: v.versionNumber, title: v.title, status: v.status, text: htmlToText(v.content) }))
    .filter(v => v.title.toLowerCase().includes(q) || v.text.toLowerCase().includes(q))
    .map(v => ({ id: v.id, versionNumber: v.versionNumber, title: v.title, status: v.status, snippet: snippet(v.text, q) }));
}

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 60);
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 60) + '…';
}

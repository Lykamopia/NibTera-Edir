'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getActor, requireActor, assertPermission, assertSameTenant, tenantWhere, usersWithPermission } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { createNotification, createNotifications } from '@/lib/notification-helpers';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { dateWhere, type DateRangeParam } from '@/lib/date-range';
import { resolveOwnMembership } from '@/lib/membership-policy';

const TYPE_LABEL: Record<string, string> = {
  RELATIVE: 'Relative Request', EMERGENCY: 'Emergency Request', ASSET: 'Asset Request',
  GRIEVANCE: 'Grievance', FEEDBACK: 'Feedback',
};

/** DMS folder a member-uploaded document lands in, by request type. */
const DOC_CATEGORY: Record<string, string> = {
  RELATIVE: 'Relative Documents', EMERGENCY: 'Emergency Documents', ASSET: 'Asset Documents',
  GRIEVANCE: 'Grievance Documents', FEEDBACK: 'Member Uploads',
};

function fileTypeOf(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

/**
 * Resolve the signed-in user's own member record (self-service scope). A user may
 * hold memberships in several Edirs when the platform membership policy allows
 * it, so this resolves the one for their home Edir rather than an arbitrary row.
 */
async function getActorMember() {
  const actor = await getActor();
  const member = await resolveOwnMembership(actor.id, { homeEdirId: actor.edirId });
  return { actor, member };
}

const submitSchema = z.object({
  type: z.enum(['RELATIVE', 'EMERGENCY', 'ASSET', 'GRIEVANCE', 'FEEDBACK']),
  category: z.string().max(80).optional().nullable(),
  subject: z.string().min(2, 'A subject is required.').max(160),
  description: z.string().max(4000).optional().nullable(),
  payload: z.record(z.any()).optional().nullable(),
  attachments: z.array(z.string()).optional().default([]),
});

/** Member submits a self-service request (relative, emergency, asset, grievance, feedback). */
export async function submitMemberRequest(input: z.infer<typeof submitSchema>) {
  try {
    const { actor, member } = await getActorMember();
    if (!member) return { success: false as const, error: 'No membership is linked to your account. Please contact your Edir administrator.' };
    const data = submitSchema.parse(input);
    const edirId = member.edirId;

    // Light eligibility gate for emergencies: must be an active member.
    if (data.type === 'EMERGENCY' && member.status !== 'ACTIVE') {
      return { success: false as const, error: 'Only active members can submit an emergency request.' };
    }

    const request = await prisma.memberRequest.create({
      data: {
        edirId, memberId: member.id, type: data.type, category: data.category || null,
        subject: data.subject, description: data.description || null,
        payload: (data.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        attachments: (data.attachments?.length ? data.attachments : undefined) as Prisma.InputJsonValue | undefined,
        status: 'PENDING',
      },
    });

    await writeAudit({ edirId, userId: actor.id, action: 'MEMBER_REQUEST_SUBMITTED', targetType: 'MemberRequest', targetId: request.id, details: `${TYPE_LABEL[data.type]}: ${data.subject}` });

    // Mirror every uploaded file into the central Document repository and route it
    // through the Document maker–checker workflow. The file therefore lands in:
    //  • the Documents page (DMS storage),
    //  • the Approvals center (DOCUMENT_ACTION request awaiting a checker), and
    //  • the member's own "My Documents" tab (uploadedById = the member's user).
    for (const url of data.attachments ?? []) {
      const fileName = url.split('/').pop() || 'Document';
      const doc = await prisma.dmsDocument.create({
        data: {
          edirId,
          title: fileName,
          category: DOC_CATEGORY[data.type] ?? 'Member Uploads',
          tags: data.type,
          purpose: `${TYPE_LABEL[data.type]}: ${data.subject}`,
          fileUrl: url,
          fileName,
          fileType: fileTypeOf(fileName),
          status: 'PENDING',
          visibility: 'staff',
          pendingAction: 'upload',
          uploadedById: actor.id,
        },
      });
      await submitForApproval(actor, {
        edirId,
        module: 'DOCUMENT_ACTION',
        title: `Member document: ${fileName}`,
        summary: `${TYPE_LABEL[data.type]} from ${member.name}`,
        payload: { documentId: doc.id, action: 'upload' },
        targetType: 'DmsDocument',
        targetId: doc.id,
      });
    }

    // Notify staff who handle member requests.
    const staff = (await usersWithPermission(edirId, 'handle_member_requests')).filter(u => u.id !== actor.id);
    if (staff.length > 0) {
      await createNotifications(staff.map(u => ({
        userId: u.id, type: 'member' as const, priority: 'normal' as const,
        title: `New ${TYPE_LABEL[data.type]}`, body: `${member.name}: ${data.subject}`,
        linkUrl: '/dashboard/requests', entityId: request.id, entityType: 'MemberRequest', edirId,
      })));
    }

    revalidatePath('/dashboard/account');
    revalidatePath('/dashboard/requests');
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, id: request.id };
  } catch (error) {
    return failure(error);
  }
}

/** The signed-in member's own requests. */
export async function getMyRequests() {
  const { member } = await getActorMember();
  if (!member) return [];
  const requests = await prisma.memberRequest.findMany({ where: { memberId: member.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  return requests.map(serialize);
}

function serialize(r: any) {
  return {
    id: r.id, type: r.type, typeLabel: TYPE_LABEL[r.type] ?? r.type, category: r.category,
    subject: r.subject, description: r.description, payload: r.payload,
    attachments: Array.isArray(r.attachments) ? (r.attachments as string[]) : [],
    status: r.status, response: r.response, reviewedAt: r.reviewedAt, createdAt: r.createdAt,
    memberName: r.member?.name ?? null, memberCode: r.member?.memberId ?? null,
    reviewerName: r.reviewedBy?.name ?? r.reviewedBy?.email ?? null,
  };
}

// ─── Staff handling ──────────────────────────────────────────────────────────

export async function getMemberRequests(params: { status?: string; type?: string; range?: DateRangeParam } = {}) {
  const actor = await getActor();
  await assertPermission(actor, 'handle_member_requests');
  const where: Prisma.MemberRequestWhereInput = {
    ...tenantWhere(actor),
    ...dateWhere('createdAt', params.range),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
    ...(params.type && params.type !== 'all' ? { type: params.type as any } : {}),
  };
  const requests = await prisma.memberRequest.findMany({
    where, include: { member: { select: { name: true, memberId: true } }, reviewedBy: { select: { name: true, email: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200,
  });
  return requests.map(serialize);
}

const respondSchema = z.object({
  decision: z.enum(['IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED']),
  response: z.string().max(4000).optional().nullable(),
});

export async function respondMemberRequest(id: string, input: z.infer<typeof respondSchema>) {
  try {
    const { actor, edirId } = await requireActor('handle_member_requests');
    const data = respondSchema.parse(input);
    const request = await prisma.memberRequest.findUnique({ where: { id }, include: { member: true } });
    if (!request) return { success: false as const, error: 'Request not found.' };
    await assertSameTenant(actor, request.edirId);

    await prisma.$transaction(async (tx) => {
      // Perform the downstream action when a request is approved.
      if (data.decision === 'APPROVED') {
        const payload = (request.payload ?? {}) as any;
        const attachments = Array.isArray(request.attachments) ? (request.attachments as string[]) : [];

        if (request.type === 'RELATIVE') {
          const rel = await tx.relative.create({
            data: {
              memberId: request.memberId,
              name: payload.name || request.subject,
              relationship: payload.relationship || request.category || 'Other',
              phone: payload.phone || null,
              dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : null,
              isBeneficiary: true,
            },
          });
          if (attachments.length > 0) {
            await tx.relativeDocument.createMany({
              data: attachments.map(url => ({ relativeId: rel.id, fileUrl: url, fileName: url.split('/').pop() ?? 'Document', status: 'PENDING' as const })),
            });
          }
        } else if (request.type === 'EMERGENCY') {
          await tx.emergencyClaim.create({
            data: {
              edirId, memberId: request.memberId, typeId: payload.typeId || null,
              affectedPerson: payload.affectedPerson || null, description: request.description || null,
              date: payload.date ? new Date(payload.date) : null, location: payload.location || null,
              priority: payload.priority || 'normal', status: 'REPORTED',
            },
          });
        }
        // ASSET / GRIEVANCE / FEEDBACK: no entity created — resolved via response.
      }

      await tx.memberRequest.update({
        where: { id }, data: { status: data.decision, response: data.response || null, reviewedById: actor.id, reviewedAt: new Date() },
      });
      await writeAudit({ edirId, userId: actor.id, action: `MEMBER_REQUEST_${data.decision}`, targetType: 'MemberRequest', targetId: id, details: data.response || TYPE_LABEL[request.type] }, tx);
    });

    // Notify the requesting member.
    if (request.member.userId) {
      await createNotification({
        userId: request.member.userId, type: 'member', priority: 'high',
        title: `Your ${TYPE_LABEL[request.type]} was ${data.decision.toLowerCase().replace('_', ' ')}`,
        body: data.response || request.subject,
        linkUrl: '/dashboard/account', entityId: id, entityType: 'MemberRequest', edirId,
      });
    }

    revalidatePath('/dashboard/requests');
    revalidatePath('/dashboard/account');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

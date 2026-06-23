'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, tenantWhere } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { createNotifications } from '@/lib/notification-helpers';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// ─── Events (read) ───────────────────────────────────────────────────────────

/** Tenant-wide event KPIs for the summary cards. */
export async function getEventsSummary() {
  const actor = await getActor();
  await assertPermission(actor, ['view_events', 'manage_events']);
  const where = tenantWhere(actor);
  const now = new Date();
  const [byStatus, upcoming, penalized, participants] = await Promise.all([
    prisma.event.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.event.count({ where: { ...where, status: 'SCHEDULED', datetime: { gte: now } } }),
    prisma.eventParticipant.count({ where: { event: where, penalized: true } }),
    prisma.eventParticipant.count({ where: { event: where } }),
  ]);
  const counts = Object.fromEntries(byStatus.map(r => [r.status, r._count._all]));
  return {
    total: byStatus.reduce((s, r) => s + r._count._all, 0),
    scheduled: counts.SCHEDULED ?? 0,
    completed: counts.COMPLETED ?? 0,
    cancelled: counts.CANCELLED ?? 0,
    upcoming,
    penalizedAbsences: penalized,
    participants,
  };
}

export async function getEvents(params: { status?: string; query?: string } = {}) {
  const actor = await getActor();
  await assertPermission(actor, ['view_events', 'manage_events']);
  const where: Prisma.EventWhereInput = {
    ...tenantWhere(actor),
    ...(params.status && params.status !== 'all' ? { status: params.status as any } : {}),
    ...(params.query ? { OR: [
      { title: { contains: params.query, mode: 'insensitive' } },
      { location: { contains: params.query, mode: 'insensitive' } },
    ] } : {}),
  };
  const events = await prisma.event.findMany({
    where,
    include: { _count: { select: { participants: true } } },
    orderBy: { datetime: 'desc' },
  });
  return events.map(e => ({
    id: e.id,
    title: e.title,
    datetime: e.datetime,
    location: e.location,
    attendanceRequired: e.attendanceRequired,
    absencePenalty: Number(e.absencePenalty),
    status: e.status,
    participantCount: e._count.participants,
  }));
}

export async function getEvent(id: string) {
  const actor = await getActor();
  await assertPermission(actor, ['view_events', 'manage_events']);
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      participants: {
        include: { member: { select: { id: true, name: true, memberId: true } } },
        orderBy: { member: { name: 'asc' } },
      },
    },
  });
  if (!event) return null;
  await assertSameTenant(actor, event.edirId);
  return {
    id: event.id,
    title: event.title,
    datetime: event.datetime,
    location: event.location,
    attendanceRequired: event.attendanceRequired,
    absencePenalty: Number(event.absencePenalty),
    status: event.status,
    participants: event.participants.map(p => ({
      id: p.id,
      memberId: p.member.id,
      memberCode: p.member.memberId,
      name: p.member.name,
      status: p.status,
      penalized: p.penalized,
    })),
  };
}

// ─── Create / edit / cancel ──────────────────────────────────────────────────

const eventSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(2, 'Title is required.'),
  datetime: z.string().min(1, 'A date and time is required.'),
  location: z.string().optional().nullable(),
  attendanceRequired: z.boolean().default(false),
  absencePenalty: z.coerce.number().min(0).default(0),
});

export async function saveEvent(input: z.infer<typeof eventSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_events');
    const data = eventSchema.parse(input);
    const when = new Date(data.datetime);
    if (isNaN(+when)) return { success: false as const, error: 'Invalid date/time.' };

    if (data.id) {
      const existing = await prisma.event.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Event not found.' };
      await assertSameTenant(actor, existing.edirId);
      if (existing.status === 'COMPLETED') return { success: false as const, error: 'A finalized event cannot be edited.' };
      await prisma.event.update({
        where: { id: data.id },
        data: {
          title: data.title, datetime: when, location: data.location || null,
          attendanceRequired: data.attendanceRequired, absencePenalty: new Prisma.Decimal(data.absencePenalty),
        },
      });
      await writeAudit({ edirId, userId: actor.id, action: 'EVENT_UPDATED', targetType: 'Event', targetId: data.id, details: data.title });
      revalidatePath('/dashboard/events');
      return { success: true as const, eventId: data.id };
    }

    const created = await prisma.event.create({
      data: {
        edirId, title: data.title, datetime: when, location: data.location || null,
        attendanceRequired: data.attendanceRequired, absencePenalty: new Prisma.Decimal(data.absencePenalty),
        status: 'SCHEDULED',
      },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'EVENT_CREATED', targetType: 'Event', targetId: created.id, details: data.title });
    revalidatePath('/dashboard/events');
    return { success: true as const, eventId: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelEvent(id: string) {
  try {
    const { actor, edirId } = await requireActor('manage_events');
    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) return { success: false as const, error: 'Event not found.' };
    await assertSameTenant(actor, event.edirId);
    if (event.status === 'COMPLETED') return { success: false as const, error: 'A finalized event cannot be cancelled.' };
    await prisma.event.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit({ edirId, userId: actor.id, action: 'EVENT_CANCELLED', targetType: 'Event', targetId: id, details: event.title });
    revalidatePath('/dashboard/events');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Participants ────────────────────────────────────────────────────────────

export async function addParticipants(eventId: string, memberIds: string[]) {
  try {
    const { actor, edirId } = await requireActor('manage_events');
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return { success: false as const, error: 'Event not found.' };
    await assertSameTenant(actor, event.edirId);
    if (event.status !== 'SCHEDULED') return { success: false as const, error: 'Participants can only be added to scheduled events.' };

    // Only members of this tenant are eligible.
    const members = await prisma.member.findMany({ where: { id: { in: memberIds }, edirId }, select: { id: true } });
    if (members.length === 0) return { success: false as const, error: 'No eligible members selected.' };

    const result = await prisma.eventParticipant.createMany({
      data: members.map(m => ({ eventId, memberId: m.id, status: 'INVITED' as const })),
      skipDuplicates: true,
    });
    await writeAudit({ edirId, userId: actor.id, action: 'EVENT_PARTICIPANTS_ADDED', targetType: 'Event', targetId: eventId, details: `Added ${result.count} participant(s).` });
    revalidatePath('/dashboard/events');
    return { success: true as const, added: result.count };
  } catch (error) {
    return failure(error);
  }
}

/** Convenience: invite every active member of the tenant. */
export async function inviteAllActiveMembers(eventId: string) {
  const actor = await getActor();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { success: false as const, error: 'Event not found.' };
  const members = await prisma.member.findMany({ where: { edirId: event.edirId, status: 'ACTIVE' }, select: { id: true } });
  return addParticipants(eventId, members.map(m => m.id));
}

export async function removeParticipant(participantId: string) {
  try {
    const { actor, edirId } = await requireActor('manage_events');
    const participant = await prisma.eventParticipant.findUnique({ where: { id: participantId }, include: { event: true } });
    if (!participant) return { success: false as const, error: 'Participant not found.' };
    await assertSameTenant(actor, participant.event.edirId);
    if (participant.event.status !== 'SCHEDULED') return { success: false as const, error: 'Participants can only be removed from scheduled events.' };
    if (participant.penalized) return { success: false as const, error: 'A penalized participant cannot be removed.' };
    await prisma.eventParticipant.delete({ where: { id: participantId } });
    await writeAudit({ edirId, userId: actor.id, action: 'EVENT_PARTICIPANT_REMOVED', targetType: 'EventParticipant', targetId: participantId });
    revalidatePath('/dashboard/events');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

const attendanceStatuses = ['INVITED', 'ATTENDING', 'DECLINED', 'PRESENT', 'ABSENT', 'EXCUSED'] as const;

export async function setAttendance(participantId: string, status: (typeof attendanceStatuses)[number]) {
  try {
    const { actor, edirId } = await requireActor('manage_events');
    if (!attendanceStatuses.includes(status)) return { success: false as const, error: 'Invalid status.' };
    const participant = await prisma.eventParticipant.findUnique({ where: { id: participantId }, include: { event: true } });
    if (!participant) return { success: false as const, error: 'Participant not found.' };
    await assertSameTenant(actor, participant.event.edirId);
    if (participant.event.status === 'COMPLETED') return { success: false as const, error: 'Attendance is locked for a finalized event.' };
    await prisma.eventParticipant.update({ where: { id: participantId }, data: { status } });
    revalidatePath('/dashboard/events');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

// ─── Finalize attendance (applies absence penalties) ─────────────────────────

/**
 * Lock the event (→ COMPLETED) and, when attendance is required, charge the
 * configured absence penalty to every ABSENT participant not already penalized.
 * Each charge increments the member's outstanding balance. Idempotent per
 * participant via the `penalized` flag; the event must still be SCHEDULED.
 */
export async function finalizeAttendance(eventId: string) {
  try {
    const { actor, edirId } = await requireActor('finalize_attendance');
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { participants: { where: { status: 'ABSENT', penalized: false }, include: { member: { select: { id: true, name: true, userId: true } } } } },
    });
    if (!event) return { success: false as const, error: 'Event not found.' };
    await assertSameTenant(actor, event.edirId);
    if (event.status !== 'SCHEDULED') return { success: false as const, error: 'Only a scheduled event can be finalized.' };

    const penalty = Number(event.absencePenalty);
    const shouldPenalize = event.attendanceRequired && penalty > 0 ? event.participants : [];
    const notify: { userId: string; type: 'payment'; title: string; body: string; edirId: string }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const p of shouldPenalize) {
        await tx.paymentStatus.upsert({
          where: { memberId: p.member.id },
          update: { balance: { increment: penalty }, status: 'PENDING' },
          create: { memberId: p.member.id, balance: new Prisma.Decimal(penalty), status: 'PENDING' },
        });
        await tx.eventParticipant.update({ where: { id: p.id }, data: { penalized: true } });
        if (p.member.userId) {
          notify.push({
            userId: p.member.userId, type: 'payment',
            title: 'Absence penalty applied',
            body: `A ${penalty} penalty for missing "${event.title}" was added to your balance.`,
            edirId,
          });
        }
      }
      await tx.event.update({ where: { id: eventId }, data: { status: 'COMPLETED' } });
      await writeAudit({
        edirId, userId: actor.id, action: 'EVENT_FINALIZED', targetType: 'Event', targetId: eventId,
        details: `Finalized "${event.title}". Penalized ${shouldPenalize.length} absentee(s) at ${penalty} each.`,
      }, tx);
    });

    if (notify.length > 0) await createNotifications(notify);

    revalidatePath('/dashboard/events');
    return { success: true as const, penalized: shouldPenalize.length, penalty };
  } catch (error) {
    return failure(error);
  }
}

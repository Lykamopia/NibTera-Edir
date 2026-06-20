'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getActor } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

/** Current user's own profile, plus linked member dues (self-service view). */
export async function getMyAccount() {
  const actor = await getActor();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: {
      role: { select: { name: true } },
      edir: { select: { name: true } },
      member: {
        include: {
          paymentStatus: true,
          relatives: { include: { documents: true } },
        },
      },
    },
  });
  if (!user) return null;

  const m = user.member;
  return {
    id: user.id,
    name: user.name,
    title: user.title,
    email: user.email,
    phone: user.phone,
    roleName: user.role?.name ?? null,
    edirName: user.edir?.name ?? null,
    member: m ? {
      memberId: m.memberId,
      status: m.status,
      balance: Number(m.paymentStatus?.balance ?? 0),
      monthsPaid: m.paymentStatus?.monthsPaid ?? 0,
      totalPaid: Number(m.paymentStatus?.totalPaid ?? 0),
      lastPayment: m.paymentStatus?.lastPayment ?? null,
      currency: 'ETB',
      relatives: m.relatives.map(r => ({
        id: r.id, name: r.name, relationship: r.relationship, phone: r.phone,
        documents: r.documents.map(d => ({ id: d.id, fileName: d.fileName, status: d.status })),
      })),
    } : null,
  };
}

/**
 * Comprehensive self-service portal snapshot for the signed-in member. Scoped to
 * the user's OWN linked member — needs no view_members permission. Returns the
 * full 360: profile, account/membership status, payments, schedule, penalties,
 * benefits, dependents, documents, eligibility, rules, notifications, activity.
 */
export async function getMyPortal() {
  const actor = await getActor();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: {
      role: { select: { name: true } },
      edir: { select: { name: true } },
      member: {
        include: {
          paymentStatus: true,
          relatives: { include: { documents: true }, orderBy: { createdAt: 'asc' } },
          documents: { orderBy: { createdAt: 'desc' } },
          installmentPlans: { include: { installments: { orderBy: { sequence: 'asc' } } } },
          paymentLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
          emergencyClaims: { include: { type: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });
  if (!user) return null;

  const num = (v: any) => (v == null ? 0 : Number(v));
  const m = user.member;

  const account = {
    name: user.name, title: user.title, email: user.email, phone: user.phone,
    roleName: user.role?.name ?? null, edirName: user.edir?.name ?? null,
    status: user.status, firstLoginRequired: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt, passwordChangedAt: user.passwordChangedAt,
    passwordResetCount: user.passwordResetCount,
  };

  const [notifications] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);

  if (!m) {
    return { hasMembership: false as const, account, notifications: notifications.map(serializeNotif), recentActivity: [] };
  }

  const [settings, rules, activity] = await Promise.all([
    prisma.edirSettings.findUnique({ where: { edirId: m.edirId } }),
    prisma.rulesVersion.findFirst({ where: { edirId: m.edirId, status: 'APPROVED' }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true, title: true, effectiveDate: true } }),
    prisma.auditLog.findMany({ where: { edirId: m.edirId, OR: [{ userId: user.id }, { targetId: m.id }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);

  const currency = settings?.currency ?? 'ETB';
  const monthlyFee = num(settings?.monthlyFee);
  const balance = num(m.paymentStatus?.balance);
  const tenureMonths = Math.max(0, Math.floor((Date.now() - new Date(m.joinDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4)));
  const monthsBehind = monthlyFee > 0 ? Math.floor(balance / monthlyFee) : 0;

  const allInstallments = m.installmentPlans.flatMap(p => p.installments.map(i => ({ ...i, planType: p.type })));
  const now = new Date();
  const upcoming = allInstallments
    .filter(i => i.status !== 'PAID')
    .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))
    .map(i => ({ id: i.id, planType: i.planType, sequence: i.sequence, amount: num(i.amount), dueDate: i.dueDate, status: i.status, overdue: new Date(i.dueDate) < now }));

  const successful = m.paymentLogs.filter(l => l.status === 'SUCCESS' || l.status === 'PARTIAL');
  const totalContributions = successful.reduce((s, l) => s + num(l.amount), 0);
  const penaltiesPaid = successful.reduce((s, l) => { try { return s + (Number(JSON.parse(l.description || '{}').latePenalty) || 0); } catch { return s; } }, 0);

  // Next monthly due date from the configured due day.
  const dueDay = settings?.dueDay ?? 1;
  const nextDue = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (nextDue < now) nextDue.setMonth(nextDue.getMonth() + 1);

  return {
    hasMembership: true as const,
    account,
    member: {
      id: m.id, memberId: m.memberId, name: m.name, role: m.role, status: m.status, photoUrl: m.photoUrl,
      occupation: m.occupation, gender: m.gender, dateOfBirth: m.dateOfBirth, nationalId: m.nationalId,
      phone: m.phone, email: m.email, address: m.address, city: m.city, subcity: m.subcity, woreda: m.woreda,
      emergencyContactName: m.emergencyContactName, emergencyContactPhone: m.emergencyContactPhone, joinDate: m.joinDate,
    },
    payments: {
      currency, monthlyFee, balance, totalContributions, penaltiesPaid,
      monthsPaid: m.paymentStatus?.monthsPaid ?? 0, lastPayment: m.paymentStatus?.lastPayment ?? null,
      nextDueDate: nextDue, gracePeriodDays: settings?.gracePeriodDays ?? 0,
      status: m.paymentStatus?.status ?? 'PENDING',
      upcoming,
      history: m.paymentLogs.map(l => ({ id: l.id, amount: num(l.amount), method: l.method, status: l.status, transactionId: l.transactionId, createdAt: l.createdAt, receiptUrl: l.receiptUrl })),
    },
    relatives: m.relatives.map(r => ({
      id: r.id, name: r.name, relationship: r.relationship, phone: r.phone, isBeneficiary: r.isBeneficiary, benefitShare: r.benefitShare,
      documents: r.documents.map(d => ({ id: d.id, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status })),
    })),
    documents: m.documents.map(d => ({ id: d.id, category: d.category, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status, createdAt: d.createdAt })),
    emergencyClaims: m.emergencyClaims.map(c => ({ id: c.id, typeName: c.type?.name ?? null, status: c.status, affectedPerson: c.affectedPerson, approvedAmount: num(c.approvedAmount), disbursedAmount: num(c.disbursedAmount), createdAt: c.createdAt })),
    eligibility: {
      tenureMonths, monthsBehind,
      eligibleForBenefits: tenureMonths >= (settings?.minMembershipMonths ?? 0),
      minMembershipMonths: settings?.minMembershipMonths ?? 0,
      atSuspensionRisk: !!settings && monthsBehind >= settings.autoSuspendMonths,
      atTerminationRisk: !!settings && monthsBehind >= settings.autoTerminateMonths,
      totalBenefitsReceived: m.emergencyClaims.reduce((s, c) => s + num(c.disbursedAmount), 0),
    },
    rules: rules ? { versionNumber: rules.versionNumber, title: rules.title, effectiveDate: rules.effectiveDate } : null,
    notifications: notifications.map(serializeNotif),
    recentActivity: activity.map(a => ({ id: a.id, action: a.action, details: a.details, createdAt: a.createdAt })),
  };
}

function serializeNotif(n: any) {
  return { id: n.id, type: n.type, title: n.title, body: n.body, linkUrl: n.linkUrl, read: n.read, createdAt: n.createdAt };
}

const profileSchema = z.object({
  name: z.string().min(2, 'Name is required.').max(120),
  title: z.string().max(120).optional().nullable(),
});

/** Update the signed-in user's own name/title. */
export async function updateMyProfile(input: z.infer<typeof profileSchema>) {
  try {
    const actor = await getActor();
    const data = profileSchema.parse(input);
    await prisma.user.update({ where: { id: actor.id }, data: { name: data.name, title: data.title || null } });
    await writeAudit({ edirId: actor.edirId, userId: actor.id, action: 'PROFILE_UPDATED', targetType: 'User', targetId: actor.id, details: 'Updated own profile.' });
    revalidatePath('/dashboard/account');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

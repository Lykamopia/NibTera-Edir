'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getActor } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { ensureMembershipForUser } from '@/lib/membership-provisioning';
import { computeContributionArrears, computePenalty, computePayWindow } from '@/lib/data';
import { paymentLogStatusLabel } from '@/lib/payment-log-status';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { pickPrimaryMembership } from '@/lib/membership-policy';
import { zName, zOptionalText } from '@/lib/validation';

function safeMeta(s: string | null): Record<string, any> {
  if (!s) return {};
  try { const v = JSON.parse(s); return typeof v === 'object' && v ? v : {}; } catch { return {}; }
}

/** Current user's own profile, plus linked member dues (self-service view). */
export async function getMyAccount() {
  const actor = await getActor();
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: {
      role: { select: { name: true } },
      edir: { select: { name: true } },
      members: {
        include: {
          paymentStatus: true,
          relatives: { include: { documents: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user) return null;

  // A user may hold memberships in several Edirs (platform membership policy);
  // self-service shows the one for their home Edir.
  const m = pickPrimaryMembership(user.members, user.edirId);
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
  // Every Edir-scoped user (admins, committee, approvers included) is a member
  // for obligations/benefits — provision their membership if missing.
  try { await ensureMembershipForUser(actor.id); } catch { /* non-fatal */ }
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    include: {
      role: { select: { name: true } },
      edir: { select: { name: true } },
      members: {
        include: {
          paymentStatus: true,
          relatives: { include: { documents: true }, orderBy: { createdAt: 'asc' } },
          documents: { orderBy: { createdAt: 'desc' } },
          installmentPlans: { include: { installments: { orderBy: { sequence: 'asc' } } } },
          paymentLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
          emergencyClaims: { include: { type: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user) return null;

  const num = (v: any) => (v == null ? 0 : Number(v));
  // A user may hold memberships in several Edirs (platform membership policy);
  // self-service shows the one for their home Edir.
  const m = pickPrimaryMembership(user.members, user.edirId);

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

  const [settings, edir, rules, activity, myUploads] = await Promise.all([
    prisma.edirSettings.findUnique({ where: { edirId: m.edirId } }),
    prisma.edir.findUnique({ where: { id: m.edirId }, select: { name: true, logoUrl: true, accountNumber: true } }),
    prisma.rulesVersion.findFirst({ where: { edirId: m.edirId, status: 'APPROVED' }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true, title: true, effectiveDate: true } }),
    prisma.auditLog.findMany({ where: { edirId: m.edirId, OR: [{ userId: user.id }, { targetId: m.id }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
    // Documents this member uploaded through self-service requests — mirrored into
    // the DMS and shown back to them here with their live approval status.
    prisma.dmsDocument.findMany({ where: { uploadedById: user.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);

  const currency = settings?.currency ?? 'ETB';
  const monthlyFee = num(settings?.monthlyFee);
  const balance = num(m.paymentStatus?.balance);
  const tenureMonths = Math.max(0, Math.floor((Date.now() - new Date(m.joinDate).getTime()) / (1000 * 60 * 60 * 24 * 30.4)));
  const now = new Date();
  const dueDay = settings?.dueDay ?? 1;
  const monthsPaid = m.paymentStatus?.monthsPaid ?? 0;
  // Months behind is a CONTRIBUTION-ledger concept (months due since join vs
  // months paid) — never balance/monthlyFee, since the pooled balance holds
  // registration fees, penalties, and compensations, not monthly contributions.
  const { monthsBehind, arrears: contributionArrears } = computeContributionArrears({ joinDate: m.joinDate, dueDay, monthsPaid, monthlyFee, now, firstContributionAtJoin: m.firstContributionAtJoin });

  const allInstallments = m.installmentPlans.flatMap(p => p.installments.map(i => ({ ...i, planType: p.type })));
  const upcoming = allInstallments
    .filter(i => i.status !== 'PAID')
    .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))
    .map(i => ({ id: i.id, planType: i.planType, sequence: i.sequence, amount: num(i.amount), dueDate: i.dueDate, status: i.status, overdue: new Date(i.dueDate) < now }));
  const installmentPlans = m.installmentPlans.map(p => ({
    id: p.id, type: p.type, totalAmount: num(p.totalAmount),
    total: p.installments.length,
    paid: p.installments.filter(i => i.status === 'PAID').length,
  }));

  const successful = m.paymentLogs.filter(l => l.status === 'SUCCESS' || l.status === 'PARTIAL');
  const totalContributions = successful.reduce((s, l) => s + num(l.amount), 0);
  const penaltiesPaid = successful.reduce((s, l) => { try { return s + (Number(JSON.parse(l.description || '{}').latePenalty) || 0); } catch { return s; } }, 0);

  // The applicable LIVE late penalty from the Edir's penalty configuration.
  const penalty = computePenalty({
    monthsBehind, arrears: contributionArrears, dueDay,
    gracePeriodDays: settings?.gracePeriodDays ?? 0, currency, tiers: settings?.penaltyTiers, now,
    daily: {
      enabled: !!settings?.dailyPenaltyEnabled,
      type: settings?.dailyPenaltyType === 'PERCENT' ? 'PERCENT' : 'FIXED',
      value: num(settings?.dailyPenaltyValue),
      maxDays: num(settings?.dailyPenaltyMaxDays),
    },
  });

  // Contribution coverage by calendar month (indexed from the join month).
  const joinMonth = new Date(m.joinDate.getFullYear(), m.joinDate.getMonth(), 1);
  const monthFromJoin = (n: number) => new Date(joinMonth.getFullYear(), joinMonth.getMonth() + n, 1);
  const coverage = {
    monthsPaid,
    paidThrough: monthsPaid > 0 ? monthFromJoin(monthsPaid - 1) : null,
    nextDueMonth: monthlyFee > 0 ? monthFromJoin(monthsPaid) : null,
  };

  // Advance-payment window (nextPaymentDelayDays Edir setting).
  const reinstatementFee = (m.status === 'SUSPENDED' || m.status === 'TERMINATED') ? num(settings?.reinstatementFee) : 0;
  const nothingDue = monthsBehind <= 0 && balance <= 0 && !penalty && upcoming.length === 0 && reinstatementFee <= 0;
  const payWindow = computePayWindow({
    delayDays: num(settings?.nextPaymentDelayDays),
    lastPayment: m.paymentStatus?.lastPayment ?? null,
    nothingDue, now,
  });

  // Next monthly due date from the configured due day.
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
    edir: { name: edir?.name ?? user.edir?.name ?? 'Edir', logoUrl: edir?.logoUrl ?? null, accountNumber: edir?.accountNumber ?? null },
    payments: {
      currency, monthlyFee, balance, totalContributions, penaltiesPaid,
      monthsPaid, lastPayment: m.paymentStatus?.lastPayment ?? null,
      nextDueDate: nextDue, gracePeriodDays: settings?.gracePeriodDays ?? 0,
      status: m.paymentStatus?.status ?? 'PENDING',
      // Live obligations breakdown (mirrors the staff Payments matrix).
      monthsBehind,
      contributionArrears,
      penalty, // full PenaltyBreakdown | null
      reinstatementFee,
      totalDue: balance + contributionArrears + (penalty?.amount ?? 0) + reinstatementFee,
      coverage,
      payWindow,
      upcoming,
      installmentPlans,
      // Receipt-grade history rows — every field the formal PaymentReceiptModal
      // needs (mirrors getMemberPaymentHistory, self-scoped so no staff permission).
      history: m.paymentLogs.map(l => {
        const meta = safeMeta(l.description);
        const cov = meta.coverage as { months?: number; from?: string; to?: string } | undefined;
        return {
          id: l.id,
          amount: num(l.amount),
          method: l.method,
          status: l.status,
          displayStatus: paymentLogStatusLabel(l.status),
          verificationType: l.verificationType,
          transactionId: l.transactionId,
          createdAt: l.createdAt,
          receiptUrl: l.receiptUrl,
          description: l.description,
          coverage: cov ? { months: Number(cov.months ?? 0), from: cov.from ?? null, to: cov.to ?? null } : null,
          memberName: m.name,
          memberCode: m.memberId,
          memberStatus: m.status,
          edirName: edir?.name ?? null,
          edirLogoUrl: edir?.logoUrl ?? null,
          edirAccount: (meta.edirAccount as string) ?? edir?.accountNumber ?? null,
          payerName: (meta.payerName as string) ?? null,
          payerAccount: (meta.payerAccount as string) ?? null,
          payerPhone: (meta.payerPhone as string) ?? null,
          bankRef: l.receiptUrl ?? (meta.bankRef as string) ?? null,
          contributionAmount: meta.installment != null ? Number(meta.installment) : null,
          penaltyAmount: meta.latePenalty != null ? Number(meta.latePenalty) : null,
          dueDate: cov?.to ?? null,
        };
      }),
    },
    relatives: m.relatives.map(r => ({
      id: r.id, name: r.name, relationship: r.relationship, phone: r.phone, isBeneficiary: r.isBeneficiary, benefitShare: r.benefitShare,
      documents: r.documents.map(d => ({ id: d.id, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status })),
    })),
    documents: [
      ...m.documents.map(d => ({ id: d.id, category: d.category, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status, createdAt: d.createdAt })),
      ...myUploads.map(d => ({ id: d.id, category: d.category, fileName: d.fileName, fileUrl: d.fileUrl, status: d.status as string, createdAt: d.createdAt })),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    emergencyClaims: m.emergencyClaims.map(c => ({ id: c.id, typeName: c.type?.name ?? null, status: c.status, affectedPerson: c.affectedPerson, approvedAmount: num(c.approvedAmount), disbursedAmount: num(c.disbursedAmount), createdAt: c.createdAt })),
    eligibility: {
      tenureMonths, monthsBehind,
      // Standing gates eligibility: suspended/terminated members are never
      // benefit-eligible, regardless of tenure.
      eligibleForBenefits: m.status === 'ACTIVE' && tenureMonths >= (settings?.minMembershipMonths ?? 0),
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
  name: zName(),
  title: zOptionalText('Title', { max: 120 }),
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

import { Permission } from '@/lib/types';
import { format, formatDistanceToNow } from 'date-fns';
import prisma from '@/lib/prisma';
import { normalizeEthiopianPhone } from '@/lib/utils';

export interface PenaltyBreakdown {
  amount: number;
  reason: string;
  rule: string;            // which tier/rule triggered it
  type: 'FIXED' | 'PERCENT';
  value: number;           // the configured tier value (ETB or %)
  overdueDays: number;
  gracePeriodDays: number;
  monthsBehind: number;
  calculation: string;     // human-readable explanation
}

export interface DetailedMember {
  id: string;
  edirId: string;
  edirName: string;
  edirLogoUrl: string | null;
  memberId: string;
  name: string;
  role: string;
  phone: string | null;
  status: string;
  contributionStatus: string;
  totalOutstanding: number;
  monthlyFee: number;
  monthsBehind: number;
  penaltiesPaid: number;
  totalPaid: number;
  nextDueDate: Date | null;
  gracePeriodDays: number;
  joinDate: Date;
  currency: string;
  penalty: PenaltyBreakdown | null;
  installmentSummary: {
    type: string; total: number; paid: number; remaining: number;
    nextDueDate: Date | null; nextAmount: number; outstanding: number;
  } | null;
  eventPenalties: { id: string; event: string; amount: number; date: Date | null }[];
  assetPenalties: { id: string; asset: string; amount: number; date: Date | null; status: string }[];
  reinstatementFee: number;
  dueInstallments: { id: string; amount: number; dueDate: Date; overdue: boolean }[];
  monthsPaid: number;
  // Contribution coverage in calendar months (indexed from the member's join month).
  contributionCoverage: { monthsPaid: number; paidThrough: Date | null; nextDue: Date | null };
  paymentHistory: {
    transactionId: string; amount: number; status: string; method: string; receiptUrl: string | null; createdAt: Date;
    coverage: { months: number; from: string; to: string } | null;
  }[];
}

/**
 * Resolve a member by phone with the figures the public payment flow needs:
 * outstanding balance, monthly fee, penalties, contribution status, due dates,
 * and recent payment history. Returns null when no member matches.
 */
export async function fetchDetailedMemberByPhone(phone: string): Promise<DetailedMember | null> {
  const normalized = normalizeEthiopianPhone(phone);
  const member = await prisma.member.findFirst({
    where: { phone: normalized },
    include: {
      paymentStatus: true,
      edir: { select: { name: true, logoUrl: true, settings: true } },
      installmentPlans: { include: { installments: { orderBy: { sequence: 'asc' } } } },
      paymentLogs: { orderBy: { createdAt: 'desc' }, take: 25 },
      eventParticipations: { where: { penalized: true }, include: { event: { select: { title: true, datetime: true, absencePenalty: true } } } },
      assetIssuances: { where: { compensation: { gt: 0 } }, include: { asset: { select: { name: true } } } },
    },
  });
  if (!member) return null;

  const settings = member.edir?.settings;
  const now = new Date();
  const monthlyFee = Number(settings?.monthlyFee ?? 0);
  const balance = Number(member.paymentStatus?.balance ?? 0);
  const currency = settings?.currency ?? 'ETB';
  const gracePeriodDays = settings?.gracePeriodDays ?? 0;
  const monthsBehind = monthlyFee > 0 ? Math.floor(balance / monthlyFee) : 0;

  // ── Installments: full summary across all plans ──────────────────────────────
  const allInstallments = member.installmentPlans.flatMap(p => p.installments.map(i => ({ ...i, planType: p.type })));
  const pendingInstallments = allInstallments.filter(i => i.status !== 'PAID').sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));
  const dueInstallments = pendingInstallments.map(i => ({ id: i.id, amount: Number(i.amount), dueDate: i.dueDate, overdue: new Date(i.dueDate) < now }));
  const installmentSummary = allInstallments.length > 0 ? {
    type: member.installmentPlans.map(p => p.type).join(', ') || 'Installment',
    total: allInstallments.length,
    paid: allInstallments.filter(i => i.status === 'PAID').length,
    remaining: pendingInstallments.length,
    nextDueDate: pendingInstallments[0]?.dueDate ?? null,
    nextAmount: pendingInstallments[0] ? Number(pendingInstallments[0].amount) : 0,
    outstanding: pendingInstallments.reduce((s, i) => s + Number(i.amount), 0),
  } : null;

  // ── Other obligations folded into / alongside the balance ────────────────────
  const eventPenalties = member.eventParticipations.map(p => ({
    id: p.id, event: p.event?.title ?? 'Event', amount: Number(p.event?.absencePenalty ?? 0), date: p.event?.datetime ?? null,
  })).filter(e => e.amount > 0);
  const assetPenalties = member.assetIssuances.map(i => ({
    id: i.id, asset: i.asset?.name ?? 'Asset', amount: Number(i.compensation ?? 0), date: i.updatedAt, status: i.status,
  })).filter(a => a.amount > 0);
  const reinstatementFee = (member.status === 'SUSPENDED' || member.status === 'TERMINATED') ? Number(settings?.reinstatementFee ?? 0) : 0;

  const penaltiesPaid = member.paymentLogs
    .filter(l => l.status === 'SUCCESS' || l.status === 'PARTIAL')
    .reduce((s, l) => { try { return s + (Number(JSON.parse(l.description || '{}').latePenalty) || 0); } catch { return s; } }, 0);

  const dueDay = settings?.dueDay ?? 1;
  const nextDue = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (nextDue < now) nextDue.setMonth(nextDue.getMonth() + 1);

  // ── Contribution coverage by calendar month (indexed from the join month) ─────
  const monthsPaid = member.paymentStatus?.monthsPaid ?? 0;
  const joinMonth = new Date(member.joinDate.getFullYear(), member.joinDate.getMonth(), 1);
  const monthFromJoin = (n: number) => new Date(joinMonth.getFullYear(), joinMonth.getMonth() + n, 1);
  const contributionCoverage = {
    monthsPaid,
    paidThrough: monthsPaid > 0 ? monthFromJoin(monthsPaid - 1) : null,
    nextDue: monthlyFee > 0 ? monthFromJoin(monthsPaid) : null,
  };

  // ── Compute the applicable late-payment penalty from the Edir's penalty tiers ─
  const penalty = computePenalty({ monthsBehind, balance, dueDay, gracePeriodDays, currency, tiers: settings?.penaltyTiers, now });

  return {
    id: member.id,
    edirId: member.edirId,
    edirName: member.edir?.name ?? 'Edir',
    edirLogoUrl: member.edir?.logoUrl ?? null,
    memberId: member.memberId,
    name: member.name,
    role: member.role,
    phone: member.phone,
    status: member.status,
    contributionStatus: member.paymentStatus?.status ?? 'PENDING',
    totalOutstanding: balance,
    monthlyFee,
    monthsBehind,
    penaltiesPaid,
    totalPaid: Number(member.paymentStatus?.totalPaid ?? 0),
    nextDueDate: nextDue,
    gracePeriodDays,
    joinDate: member.joinDate,
    currency,
    penalty,
    installmentSummary,
    eventPenalties,
    assetPenalties,
    reinstatementFee,
    dueInstallments,
    monthsPaid,
    contributionCoverage,
    paymentHistory: member.paymentLogs.map(l => {
      let coverage: { months: number; from: string; to: string } | null = null;
      try { coverage = JSON.parse(l.description || '{}')?.coverage ?? null; } catch { coverage = null; }
      return {
        transactionId: l.transactionId, amount: Number(l.amount), status: l.status.toLowerCase(), method: l.method, receiptUrl: l.receiptUrl ?? null, createdAt: l.createdAt, coverage,
      };
    }),
  };
}

/** Resolve the applicable late-payment penalty tier and explain the calculation. */
function computePenalty(opts: { monthsBehind: number; balance: number; dueDay: number; gracePeriodDays: number; currency: string; tiers: unknown; now: Date }): PenaltyBreakdown | null {
  const { monthsBehind, balance, dueDay, gracePeriodDays, currency, tiers, now } = opts;
  if (monthsBehind <= 0 || balance <= 0) return null;
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  // Days overdue since the most recent unpaid due date, beyond the grace window.
  const cycleDue = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const ref = now >= cycleDue ? cycleDue : new Date(now.getFullYear(), now.getMonth() - 1, dueDay);
  const baseDays = Math.floor((now.getTime() - ref.getTime()) / 86400000);
  const overdueDays = Math.max(0, baseDays - gracePeriodDays) + Math.max(0, monthsBehind - 1) * 30;
  if (overdueDays <= 0) return null;

  const tier = (tiers as any[]).find(t => {
    const from = Number(t.fromDays ?? 0);
    const to = t.toDays == null ? Infinity : Number(t.toDays);
    return overdueDays >= from && overdueDays <= to;
  });
  if (!tier) return null;

  const type: 'FIXED' | 'PERCENT' = tier.type === 'PERCENT' ? 'PERCENT' : 'FIXED';
  const value = Number(tier.value ?? 0);
  const amount = type === 'FIXED' ? value : Math.round((balance * value) / 100);
  const rule = tier.label || `${tier.fromDays}${tier.toDays == null ? '+' : `–${tier.toDays}`} days late`;
  const calculation = type === 'FIXED'
    ? `Fixed charge of ${value.toLocaleString()} ${currency} for the "${rule}" tier.`
    : `${value}% of ${balance.toLocaleString()} ${currency} outstanding = ${amount.toLocaleString()} ${currency}.`;

  return {
    amount, reason: 'Late contribution payment', rule, type, value,
    overdueDays, gracePeriodDays, monthsBehind, calculation,
  };
}

export const permissions: { id: Permission, label: string, description: string }[] = [
    { id: 'view_dashboard', label: 'View Dashboard', description: 'Can access the main dashboard.' },
    { id: 'manage_general_settings', label: 'Manage General Settings', description: 'Can manage general application settings' },
    { id: 'manage_email_settings', label: 'Manage Email Settings', description: 'Can manage email notification settings' },
    { id: 'manage_divisions', label: 'Manage Divisions', description: 'Can create, edit, and delete divisions' },
    { id: 'manage_departments', label: 'Manage Departments', description: 'Can create, edit, and delete departments' },
    { id: 'manage_branches', label: 'Manage Branches', description: 'Can create, edit, and delete branches' },
    { id: 'manage_districts', label: 'Manage Districts', description: 'Can create, edit, and delete districts' },
    { id: 'manage_offices', label: 'Manage Offices', description: 'Can create, edit, and delete offices' },
    { id: 'manage_users', label: 'Manage Users', description: 'Can create, edit, and delete users' },
    { id: 'manage_roles', label: 'Manage Roles', description: 'Can create, edit, and manage roles and permissions' },
];

export const formatTimestamp = (timestamp: string | Date, relative: boolean = true) => {
  if (!timestamp) return '';
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    if (isNaN(date.getTime())) {
      return '';
    }
    const formattedDate = format(date, "MMMM d, yyyy 'at' h:mm a");
    if (!relative) return formattedDate;
    
    const relativeDate = formatDistanceToNow(date, { addSuffix: true });
    return `${formattedDate} (${relativeDate})`;
  } catch (e) {
    return '';
  }
};

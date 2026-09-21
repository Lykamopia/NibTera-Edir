import { format, formatDistanceToNow } from 'date-fns';
import prisma from '@/lib/prisma';
import { normalizeEthiopianPhone } from '@/lib/utils';
import { Prisma } from '@prisma/client';
import { extractBankReference } from '@/lib/nib-receipt';

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
  // Optional daily accrual portion folded into `amount`.
  dailyAccrual?: { days: number; perDay: number; type: 'FIXED' | 'PERCENT'; amount: number } | null;
}

export interface DetailedMember {
  id: string;
  edirId: string;
  edirName: string;
  edirLogoUrl: string | null;
  /** True only when the member's Edir is ACTIVE with a configured payment account. */
  canAcceptPayments: boolean;
  /** Why payments are blocked (null when canAcceptPayments is true). */
  paymentAccountReason: string | null;
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
  /** Canonical itemized dues — the suggested total covers ALL obligations. */
  dues: MemberDues;
  // Contribution coverage in calendar months (indexed from the member's join month).
  contributionCoverage: { monthsPaid: number; paidThrough: Date | null; nextDue: Date | null };
  /**
   * Advance-payment window (Edir setting `nextPaymentDelayDays`): once a member is
   * fully settled, the NEXT month's contribution only becomes payable this many
   * days after their last settling payment. While `blocked` is true the pay UI
   * shows the settled state with no pay option; `availableAt` is when it reopens.
   */
  payWindow: { blocked: boolean; availableAt: Date | null; delayDays: number; lastPayment: Date | null };
  paymentHistory: {
    transactionId: string; amount: number; status: string; method: string; receiptUrl: string | null; createdAt: Date;
    coverage: { months: number; from: string; to: string } | null;
    /** Bank FT reference — present when the payment settled through the bank
     *  (drives the official bank-receipt action). */
    bankRef: string | null;
  }[];
}

const detailedMemberInclude = Prisma.validator<Prisma.MemberInclude>()({
  paymentStatus: true,
  edir: { select: { name: true, logoUrl: true, settings: true, status: true, accountNumber: true } },
  installmentPlans: { include: { installments: { orderBy: { sequence: 'asc' } } } },
  paymentLogs: { orderBy: { createdAt: 'desc' }, take: 25 },
  eventParticipations: { where: { penalized: true }, include: { event: { select: { title: true, datetime: true, absencePenalty: true } } } },
  assetIssuances: { where: { compensation: { gt: 0 } }, include: { asset: { select: { name: true } } } },
});

type DetailedMemberRow = Prisma.MemberGetPayload<{ include: typeof detailedMemberInclude }>;

/** Compute the payment-flow figures for an already-loaded member row. */
function buildDetailedMember(member: DetailedMemberRow): DetailedMember {
  const settings = member.edir?.settings;
  const now = new Date();
  // Per-tenant payment availability — mirrors resolveEdirPaymentAccount so the UI
  // can warn/disable before the server-side gate in getPaymentToken rejects.
  const edirStatus = member.edir?.status;
  const edirAccount = (member.edir?.accountNumber || '').trim();
  const canAcceptPayments = edirStatus === 'ACTIVE' && !!edirAccount && edirAccount !== 'YOUR_ACCOUNT_NO';
  const paymentAccountReason = canAcceptPayments
    ? null
    : edirStatus !== 'ACTIVE'
      ? `This Edir is ${String(edirStatus ?? 'inactive').toLowerCase()} and cannot accept payments.`
      : 'This Edir has not configured a payment account yet.';
  const monthlyFee = Number(settings?.monthlyFee ?? 0);
  const balance = Number(member.paymentStatus?.balance ?? 0);
  const currency = settings?.currency ?? 'ETB';
  const gracePeriodDays = settings?.gracePeriodDays ?? 0;
  const dueDay = settings?.dueDay ?? 1;
  const monthsPaid = member.paymentStatus?.monthsPaid ?? 0;
  // "Months behind" is a CONTRIBUTION concept: derive it from the contribution
  // ledger (months due since join vs months paid), NOT from paymentStatus.balance —
  // that balance holds registration fees, absence penalties and asset compensation,
  // never monthly contributions, so balance/monthlyFee is not months-behind.
  const { monthsBehind, arrears: contributionArrears } = computeContributionArrears({ joinDate: member.joinDate, dueDay, monthsPaid, monthlyFee, now, firstContributionAtJoin: member.firstContributionAtJoin });

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

  const nextDue = new Date(now.getFullYear(), now.getMonth(), dueDay);
  if (nextDue < now) nextDue.setMonth(nextDue.getMonth() + 1);

  // ── Contribution coverage by calendar month (indexed from the join month) ─────
  const joinMonth = new Date(member.joinDate.getFullYear(), member.joinDate.getMonth(), 1);
  const monthFromJoin = (n: number) => new Date(joinMonth.getFullYear(), joinMonth.getMonth() + n, 1);
  const contributionCoverage = {
    monthsPaid,
    paidThrough: monthsPaid > 0 ? monthFromJoin(monthsPaid - 1) : null,
    nextDue: monthlyFee > 0 ? monthFromJoin(monthsPaid) : null,
  };

  // ── Compute the applicable late-payment penalty from the Edir's penalty tiers ─
  const penalty = computePenalty({
    monthsBehind, arrears: contributionArrears, dueDay, gracePeriodDays, currency, tiers: settings?.penaltyTiers, now,
    daily: {
      enabled: !!settings?.dailyPenaltyEnabled,
      type: settings?.dailyPenaltyType === 'PERCENT' ? 'PERCENT' : 'FIXED',
      value: Number(settings?.dailyPenaltyValue ?? 0),
      maxDays: Number(settings?.dailyPenaltyMaxDays ?? 0),
    },
  });

  // ── Canonical dues — ALL obligations summed into one suggested total ─────────
  const dues = computeMemberDues({
    status: member.status,
    joinDate: member.joinDate,
    balance,
    monthsPaid,
    settings,
    nextInstallmentDue: pendingInstallments[0] ? Number(pendingInstallments[0].amount) : 0,
    firstContributionAtJoin: member.firstContributionAtJoin,
    now,
  });

  // ── Advance-payment window (nextPaymentDelayDays) ────────────────────────────
  // Only gates a member with NOTHING due: contributions covered, zero balance, no
  // pending installments, no penalty, no reinstatement fee. Anyone who still owes
  // something can always pay.
  const nothingDue = monthsBehind <= 0 && balance <= 0 && !penalty
    && pendingInstallments.length === 0 && reinstatementFee <= 0;
  const payWindow = computePayWindow({
    delayDays: Number(settings?.nextPaymentDelayDays ?? 0),
    lastPayment: member.paymentStatus?.lastPayment ?? null,
    nothingDue,
    now,
  });

  return {
    id: member.id,
    edirId: member.edirId,
    edirName: member.edir?.name ?? 'Edir',
    edirLogoUrl: member.edir?.logoUrl ?? null,
    canAcceptPayments,
    paymentAccountReason,
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
    dues,
    contributionCoverage,
    payWindow,
    paymentHistory: member.paymentLogs.map(l => {
      let coverage: { months: number; from: string; to: string } | null = null;
      try { coverage = JSON.parse(l.description || '{}')?.coverage ?? null; } catch { coverage = null; }
      return {
        transactionId: l.transactionId, amount: Number(l.amount), status: l.status.toLowerCase(), method: l.method, receiptUrl: l.receiptUrl ?? null, createdAt: l.createdAt, coverage,
        bankRef: extractBankReference(l),
      };
    }),
  };
}

/**
 * Every membership registered against a phone number, each with the figures the
 * public payment flow needs: outstanding balance, monthly fee, penalties,
 * contribution status, due dates and recent payment history.
 *
 * Returns more than one entry only when the platform membership policy allows a
 * person to belong to several Edirs (see lib/membership-policy.ts) — the mini-app
 * then asks the payer which Edir they are paying. Ordered oldest membership first
 * so a single-membership payer always sees the same record as before.
 */
export async function fetchDetailedMembersByPhone(phone: string): Promise<DetailedMember[]> {
  const normalized = normalizeEthiopianPhone(phone);
  const rows = await prisma.member.findMany({
    where: { phone: normalized },
    include: detailedMemberInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(buildDetailedMember);
}

/**
 * Resolve ONE membership for a phone number. Pass `edirId` to select a specific
 * Edir's membership; without it the oldest membership wins, which is what every
 * single-membership caller expects.
 *
 * Callers that settle money must pass `edirId` (or use the PaymentIntent's bound
 * member) — picking implicitly is only safe for display and legacy self-heal.
 */
export async function fetchDetailedMemberByPhone(
  phone: string,
  opts: { edirId?: string | null } = {},
): Promise<DetailedMember | null> {
  const all = await fetchDetailedMembersByPhone(phone);
  if (opts.edirId) return all.find(m => m.edirId === opts.edirId) ?? null;
  return all[0] ?? null;
}

/**
 * Advance-payment window from the `nextPaymentDelayDays` Edir setting: after a
 * settling payment, a fully-settled member may only pay the NEXT month once the
 * configured number of days has passed. Pure helper shared by the pay page's
 * member payload and the server-side gate in getPaymentToken.
 */
export function computePayWindow(opts: { delayDays: number; lastPayment: Date | null; nothingDue: boolean; now?: Date }): {
  blocked: boolean; availableAt: Date | null; delayDays: number; lastPayment: Date | null;
} {
  const now = opts.now ?? new Date();
  const delayDays = Math.max(0, Math.floor(Number(opts.delayDays) || 0));
  const base = { blocked: false, availableAt: null, delayDays, lastPayment: opts.lastPayment };
  if (delayDays <= 0 || !opts.lastPayment || !opts.nothingDue) return base;
  const availableAt = new Date(opts.lastPayment);
  availableAt.setDate(availableAt.getDate() + delayDays);
  if (now >= availableAt) return base;
  return { blocked: true, availableAt, delayDays, lastPayment: opts.lastPayment };
}

/**
 * Lean server-side check of the advance-payment window for one member — used by
 * the payment-initiation gate (getPaymentToken) so a crafted request cannot pay
 * ahead of the window even if the UI is bypassed.
 */
export async function computeMemberPayWindow(memberId: string, now = new Date()): Promise<{ blocked: boolean; availableAt: Date | null; delayDays: number }> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: {
      paymentStatus: true,
      edir: { select: { settings: true } },
      installmentPlans: { select: { installments: { where: { status: 'PENDING' }, select: { id: true }, take: 1 } } },
    },
  });
  if (!member) return { blocked: false, availableAt: null, delayDays: 0 };
  const settings = member.edir?.settings;
  const delayDays = Number(settings?.nextPaymentDelayDays ?? 0);
  const lastPayment = member.paymentStatus?.lastPayment ?? null;
  if (delayDays <= 0 || !lastPayment) return { blocked: false, availableAt: null, delayDays };

  const balance = Number(member.paymentStatus?.balance ?? 0);
  const { monthsBehind } = computeContributionArrears({
    joinDate: member.joinDate,
    dueDay: settings?.dueDay ?? 1,
    monthsPaid: member.paymentStatus?.monthsPaid ?? 0,
    monthlyFee: Number(settings?.monthlyFee ?? 0),
    firstContributionAtJoin: member.firstContributionAtJoin,
    now,
  });
  const hasPendingInstallment = member.installmentPlans.some(p => p.installments.length > 0);
  const reinstatementFee = (member.status === 'SUSPENDED' || member.status === 'TERMINATED') ? Number(settings?.reinstatementFee ?? 0) : 0;
  // A penalty only exists when monthsBehind > 0, so it is covered by that check.
  const nothingDue = monthsBehind <= 0 && balance <= 0 && !hasPendingInstallment && reinstatementFee <= 0;
  const w = computePayWindow({ delayDays, lastPayment, nothingDue, now });
  return { blocked: w.blocked, availableAt: w.availableAt, delayDays: w.delayDays };
}

/**
 * Contribution arrears derived from the contribution ledger — the authoritative
 * source of "how far behind on monthly contributions" a member is. Uses the count
 * of contribution cycles that have come due since the member joined versus the
 * months already paid (`monthsPaid`). Deliberately independent of
 * paymentStatus.balance, which mixes registration fees, absence penalties and
 * asset compensation and therefore cannot represent contribution arrears.
 */
export function computeContributionArrears(opts: { joinDate: Date; dueDay: number; monthsPaid: number; monthlyFee: number; now?: Date; firstContributionAtJoin?: boolean }): { monthsBehind: number; arrears: number } {
  const { joinDate, monthsPaid, monthlyFee } = opts;
  const now = opts.now ?? new Date();
  if (monthlyFee <= 0) return { monthsBehind: 0, arrears: 0 };
  const dueDay = Math.min(Math.max(1, Number(opts.dueDay) || 1), 28);
  const join = new Date(joinDate);

  // First contribution due date = the first `dueDay` on/after the join date
  // (if the due day already passed in the join month, it rolls to the next month).
  const firstDue = new Date(join.getFullYear(), join.getMonth(), dueDay);
  if (firstDue < join) firstDue.setMonth(firstDue.getMonth() + 1);

  // Number of monthly due dates that have occurred from firstDue through now.
  let dueMonths = 0;
  if (now >= firstDue) {
    const monthsBetween = (now.getFullYear() - firstDue.getFullYear()) * 12 + (now.getMonth() - firstDue.getMonth());
    dueMonths = monthsBetween + (now.getDate() >= dueDay ? 1 : 0);
  }

  // Policy (new members): the first month's contribution is owed immediately at
  // registration, collected with the registration fee — so count one extra due
  // month from day one. Existing members (flag false) keep the legacy schedule.
  if (opts.firstContributionAtJoin) dueMonths += 1;

  const monthsBehind = Math.max(0, dueMonths - Math.max(0, monthsPaid));
  return { monthsBehind, arrears: monthsBehind * monthlyFee };
}

/** Resolve the applicable late-payment penalty tier and explain the calculation. */
interface DailyPenaltyConfig { enabled: boolean; type: 'FIXED' | 'PERCENT'; value: number; maxDays: number }

export function computePenalty(opts: { monthsBehind: number; arrears: number; dueDay: number; gracePeriodDays: number; currency: string; tiers: unknown; now: Date; daily?: DailyPenaltyConfig }): PenaltyBreakdown | null {
  const { monthsBehind, arrears, dueDay, gracePeriodDays, currency, tiers, now, daily } = opts;
  // No contribution arrears → no late-contribution penalty. `arrears` is the
  // overdue contribution amount (monthsBehind × monthlyFee), the correct base for
  // percentage penalties — never the pooled balance.
  if (monthsBehind <= 0 || arrears <= 0) return null;

  // Days overdue since the most recent unpaid due date, beyond the grace window.
  const cycleDue = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const ref = now >= cycleDue ? cycleDue : new Date(now.getFullYear(), now.getMonth() - 1, dueDay);
  const baseDays = Math.floor((now.getTime() - ref.getTime()) / 86400000);
  const overdueDays = Math.max(0, baseDays - gracePeriodDays) + Math.max(0, monthsBehind - 1) * 30;
  if (overdueDays <= 0) return null;

  // ── Tier penalty (optional) ──────────────────────────────────────────────
  // Sort by fromDays so selection is deterministic regardless of stored order.
  const sortedTiers = Array.isArray(tiers)
    ? [...(tiers as any[])].sort((a, b) => Number(a.fromDays ?? 0) - Number(b.fromDays ?? 0))
    : [];
  const tier = sortedTiers.find(t => {
    const from = Number(t.fromDays ?? 0);
    const to = t.toDays == null ? Infinity : Number(t.toDays);
    return overdueDays >= from && overdueDays <= to;
  });

  let tierAmount = 0;
  let type: 'FIXED' | 'PERCENT' = 'FIXED';
  let value = 0;
  let rule = '';
  let calculation = '';
  if (tier) {
    type = tier.type === 'PERCENT' ? 'PERCENT' : 'FIXED';
    value = Number(tier.value ?? 0);
    tierAmount = type === 'FIXED' ? value : Math.round((arrears * value) / 100);
    rule = tier.label || `${tier.fromDays}${tier.toDays == null ? '+' : `–${tier.toDays}`} days late`;
    calculation = type === 'FIXED'
      ? `Fixed charge of ${value.toLocaleString()} ${currency} for the "${rule}" tier.`
      : `${value}% of ${arrears.toLocaleString()} ${currency} overdue contributions = ${tierAmount.toLocaleString()} ${currency}.`;
  }

  // ── Daily accrual (optional) ─────────────────────────────────────────────
  let dailyAccrual: PenaltyBreakdown['dailyAccrual'] = null;
  if (daily?.enabled && daily.value > 0) {
    const days = daily.maxDays > 0 ? Math.min(overdueDays, daily.maxDays) : overdueDays;
    const perDay = daily.type === 'FIXED' ? daily.value : Math.round((arrears * daily.value) / 100);
    const dailyAmount = perDay * days;
    if (dailyAmount > 0) {
      dailyAccrual = { days, perDay, type: daily.type, amount: dailyAmount };
      const dailyExpl = daily.type === 'FIXED'
        ? `${daily.value.toLocaleString()} ${currency}/day × ${days} day(s) = ${dailyAmount.toLocaleString()} ${currency}`
        : `${daily.value}%/day of ${arrears.toLocaleString()} ${currency} × ${days} day(s) = ${dailyAmount.toLocaleString()} ${currency}`;
      calculation = calculation ? `${calculation} Plus daily accrual: ${dailyExpl}.` : `Daily accrual: ${dailyExpl}.`;
      if (!rule) rule = `Daily accrual (${days} day${days === 1 ? '' : 's'} past grace)`;
    }
  }

  const amount = tierAmount + (dailyAccrual?.amount ?? 0);
  if (amount <= 0) return null;

  return {
    amount, reason: 'Late contribution payment', rule, type, value,
    overdueDays, gracePeriodDays, monthsBehind, calculation, dailyAccrual,
  };
}

/**
 * Canonical, itemized "what this member owes right now" — the single source of
 * truth for the suggested payment total, shared by the public pay page
 * (fetchDetailedMemberByPhone) and the staff record-payment dialog
 * (getMemberOutstanding) so both always agree. Everything a member could owe is
 * summed here:
 *   • contribution arrears  — every unpaid monthly contribution (monthsBehind × fee)
 *   • late penalty          — tier + daily accrual on the overdue contributions
 *   • reinstatement fee     — only when SUSPENDED or TERMINATED
 *   • other charges         — the pooled balance: unpaid registration fee (incl.
 *                             its installments), event-absence penalties, and
 *                             asset-compensation charges
 * total = contributionArrears + latePenalty + reinstatementFee + otherCharges.
 */
export interface MemberDues {
  currency: string;
  monthlyFee: number;
  monthsBehind: number;
  contributionArrears: number;
  latePenalty: number;
  penalty: PenaltyBreakdown | null;
  reinstatementFee: number;
  otherCharges: number;        // = paymentStatus.balance (registration + event/asset)
  registrationInstallmentDue: number; // due registration installment (subset of otherCharges)
  total: number;
  /** Line breakdown for recordManualPayment / settlement; sums to `total`. */
  breakdown: { installment: number; arrears: number; latePenalty: number; interest: number; serviceFees: number; other: number };
}

export function computeMemberDues(input: {
  status: string;
  joinDate: Date;
  balance: number;
  monthsPaid: number;
  settings: {
    monthlyFee?: unknown; currency?: string | null; dueDay?: number | null; gracePeriodDays?: number | null;
    reinstatementFee?: unknown; penaltyTiers?: unknown;
    dailyPenaltyEnabled?: boolean | null; dailyPenaltyType?: string | null; dailyPenaltyValue?: unknown; dailyPenaltyMaxDays?: unknown;
  } | null | undefined;
  nextInstallmentDue?: number; // amount of the next PENDING installment, if any
  firstContributionAtJoin?: boolean; // first month owed at registration (new-member policy)
  now?: Date;
}): MemberDues {
  const now = input.now ?? new Date();
  const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
  const s = input.settings ?? {};
  const monthlyFee = num(s.monthlyFee);
  const currency = s.currency ?? 'ETB';
  const dueDay = s.dueDay ?? 1;
  const gracePeriodDays = s.gracePeriodDays ?? 0;
  const balance = Math.max(0, num(input.balance));

  const { monthsBehind, arrears: contributionArrears } = computeContributionArrears({
    joinDate: input.joinDate, dueDay, monthsPaid: input.monthsPaid, monthlyFee, now,
    firstContributionAtJoin: input.firstContributionAtJoin,
  });

  const penalty = computePenalty({
    monthsBehind, arrears: contributionArrears, dueDay, gracePeriodDays, currency,
    tiers: s.penaltyTiers, now,
    daily: {
      enabled: !!s.dailyPenaltyEnabled,
      type: s.dailyPenaltyType === 'PERCENT' ? 'PERCENT' : 'FIXED',
      value: num(s.dailyPenaltyValue),
      maxDays: num(s.dailyPenaltyMaxDays),
    },
  });
  const latePenalty = penalty?.amount ?? 0;

  const reinstatementFee = (input.status === 'SUSPENDED' || input.status === 'TERMINATED') ? num(s.reinstatementFee) : 0;

  const total = contributionArrears + latePenalty + reinstatementFee + balance;

  // Line breakdown for the record dialog / settlement (sums to total):
  //  • installment — a due registration installment (part of the pooled balance)
  //  • arrears     — the monthly contributions owed
  //  • other       — the rest of the pooled balance PLUS the reinstatement fee
  const installmentLine = input.nextInstallmentDue && balance >= input.nextInstallmentDue ? input.nextInstallmentDue : 0;
  const other = Math.max(0, balance - installmentLine) + reinstatementFee;

  return {
    currency, monthlyFee, monthsBehind,
    contributionArrears, latePenalty, penalty, reinstatementFee,
    otherCharges: balance, registrationInstallmentDue: installmentLine, total,
    breakdown: { installment: installmentLine, arrears: contributionArrears, latePenalty, interest: 0, serviceFees: 0, other },
  };
}

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

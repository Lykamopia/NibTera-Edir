import { Prisma } from '@prisma/client';

/** Default member roles applied when an Edir hasn't customized its role list. */
export const DEFAULT_MEMBER_ROLES = ['Member', 'Chairperson', 'Vice Chairperson', 'Secretary', 'Treasurer', 'Auditor', 'Committee Member'];

/**
 * JSON-safe shape of an Edir settings payload (plain numbers/strings/bools/arrays)
 * — what gets stored in a RULE_CHANGE approval payload. Kept free of Prisma.Decimal
 * so it round-trips cleanly through the approval request's JSON column.
 */
export interface EdirSettingsData {
  monthlyFee: number; registrationFee: number; currency: string; dueDay: number; gracePeriodDays: number;
  nextPaymentDelayDays: number;
  penaltyTiers: unknown[]; dailyPenaltyEnabled: boolean; dailyPenaltyType: string; dailyPenaltyValue: number; dailyPenaltyMaxDays: number;
  autoSuspendMonths: number; autoTerminateMonths: number; minMembershipMonths: number; reinstatementFee: number;
  autoSuspendEnabled: boolean; autoTerminateEnabled: boolean; autoReminderEnabled: boolean;
  reminderDaysBefore: number[]; memberRoles: string[];
}

/**
 * Build the Prisma update/create object for EdirSettings from a plain settings
 * payload. Single source of truth for applying settings — used both by the direct
 * save (head office / super admin) and by the RULE_CHANGE approval executor, so an
 * approved change applies exactly what was reviewed.
 */
export function buildEdirSettingsUpdate(data: EdirSettingsData) {
  return {
    monthlyFee: new Prisma.Decimal(data.monthlyFee),
    registrationFee: new Prisma.Decimal(data.registrationFee),
    currency: data.currency,
    dueDay: data.dueDay,
    gracePeriodDays: data.gracePeriodDays,
    nextPaymentDelayDays: data.nextPaymentDelayDays ?? 0,
    penaltyTiers: data.penaltyTiers as unknown as Prisma.InputJsonValue,
    dailyPenaltyEnabled: data.dailyPenaltyEnabled,
    dailyPenaltyType: data.dailyPenaltyType,
    dailyPenaltyValue: new Prisma.Decimal(data.dailyPenaltyValue),
    dailyPenaltyMaxDays: data.dailyPenaltyMaxDays,
    autoSuspendMonths: data.autoSuspendMonths,
    autoTerminateMonths: data.autoTerminateMonths,
    minMembershipMonths: data.minMembershipMonths,
    reinstatementFee: new Prisma.Decimal(data.reinstatementFee),
    autoSuspendEnabled: data.autoSuspendEnabled,
    autoTerminateEnabled: data.autoTerminateEnabled,
    autoReminderEnabled: data.autoReminderEnabled,
    reminderDaysBefore: data.reminderDaysBefore as unknown as Prisma.InputJsonValue,
    memberRoles: (data.memberRoles.length ? data.memberRoles : DEFAULT_MEMBER_ROLES) as unknown as Prisma.InputJsonValue,
  };
}

'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, resolveEdirId } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';

// ─── Penalty tiers ───────────────────────────────────────────────────────────

const tierSchema = z.object({
  id: z.string(),
  label: z.string().optional().nullable(),
  fromDays: z.coerce.number().int().min(0),
  // `.nullable()` short-circuits on null BEFORE coercion — otherwise z.coerce.number()
  // turns a null (open-ended tier) into 0 and trips the "to before from" check.
  toDays: z.coerce.number().int().min(0).nullable().optional(),
  type: z.enum(['FIXED', 'PERCENT']),
  value: z.coerce.number().min(0),
});

const configSchema = z.object({
  // Contributions
  monthlyFee: z.coerce.number().min(0),
  registrationFee: z.coerce.number().min(0),
  currency: z.string().min(1).max(8),
  dueDay: z.coerce.number().int().min(1).max(28),
  gracePeriodDays: z.coerce.number().int().min(0).max(90),
  // Penalties
  penaltyTiers: z.array(tierSchema).default([]),
  // Membership
  autoSuspendMonths: z.coerce.number().int().min(1).max(60),
  autoTerminateMonths: z.coerce.number().int().min(1).max(120),
  minMembershipMonths: z.coerce.number().int().min(0).max(120),
  reinstatementFee: z.coerce.number().min(0),
  autoSuspendEnabled: z.boolean(),
  autoReminderEnabled: z.boolean(),
  // Configurable member roles
  memberRoles: z.array(z.string().min(1).max(60)).default([]),
  // Optional reason captured for the change log
  reason: z.string().optional().nullable(),
});

const DEFAULT_MEMBER_ROLES = ['Member', 'Chairperson', 'Vice Chairperson', 'Secretary', 'Treasurer', 'Auditor', 'Committee Member'];

export type RuleConfigInput = z.infer<typeof configSchema>;

function toNum(v: unknown) { return v == null ? 0 : Number(v); }

/** Full configuration payload for the Rule Configuration Center. */
export async function getRuleConfig() {
  const actor = await getActor();
  await assertPermission(actor, 'manage_edir_settings');
  if (actor.isSuperAdmin && !actor.activeEdirId) return { needsEdir: true as const, settings: null, emergencyTypes: [], changeLog: [] };
  const edirId = resolveEdirId(actor);

  const [settings, emergencyTypes, changeLogRaw] = await Promise.all([
    prisma.edirSettings.findUnique({ where: { edirId } }),
    prisma.emergencyType.findMany({ where: { edirId }, orderBy: { name: 'asc' } }),
    prisma.ruleChangeLog.findMany({ where: { edirId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);

  const userIds = Array.from(new Set(changeLogRaw.map(c => c.changedById).filter(Boolean))) as string[];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameById = new Map(users.map(u => [u.id, u.name ?? u.email ?? 'Unknown']));

  return {
    settings: settings ? {
      monthlyFee: toNum(settings.monthlyFee),
      registrationFee: toNum(settings.registrationFee),
      currency: settings.currency,
      dueDay: settings.dueDay,
      gracePeriodDays: settings.gracePeriodDays,
      penaltyTiers: Array.isArray(settings.penaltyTiers) ? settings.penaltyTiers : [],
      autoSuspendMonths: settings.autoSuspendMonths,
      autoTerminateMonths: settings.autoTerminateMonths,
      minMembershipMonths: settings.minMembershipMonths,
      reinstatementFee: toNum(settings.reinstatementFee),
      autoSuspendEnabled: settings.autoSuspendEnabled,
      autoReminderEnabled: settings.autoReminderEnabled,
      memberRoles: (Array.isArray(settings.memberRoles) && settings.memberRoles.length ? settings.memberRoles : DEFAULT_MEMBER_ROLES) as string[],
    } : null,
    emergencyTypes: emergencyTypes.map(t => ({
      id: t.id, name: t.name, description: t.description, basePayout: toNum(t.basePayout),
      documentationRequired: t.documentationRequired, requiredDocuments: t.requiredDocuments,
      requiresApproval: t.requiresApproval, waitingPeriodDays: t.waitingPeriodDays,
      eligibilityMonths: t.eligibilityMonths, isActive: t.isActive,
    })),
    changeLog: changeLogRaw.map(c => ({
      id: c.id, field: c.field, previousValue: c.previousValue, newValue: c.newValue,
      comment: c.comment, createdAt: c.createdAt,
      changedBy: c.changedById ? (nameById.get(c.changedById) ?? 'Unknown') : 'System',
    })),
  };
}

// Human-readable labels for change-log diffing.
const FIELD_LABELS: Record<string, string> = {
  monthlyFee: 'Monthly Contribution',
  registrationFee: 'Registration Fee',
  currency: 'Currency',
  dueDay: 'Due Day',
  gracePeriodDays: 'Grace Period (days)',
  autoSuspendMonths: 'Auto-Suspend (months)',
  autoTerminateMonths: 'Auto-Terminate (months)',
  minMembershipMonths: 'Min. Membership (months)',
  reinstatementFee: 'Reinstatement Fee',
  autoSuspendEnabled: 'Automatic Suspension',
  autoReminderEnabled: 'Automatic Reminders',
  penaltyTiers: 'Late-Payment Penalty Tiers',
  memberRoles: 'Member Roles',
};

/** Member role options for this Edir (configurable, with sensible defaults). */
export async function getMemberRoles(): Promise<string[]> {
  const actor = await getActor();
  const edirId = actor.edirId ?? (actor.isSuperAdmin ? null : null);
  if (!edirId) return DEFAULT_MEMBER_ROLES;
  const settings = await prisma.edirSettings.findUnique({ where: { edirId }, select: { memberRoles: true } });
  const roles = settings && Array.isArray(settings.memberRoles) ? (settings.memberRoles as string[]) : [];
  return roles.length ? roles : DEFAULT_MEMBER_ROLES;
}

/** Save every rule at once, recording a Change Log entry for each modified field. */
export async function saveRuleConfig(input: RuleConfigInput) {
  try {
    const { actor, edirId } = await requireActor('manage_edir_settings');
    const data = configSchema.parse(input);

    if (data.autoTerminateMonths <= data.autoSuspendMonths) {
      return { success: false as const, error: 'Termination threshold must be greater than the suspension threshold.' };
    }
    // Validate tiers are coherent (non-negative, percent ≤ 100).
    for (const t of data.penaltyTiers) {
      if (t.type === 'PERCENT' && t.value > 100) return { success: false as const, error: 'Percentage penalties cannot exceed 100%.' };
      if (t.toDays != null && t.toDays < t.fromDays) return { success: false as const, error: 'A penalty tier’s "to" day cannot be before its "from" day.' };
    }

    const existing = await prisma.edirSettings.findUnique({ where: { edirId } });

    const next = {
      monthlyFee: new Prisma.Decimal(data.monthlyFee),
      registrationFee: new Prisma.Decimal(data.registrationFee),
      currency: data.currency,
      dueDay: data.dueDay,
      gracePeriodDays: data.gracePeriodDays,
      penaltyTiers: data.penaltyTiers as unknown as Prisma.InputJsonValue,
      autoSuspendMonths: data.autoSuspendMonths,
      autoTerminateMonths: data.autoTerminateMonths,
      minMembershipMonths: data.minMembershipMonths,
      reinstatementFee: new Prisma.Decimal(data.reinstatementFee),
      autoSuspendEnabled: data.autoSuspendEnabled,
      autoReminderEnabled: data.autoReminderEnabled,
      memberRoles: (data.memberRoles.length ? data.memberRoles : DEFAULT_MEMBER_ROLES) as unknown as Prisma.InputJsonValue,
    };

    // Diff scalar fields against current values for the change log.
    const changes: { field: string; previous: string; current: string }[] = [];
    if (existing) {
      const compare: [string, unknown, unknown][] = [
        ['monthlyFee', toNum(existing.monthlyFee), data.monthlyFee],
        ['registrationFee', toNum(existing.registrationFee), data.registrationFee],
        ['currency', existing.currency, data.currency],
        ['dueDay', existing.dueDay, data.dueDay],
        ['gracePeriodDays', existing.gracePeriodDays, data.gracePeriodDays],
        ['autoSuspendMonths', existing.autoSuspendMonths, data.autoSuspendMonths],
        ['autoTerminateMonths', existing.autoTerminateMonths, data.autoTerminateMonths],
        ['minMembershipMonths', existing.minMembershipMonths, data.minMembershipMonths],
        ['reinstatementFee', toNum(existing.reinstatementFee), data.reinstatementFee],
        ['autoSuspendEnabled', existing.autoSuspendEnabled, data.autoSuspendEnabled],
        ['autoReminderEnabled', existing.autoReminderEnabled, data.autoReminderEnabled],
      ];
      for (const [field, prev, curr] of compare) {
        if (String(prev) !== String(curr)) changes.push({ field, previous: String(prev), current: String(curr) });
      }
      const prevTiers = JSON.stringify(existing.penaltyTiers ?? []);
      const nextTiers = JSON.stringify(data.penaltyTiers);
      if (prevTiers !== nextTiers) {
        changes.push({ field: 'penaltyTiers', previous: `${(Array.isArray(existing.penaltyTiers) ? existing.penaltyTiers.length : 0)} tier(s)`, current: `${data.penaltyTiers.length} tier(s)` });
      }
      const prevRoles = Array.isArray(existing.memberRoles) ? (existing.memberRoles as string[]) : [];
      if (JSON.stringify(prevRoles) !== JSON.stringify(data.memberRoles) && data.memberRoles.length) {
        changes.push({ field: 'memberRoles', previous: prevRoles.join(', ') || '—', current: data.memberRoles.join(', ') });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.edirSettings.upsert({ where: { edirId }, update: next, create: { edirId, ...next } });
      if (changes.length > 0) {
        await tx.ruleChangeLog.createMany({
          data: changes.map(c => ({
            edirId,
            field: FIELD_LABELS[c.field] ?? c.field,
            previousValue: c.previous,
            newValue: c.current,
            changedById: actor.id,
            comment: data.reason || null,
          })),
        });
      }
      await writeAudit({ edirId, userId: actor.id, action: 'RULE_CONFIG_SAVED', targetType: 'EdirSettings', targetId: edirId, details: `${changes.length} rule(s) changed.` }, tx);
    });

    revalidatePath('/dashboard/admin/settings');
    return { success: true as const, changed: changes.length };
  } catch (error) {
    return failure(error);
  }
}

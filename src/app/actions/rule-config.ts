'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireActor, getActor, assertPermission, resolveEdirId } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import { buildEdirSettingsUpdate, DEFAULT_MEMBER_ROLES, type EdirSettingsData } from '@/lib/edir-settings';
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
  // Days after a settling payment before the NEXT month's contribution becomes
  // payable (0 = members may pay ahead at any time).
  nextPaymentDelayDays: z.coerce.number().int().min(0).max(28).default(0),
  // Penalties
  penaltyTiers: z.array(tierSchema).default([]),
  // Daily penalty accrual (optional)
  dailyPenaltyEnabled: z.boolean().default(false),
  dailyPenaltyType: z.enum(['FIXED', 'PERCENT']).default('FIXED'),
  dailyPenaltyValue: z.coerce.number().min(0).default(0),
  dailyPenaltyMaxDays: z.coerce.number().int().min(0).max(3650).default(0),
  // Membership
  autoSuspendMonths: z.coerce.number().int().min(1).max(60),
  autoTerminateMonths: z.coerce.number().int().min(1).max(120),
  minMembershipMonths: z.coerce.number().int().min(0).max(120),
  reinstatementFee: z.coerce.number().min(0),
  autoSuspendEnabled: z.boolean(),
  autoTerminateEnabled: z.boolean(),
  autoReminderEnabled: z.boolean(),
  reminderDaysBefore: z.array(z.coerce.number().int().min(1)).default([1, 3, 7]),
  // Configurable member roles
  memberRoles: z.array(z.string().min(1).max(60)).default([]),
  // Optional reason captured for the change log
  reason: z.string().optional().nullable(),
});

export type RuleConfigInput = z.infer<typeof configSchema>;

function toNum(v: unknown) { return v == null ? 0 : Number(v); }

/** Full configuration payload for the Rule Configuration Center. */
export async function getRuleConfig() {
  const actor = await getActor();
  await assertPermission(actor, 'manage_edir_settings');
  if (actor.isSuperAdmin && !actor.activeEdirId) return { needsEdir: true as const, settings: null, emergencyTypes: [], changeLog: [] };
  const edirId = await resolveEdirId(actor);

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
      nextPaymentDelayDays: settings.nextPaymentDelayDays ?? 0,
      penaltyTiers: Array.isArray(settings.penaltyTiers) ? settings.penaltyTiers : [],
      dailyPenaltyEnabled: settings.dailyPenaltyEnabled,
      dailyPenaltyType: settings.dailyPenaltyType === 'PERCENT' ? 'PERCENT' : 'FIXED',
      dailyPenaltyValue: toNum(settings.dailyPenaltyValue),
      dailyPenaltyMaxDays: settings.dailyPenaltyMaxDays,
      autoSuspendMonths: settings.autoSuspendMonths,
      autoTerminateMonths: settings.autoTerminateMonths,
      minMembershipMonths: settings.minMembershipMonths,
      reinstatementFee: toNum(settings.reinstatementFee),
      autoSuspendEnabled: settings.autoSuspendEnabled,
      autoTerminateEnabled: settings.autoTerminateEnabled,
      autoReminderEnabled: settings.autoReminderEnabled,
      reminderDaysBefore: Array.isArray(settings.reminderDaysBefore) ? settings.reminderDaysBefore as number[] : [1, 3, 7],
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
  nextPaymentDelayDays: 'Next-Payment Delay (days)',
  autoSuspendMonths: 'Auto-Suspend (months)',
  autoTerminateMonths: 'Auto-Terminate (months)',
  minMembershipMonths: 'Min. Membership (months)',
  reinstatementFee: 'Reinstatement Fee',
  autoSuspendEnabled: 'Automatic Suspension',
  autoTerminateEnabled: 'Automatic Termination',
  autoReminderEnabled: 'Automatic Reminders',
  reminderDaysBefore: 'Reminder Schedule (days before due)',
  penaltyTiers: 'Late-Payment Penalty Tiers',
  dailyPenaltyEnabled: 'Daily Penalty Accrual',
  dailyPenaltyType: 'Daily Penalty Type',
  dailyPenaltyValue: 'Daily Penalty Value',
  dailyPenaltyMaxDays: 'Daily Penalty Cap (days)',
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
    // Reject overlapping day ranges — the penalty engine picks a single tier per
    // overdue-day count, so overlaps make the applied penalty ambiguous. Sort by
    // start day and ensure each tier's end is before the next tier's start. An
    // open-ended tier (no "to" day) must be the last/highest range.
    const sortedTiers = [...data.penaltyTiers].sort((a, b) => a.fromDays - b.fromDays);
    for (let i = 0; i < sortedTiers.length - 1; i++) {
      const cur = sortedTiers[i];
      const next = sortedTiers[i + 1];
      const curTo = cur.toDays == null ? Infinity : cur.toDays;
      if (curTo >= next.fromDays) {
        const curLabel = cur.label || `${cur.fromDays}${cur.toDays == null ? '+' : `–${cur.toDays}`} days`;
        const nextLabel = next.label || `${next.fromDays}${next.toDays == null ? '+' : `–${next.toDays}`} days`;
        return { success: false as const, error: `Penalty tiers "${curLabel}" and "${nextLabel}" overlap. Each tier must cover a distinct day range (an open-ended tier must be the last one).` };
      }
    }

    const existing = await prisma.edirSettings.findUnique({ where: { edirId } });

    // Single source of truth for the update object (shared with the RULE_CHANGE
    // approval executor so an approved change applies exactly what was reviewed).
    const next = buildEdirSettingsUpdate(data as EdirSettingsData);

    // Diff scalar fields against current values for the change log.
    const changes: { field: string; previous: string; current: string }[] = [];
    if (existing) {
      const compare: [string, unknown, unknown][] = [
        ['monthlyFee', toNum(existing.monthlyFee), data.monthlyFee],
        ['registrationFee', toNum(existing.registrationFee), data.registrationFee],
        ['currency', existing.currency, data.currency],
        ['dueDay', existing.dueDay, data.dueDay],
        ['gracePeriodDays', existing.gracePeriodDays, data.gracePeriodDays],
        ['nextPaymentDelayDays', existing.nextPaymentDelayDays ?? 0, data.nextPaymentDelayDays],
        ['autoSuspendMonths', existing.autoSuspendMonths, data.autoSuspendMonths],
        ['autoTerminateMonths', existing.autoTerminateMonths, data.autoTerminateMonths],
        ['minMembershipMonths', existing.minMembershipMonths, data.minMembershipMonths],
        ['reinstatementFee', toNum(existing.reinstatementFee), data.reinstatementFee],
        ['autoSuspendEnabled', existing.autoSuspendEnabled, data.autoSuspendEnabled],
        ['autoTerminateEnabled', existing.autoTerminateEnabled, data.autoTerminateEnabled],
        ['autoReminderEnabled', existing.autoReminderEnabled, data.autoReminderEnabled],
        ['reminderDaysBefore', JSON.stringify(existing.reminderDaysBefore ?? []), JSON.stringify(data.reminderDaysBefore)],
        ['dailyPenaltyEnabled', existing.dailyPenaltyEnabled, data.dailyPenaltyEnabled],
        ['dailyPenaltyType', existing.dailyPenaltyType, data.dailyPenaltyType],
        ['dailyPenaltyValue', toNum(existing.dailyPenaltyValue), data.dailyPenaltyValue],
        ['dailyPenaltyMaxDays', existing.dailyPenaltyMaxDays, data.dailyPenaltyMaxDays],
      ];
      for (const [field, prev, curr] of compare) {
        if (String(prev) !== String(curr)) changes.push({ field, previous: String(prev), current: String(curr) });
      }
      // Canonicalize tiers before diffing — the DB JSON and the form payload can
      // differ in key order, number types, or null-vs-missing optional keys, which
      // used to flag a bogus "3 tier(s) → 3 tier(s)" change on unrelated saves.
      const canonTiers = (v: unknown) => (Array.isArray(v) ? v : [])
        .map((t: any) => ({
          fromDays: Number(t?.fromDays) || 0,
          toDays: t?.toDays == null ? null : Number(t.toDays),
          type: t?.type === 'PERCENT' ? 'PERCENT' : 'FIXED',
          value: Number(t?.value) || 0,
          label: t?.label || null,
        }))
        .sort((a, b) => a.fromDays - b.fromDays);
      const describeTiers = (ts: ReturnType<typeof canonTiers>) => ts.length === 0
        ? 'None'
        : ts.map(t => `${t.fromDays}${t.toDays == null ? '+' : `–${t.toDays}`} days: ${t.type === 'PERCENT' ? `${t.value}%` : `${t.value} fixed`}`).join(' · ');
      const prevTiers = canonTiers(existing.penaltyTiers);
      const nextTiers = canonTiers(data.penaltyTiers);
      if (JSON.stringify(prevTiers) !== JSON.stringify(nextTiers)) {
        changes.push({ field: 'penaltyTiers', previous: describeTiers(prevTiers), current: describeTiers(nextTiers) });
      }
      const prevRoles = Array.isArray(existing.memberRoles) ? (existing.memberRoles as string[]) : [];
      if (JSON.stringify(prevRoles) !== JSON.stringify(data.memberRoles) && data.memberRoles.length) {
        changes.push({ field: 'memberRoles', previous: prevRoles.join(', ') || '—', current: data.memberRoles.join(', ') });
      }
    }

    if (changes.length === 0) return { success: true as const, changed: 0, message: 'No changes to save.' };

    // Changing Edir settings is sensitive, so anyone below head office — including
    // the Edir admin — routes the change through the RULE_CHANGE maker–checker
    // workflow instead of applying it directly. Head office / super admins (the
    // checkers / top authority) apply immediately.
    const mustApprove = !actor.isSuperAdmin && actor.orgScope !== 'HEAD_OFFICE';
    if (mustApprove) {
      const pending = await prisma.approvalRequest.findFirst({
        where: { edirId, module: 'RULE_CHANGE', status: { in: ['PENDING', 'RETURNED'] }, targetType: 'EdirSettings' },
        select: { id: true },
      });
      if (pending) return { success: false as const, error: 'There is already a pending settings change awaiting approval.' };

      // Pre-label the diff so the change log + approval view read cleanly without
      // needing FIELD_LABELS at approval time.
      const labeledChanges = changes.map(c => ({ field: FIELD_LABELS[c.field] ?? c.field, previous: c.previous, current: c.current }));
      await submitForApproval(actor, {
        edirId,
        module: 'RULE_CHANGE',
        title: 'Edir settings update',
        summary: `${changes.length} setting(s) changed`,
        payload: { kind: 'SETTINGS_BULK', data, changes: labeledChanges, reason: data.reason || null },
        targetType: 'EdirSettings',
        targetId: edirId,
      });
      await writeAudit({ edirId, userId: actor.id, action: 'RULE_CONFIG_SUBMITTED', targetType: 'EdirSettings', targetId: edirId, details: `${changes.length} setting(s) submitted for approval.` });
      revalidatePath('/dashboard/admin/settings');
      revalidatePath('/dashboard/approvals');
      return { success: true as const, changed: changes.length, pendingApproval: true, message: 'Settings changes submitted for approval.' };
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

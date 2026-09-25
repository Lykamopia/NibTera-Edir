'use server';

import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requireActor, getActor, assertPermission, assertSameTenant, tenantWhere } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { submitForApproval } from '@/lib/approval-engine';
import '@/lib/approval-modules';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { zId, zOptionalId, zText, zOptionalText, zComment, parseArgs } from '@/lib/validation';

// Governance rules that live on EdirSettings and may be changed via Maker–Checker.
const RULE_FIELDS = {
  monthlyFee: { label: 'Monthly Fee', kind: 'money' },
  registrationFee: { label: 'Registration Fee', kind: 'money' },
  dueDay: { label: 'Payment Due Day', kind: 'int' },
  gracePeriodDays: { label: 'Grace Period (days)', kind: 'int' },
  autoSuspendMonths: { label: 'Auto-suspend after (months)', kind: 'int' },
  autoTerminateMonths: { label: 'Auto-terminate after (months)', kind: 'int' },
} as const;

type RuleField = keyof typeof RULE_FIELDS;

// ─── Read: current rules, bylaws, change log ─────────────────────────────────

export async function getRulesOverview() {
  const actor = await getActor();
  await assertPermission(actor, ['view_rules', 'manage_rules']);
  const edirId = actor.isSuperAdmin ? actor.edirId : actor.edirId;
  if (!edirId) return { settings: null, bylaws: [], changeLog: [] };

  const [settings, bylaws, changeLog] = await Promise.all([
    prisma.edirSettings.findUnique({ where: { edirId } }),
    prisma.bylaw.findMany({ where: { edirId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    prisma.ruleChangeLog.findMany({ where: { edirId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);

  const rules = settings ? (Object.keys(RULE_FIELDS) as RuleField[]).map(f => ({
    field: f, label: RULE_FIELDS[f].label, kind: RULE_FIELDS[f].kind,
    value: RULE_FIELDS[f].kind === 'money' ? Number((settings as any)[f]) : (settings as any)[f],
  })) : [];

  // Resolve who made each change for display.
  const userIds = Array.from(new Set(changeLog.map(c => c.changedById).filter(Boolean))) as string[];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameById = new Map(users.map(u => [u.id, u.name ?? u.email ?? 'Unknown']));

  return {
    settings,
    currency: settings?.currency ?? 'ETB',
    rules,
    bylaws: bylaws.map(b => ({ id: b.id, section: b.section, title: b.title, content: b.content, order: b.order })),
    changeLog: changeLog.map(c => ({
      id: c.id, field: c.field, previousValue: c.previousValue, newValue: c.newValue,
      comment: c.comment, createdAt: c.createdAt, changedBy: c.changedById ? nameById.get(c.changedById) ?? 'Unknown' : 'System',
    })),
  };
}

// ─── Propose a governance-setting change (RULE_CHANGE) ───────────────────────

const settingChangeSchema = z.object({
  field: z.enum(['monthlyFee', 'registrationFee', 'dueDay', 'gracePeriodDays', 'autoSuspendMonths', 'autoTerminateMonths']),
  newValue: z.coerce.number().finite().min(0).max(1_000_000_000),
  comment: zComment('Comment'),
});

export async function proposeSettingChange(input: z.infer<typeof settingChangeSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_rules');
    const data = settingChangeSchema.parse(input);

    const settings = await prisma.edirSettings.findUnique({ where: { edirId } });
    if (!settings) return { success: false as const, error: 'Edir settings not found.' };

    const meta = RULE_FIELDS[data.field as RuleField];
    if (meta.kind === 'int' && !Number.isInteger(data.newValue)) return { success: false as const, error: 'Value must be a whole number.' };
    if (data.field === 'dueDay' && (data.newValue < 1 || data.newValue > 28)) return { success: false as const, error: 'Due day must be between 1 and 28.' };

    const previous = (settings as any)[data.field];
    const previousValue = meta.kind === 'money' ? Number(previous) : previous;
    if (Number(previousValue) === data.newValue) return { success: false as const, error: 'The new value matches the current value.' };

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'RULE_CHANGE',
      title: `Change ${meta.label}: ${previousValue} → ${data.newValue}`,
      summary: data.comment || undefined,
      payload: { kind: 'SETTING', field: data.field, label: meta.label, fieldKind: meta.kind, previousValue: String(previousValue), newValue: data.newValue, comment: data.comment || null },
      targetType: 'EdirSettings',
      targetId: edirId,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'RULE_CHANGE_PROPOSED', targetType: 'EdirSettings', targetId: edirId, details: `${meta.label}: ${previousValue} → ${data.newValue}` });
    revalidatePath('/dashboard/rules');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

// ─── Propose a bylaw change (RULE_CHANGE) ────────────────────────────────────

const bylawSchema = z.object({
  id: zOptionalId,
  section: zOptionalText('Section', { max: 40 }),
  title: zText('Title', { min: 2, max: 200 }),
  content: zText('Content', { min: 1, max: 20_000, multiline: true }),
  comment: zComment('Comment'),
});

export async function proposeBylawChange(input: z.infer<typeof bylawSchema>) {
  try {
    const { actor, edirId } = await requireActor('manage_rules');
    const data = bylawSchema.parse(input);

    let previous: { title: string; content: string; section: string | null } | null = null;
    if (data.id) {
      const existing = await prisma.bylaw.findUnique({ where: { id: data.id } });
      if (!existing) return { success: false as const, error: 'Bylaw not found.' };
      await assertSameTenant(actor, existing.edirId);
      previous = { title: existing.title, content: existing.content, section: existing.section };
    }

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'RULE_CHANGE',
      title: data.id ? `Amend bylaw: ${data.title}` : `New bylaw: ${data.title}`,
      summary: data.comment || undefined,
      payload: {
        kind: 'BYLAW_UPSERT', bylawId: data.id || null, section: data.section || null,
        title: data.title, content: data.content,
        previousValue: previous ? `${previous.title}\n${previous.content}` : null,
        newValue: `${data.title}\n${data.content}`, comment: data.comment || null,
      },
      targetType: 'Bylaw',
      targetId: data.id || undefined,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'BYLAW_CHANGE_PROPOSED', targetType: 'Bylaw', targetId: data.id || undefined, details: data.title });
    revalidatePath('/dashboard/rules');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

export async function proposeBylawDeletion(bylawId: string, comment?: string) {
  try {
    [bylawId, comment] = parseArgs([zId, zComment('Comment')], [bylawId, comment]) as [string, string | undefined];
    const { actor, edirId } = await requireActor('manage_rules');
    const existing = await prisma.bylaw.findUnique({ where: { id: bylawId } });
    if (!existing) return { success: false as const, error: 'Bylaw not found.' };
    await assertSameTenant(actor, existing.edirId);

    const requestId = await submitForApproval(actor, {
      edirId,
      module: 'RULE_CHANGE',
      title: `Repeal bylaw: ${existing.title}`,
      summary: comment || undefined,
      payload: { kind: 'BYLAW_DELETE', bylawId, title: existing.title, previousValue: `${existing.title}\n${existing.content}`, newValue: null, comment: comment || null },
      targetType: 'Bylaw',
      targetId: bylawId,
    });

    await writeAudit({ edirId, userId: actor.id, action: 'BYLAW_DELETE_PROPOSED', targetType: 'Bylaw', targetId: bylawId, details: existing.title });
    revalidatePath('/dashboard/rules');
    revalidatePath('/dashboard/approvals');
    return { success: true as const, requestId };
  } catch (error) {
    return failure(error);
  }
}

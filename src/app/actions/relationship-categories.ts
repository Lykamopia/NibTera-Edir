'use server';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getActor, actorHasPermission, assertPermission, resolveEdirId } from '@/lib/tenant-scope';
import { writeAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { failure } from '@/lib/action-result';
import { zId, zIdList } from '@/lib/validation';

/** Sensible defaults used when an Edir has not configured its own categories yet. */
const DEFAULT_RELATIONSHIP_CATEGORIES = [
  { name: 'Spouse', benefitEligible: true, emergencyEligible: true },
  { name: 'Child', benefitEligible: true, emergencyEligible: true },
  { name: 'Parent', benefitEligible: true, emergencyEligible: true },
  { name: 'Sibling', benefitEligible: true, emergencyEligible: true },
  { name: 'Grandparent', benefitEligible: true, emergencyEligible: true },
  { name: 'Grandchild', benefitEligible: true, emergencyEligible: true },
  { name: 'Guardian', benefitEligible: false, emergencyEligible: true },
  { name: 'Beneficiary', benefitEligible: true, emergencyEligible: true },
  { name: 'Other', benefitEligible: false, emergencyEligible: false },
];

interface ActiveRelationshipCategory {
  name: string;
  description: string | null;
  benefitEligible: boolean;
  emergencyEligible: boolean;
  requiredDocuments: string | null;
  maxDependents: number | null;
}

/**
 * Active relationship categories for the current Edir — the single source feeding
 * every relationship selector (member registration, dependents, requests, etc.).
 * Falls back to a default set when the Edir has none configured yet.
 */
export async function getActiveRelationshipCategories(): Promise<ActiveRelationshipCategory[]> {
  const actor = await getActor();
  let edirId: string | null = null;
  try { edirId = await resolveEdirId(actor); } catch { edirId = actor.edirId; }
  if (!edirId) return DEFAULT_RELATIONSHIP_CATEGORIES.map(toActive);

  const cats = await prisma.relationshipCategory.findMany({ where: { edirId, isActive: true }, orderBy: { displayOrder: 'asc' } });
  const live = cats.filter(c => c.pendingAction !== 'create'); // pending-create not live yet
  if (live.length === 0) return DEFAULT_RELATIONSHIP_CATEGORIES.map(toActive);
  return live.map(c => ({
    name: c.name, description: c.description, benefitEligible: c.benefitEligible,
    emergencyEligible: c.emergencyEligible, requiredDocuments: c.requiredDocuments, maxDependents: c.maxDependents,
  }));
}

function toActive(d: { name: string; benefitEligible: boolean; emergencyEligible: boolean }): ActiveRelationshipCategory {
  return { name: d.name, description: null, benefitEligible: d.benefitEligible, emergencyEligible: d.emergencyEligible, requiredDocuments: null, maxDependents: null };
}

/** Full management list (all categories incl. inactive/pending) + the actor's capability. */
export async function getRelationshipCategories() {
  const actor = await getActor();
  await assertPermission(actor, ['manage_edir_settings']);
  const edirId = await resolveEdirId(actor);
  const cats = await prisma.relationshipCategory.findMany({ where: { edirId }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
  return {
    edirId,
    canManage: actorHasPermission(actor, ['manage_edir_settings']),
    usingDefaults: cats.length === 0,
    defaults: DEFAULT_RELATIONSHIP_CATEGORIES.map(d => d.name),
    items: cats.map(c => ({
      id: c.id, name: c.name, description: c.description, isActive: c.isActive, displayOrder: c.displayOrder,
      benefitEligible: c.benefitEligible, emergencyEligible: c.emergencyEligible,
      requiredDocuments: c.requiredDocuments, maxDependents: c.maxDependents, pendingAction: c.pendingAction,
    })),
  };
}

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(60),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  benefitEligible: z.boolean().default(true),
  emergencyEligible: z.boolean().default(true),
  requiredDocuments: z.string().trim().max(500).optional().nullable(),
  maxDependents: z.coerce.number().int().min(0).max(99).optional().nullable(),
});

/** Create a new relationship category — applied immediately (no approval). */
export async function submitCreateRelationshipCategory(input: z.infer<typeof categorySchema>) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_edir_settings']);
    const edirId = await resolveEdirId(actor);
    const data = categorySchema.parse(input);

    const dupe = await prisma.relationshipCategory.findFirst({ where: { edirId, name: data.name } });
    if (dupe) return { success: false as const, error: 'A category with this name already exists.' };

    const max = await prisma.relationshipCategory.aggregate({ where: { edirId }, _max: { displayOrder: true } });
    await prisma.relationshipCategory.create({
      data: {
        edirId, name: data.name, description: data.description || null, isActive: data.isActive,
        benefitEligible: data.benefitEligible, emergencyEligible: data.emergencyEligible,
        requiredDocuments: data.requiredDocuments || null, maxDependents: data.maxDependents ?? null,
        displayOrder: (max._max.displayOrder ?? 0) + 1,
      },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIONSHIP_CATEGORY_CREATED', targetType: 'RelationshipCategory', targetId: edirId, details: data.name });
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Edit a category's settings (incl. activate/deactivate) — applied immediately. */
export async function submitUpdateRelationshipCategory(id: string, input: z.infer<typeof categorySchema>) {
  try {
    id = zId.parse(id);
    const actor = await getActor();
    await assertPermission(actor, ['manage_edir_settings']);
    const edirId = await resolveEdirId(actor);
    const cat = await prisma.relationshipCategory.findFirst({ where: { id, edirId } });
    if (!cat) return { success: false as const, error: 'Category not found.' };
    const data = categorySchema.parse(input);

    if (data.name !== cat.name) {
      const dupe = await prisma.relationshipCategory.findFirst({ where: { edirId, name: data.name, id: { not: id } } });
      if (dupe) return { success: false as const, error: 'Another category already uses this name.' };
    }

    await prisma.relationshipCategory.update({
      where: { id },
      data: {
        name: data.name, description: data.description || null, isActive: data.isActive,
        benefitEligible: data.benefitEligible, emergencyEligible: data.emergencyEligible,
        requiredDocuments: data.requiredDocuments || null, maxDependents: data.maxDependents ?? null,
        pendingAction: null, pendingPayload: Prisma.DbNull,
      },
    });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIONSHIP_CATEGORY_UPDATED', targetType: 'RelationshipCategory', targetId: id, details: data.name });
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Delete a category — applied immediately. Blocked only if in use by a relative. */
export async function submitDeleteRelationshipCategory(id: string) {
  try {
    id = zId.parse(id);
    const actor = await getActor();
    await assertPermission(actor, ['manage_edir_settings']);
    const edirId = await resolveEdirId(actor);
    const cat = await prisma.relationshipCategory.findFirst({ where: { id, edirId } });
    if (!cat) return { success: false as const, error: 'Category not found.' };

    const inUse = await prisma.relative.count({ where: { relationship: cat.name, member: { edirId } } });
    if (inUse > 0) {
      return { success: false as const, error: `Cannot delete — ${inUse} relative(s) use "${cat.name}". Deactivate it instead to hide it from new entries.` };
    }

    await prisma.relationshipCategory.delete({ where: { id } });
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIONSHIP_CATEGORY_DELETED', targetType: 'RelationshipCategory', targetId: id, details: cat.name });
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}

/** Reorder categories (display order only — applied immediately with an audit entry). */
export async function reorderRelationshipCategories(orderedIds: string[]) {
  try {
    orderedIds = zIdList(500).parse(orderedIds);
    const actor = await getActor();
    await assertPermission(actor, ['manage_edir_settings']);
    const edirId = await resolveEdirId(actor);
    const owned = await prisma.relationshipCategory.findMany({ where: { edirId, id: { in: orderedIds } }, select: { id: true } });
    const ownedIds = new Set(owned.map(o => o.id));
    await prisma.$transaction(
      orderedIds.filter(id => ownedIds.has(id)).map((id, idx) =>
        prisma.relationshipCategory.update({ where: { id }, data: { displayOrder: idx } })),
    );
    await writeAudit({ edirId, userId: actor.id, action: 'RELATIONSHIP_CATEGORY_REORDERED', targetType: 'RelationshipCategory', targetId: edirId });
    revalidatePath('/dashboard/admin/settings');
    return { success: true as const };
  } catch (error) {
    return failure(error);
  }
}


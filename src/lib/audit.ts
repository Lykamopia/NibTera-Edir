import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export interface AuditInput {
  edirId?: string | null;
  userId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: string | null;
}

/**
 * Write an audit-trail entry. Accepts an optional Prisma transaction client so it
 * participates in the same transaction as the operation it records. Never throws
 * fatally — auditing must not break the primary action.
 */
export async function writeAudit(input: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? prisma;
  try {
    await client.auditLog.create({
      data: {
        edirId: input.edirId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: input.details ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

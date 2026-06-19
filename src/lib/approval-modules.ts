/**
 * Registers the downstream executors for each Maker–Checker module. Importing
 * this module for its side-effects wires the registry; the Approvals actions and
 * the maker-side actions (payments, members) import it so `approveRequest` can
 * run the real operation inside its transaction.
 *
 * Iteration 1 wires MANUAL_PAYMENT (settlement) and MEMBER_REMOVAL (cascade).
 * Later modules register their executors here as they are built.
 */

import { registerModule } from '@/lib/approval-engine';
import { settlePaymentTx, type ManualPaymentPayload } from '@/lib/payment-settlement';
import { Prisma } from '@prisma/client';

let registered = false;

export function ensureApprovalModules() {
  if (registered) return;
  registered = true;

  // ── Manual Payment ─────────────────────────────────────────────────────────
  registerModule('MANUAL_PAYMENT', {
    async execute(payload: ManualPaymentPayload, { tx }) {
      await settlePaymentTx(tx, {
        memberId: payload.memberId,
        paymentLogId: payload.paymentLogId,
        total: new Prisma.Decimal(payload.total),
        breakdown: payload.breakdown,
        method: 'MANUAL',
      });
    },
  });

  // ── Member Removal ─────────────────────────────────────────────────────────
  registerModule('MEMBER_REMOVAL', {
    async execute(payload: { memberId: string }, { tx }) {
      // Member relations cascade (relatives, paymentStatus, installment plans,
      // emergency claims, event participations); paymentLogs/issuances null out.
      await tx.member.delete({ where: { id: payload.memberId } });
    },
  });

  // ── Emergency Claim (approve the claim → ACTIVE with approved amount) ─────────
  registerModule('EMERGENCY_CLAIM', {
    async execute(payload: { claimId: string; approvedAmount: number }, { tx }) {
      await tx.emergencyClaim.update({
        where: { id: payload.claimId },
        data: { status: 'ACTIVE', approvedAmount: new Prisma.Decimal(payload.approvedAmount) },
      });
    },
  });

  // ── Emergency Disbursement (pay out → RESOLVED, draw down the reserve) ────────
  registerModule('EMERGENCY_DISBURSEMENT', {
    async execute(payload: { claimId: string; amount: number }, { tx }) {
      const claim = await tx.emergencyClaim.update({
        where: { id: payload.claimId },
        data: { status: 'RESOLVED', disbursedAmount: new Prisma.Decimal(payload.amount) },
      });
      // Draw down the emergency reserve (floored at zero).
      const settings = await tx.edirSettings.findUnique({ where: { edirId: claim.edirId } });
      if (settings) {
        const next = Math.max(0, Number(settings.emergencyReserve) - payload.amount);
        await tx.edirSettings.update({ where: { edirId: claim.edirId }, data: { emergencyReserve: new Prisma.Decimal(next) } });
      }
    },
  });

  // ── Asset Issuance (approve → mark issued, draw down available inventory) ─────
  registerModule('ASSET_ISSUANCE', {
    async execute(payload: { issuanceId: string; assetId: string; qty: number }, { tx }) {
      const asset = await tx.asset.findUnique({ where: { id: payload.assetId } });
      if (!asset) throw new Error('Asset no longer exists.');
      const available = asset.quantity - asset.issuedQuantity;
      if (payload.qty > available) throw new Error(`Only ${available} unit(s) available — cannot issue ${payload.qty}.`);
      const newIssued = asset.issuedQuantity + payload.qty;
      await tx.asset.update({
        where: { id: asset.id },
        data: { issuedQuantity: newIssued, status: newIssued >= asset.quantity ? 'issued' : 'available' },
      });
      await tx.assetIssuance.update({ where: { id: payload.issuanceId }, data: { status: 'ISSUED', issuedQty: payload.qty } });
    },
  });

  // ── Rule Change (apply governance-setting or bylaw change + log the diff) ─────
  registerModule('RULE_CHANGE', {
    async execute(payload: any, { tx, request, actor }) {
      const edirId = request.edirId;

      if (payload.kind === 'SETTING') {
        const value = payload.fieldKind === 'money' ? new Prisma.Decimal(payload.newValue) : Number(payload.newValue);
        await tx.edirSettings.update({ where: { edirId }, data: { [payload.field]: value } as any });
        await tx.ruleChangeLog.create({
          data: { edirId, field: payload.label ?? payload.field, previousValue: String(payload.previousValue), newValue: String(payload.newValue), changedById: actor.id, comment: payload.comment ?? null },
        });
        return;
      }

      if (payload.kind === 'BYLAW_UPSERT') {
        if (payload.bylawId) {
          await tx.bylaw.update({ where: { id: payload.bylawId }, data: { title: payload.title, content: payload.content, section: payload.section ?? null } });
        } else {
          const count = await tx.bylaw.count({ where: { edirId } });
          await tx.bylaw.create({ data: { edirId, title: payload.title, content: payload.content, section: payload.section ?? null, order: count } });
        }
        await tx.ruleChangeLog.create({
          data: { edirId, field: `Bylaw: ${payload.title}`, previousValue: payload.previousValue ?? null, newValue: payload.newValue ?? null, changedById: actor.id, comment: payload.comment ?? null },
        });
        return;
      }

      if (payload.kind === 'BYLAW_DELETE') {
        await tx.bylaw.deleteMany({ where: { id: payload.bylawId, edirId } });
        await tx.ruleChangeLog.create({
          data: { edirId, field: `Bylaw repealed: ${payload.title}`, previousValue: payload.previousValue ?? null, newValue: null, changedById: actor.id, comment: payload.comment ?? null },
        });
        return;
      }

      if (payload.kind === 'RULES_VERSION_PUBLISH') {
        const version = await tx.rulesVersion.findUnique({ where: { id: payload.versionId } });
        if (!version || version.edirId !== edirId) throw new Error('Rules version not found.');
        const prior = await tx.rulesVersion.findFirst({ where: { edirId, status: 'APPROVED' } });
        if (prior && prior.id !== version.id) {
          await tx.rulesVersion.update({ where: { id: prior.id }, data: { status: 'ARCHIVED' } });
        }
        await tx.rulesVersion.update({
          where: { id: version.id },
          data: { status: 'APPROVED', approverId: actor.id, approvedAt: new Date(), effectiveDate: version.effectiveDate ?? new Date() },
        });
        await tx.ruleChangeLog.create({
          data: {
            edirId, field: `Rules & Bylaws v${version.versionNumber}`,
            previousValue: prior ? `v${prior.versionNumber} (${prior.title})` : 'none',
            newValue: `v${version.versionNumber} (${version.title})`,
            changedById: actor.id, comment: version.changeSummary ?? null,
          },
        });
        // Notify all active members of the Edir that new rules are in effect.
        const members = await tx.user.findMany({ where: { edirId, status: 'ACTIVE' }, select: { id: true } });
        if (members.length > 0) {
          await tx.notification.createMany({
            data: members.map(u => ({
              userId: u.id, type: 'system', priority: 'normal',
              title: 'Updated Rules & Bylaws published',
              body: `Version ${version.versionNumber} of the Edir Rules & Bylaws is now in effect.`,
              linkUrl: '/dashboard/rules', edirId,
            })),
          });
        }
        return;
      }
    },
  });
}

ensureApprovalModules();

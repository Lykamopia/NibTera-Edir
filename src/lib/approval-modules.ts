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
import bcrypt from 'bcrypt';
import { generateTempPassword } from '@/lib/secure-random';

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

  // ── Asset Return (approve → free inventory + apply any compensation) ─────────
  registerModule('ASSET_RETURN', {
    async execute(payload: { issuanceId: string; returnedQty: number; condition?: string | null; compensation: number }, { tx }) {
      const issuance = await tx.assetIssuance.findUnique({ where: { id: payload.issuanceId } });
      if (!issuance) throw new Error('The asset issuance no longer exists.');
      if (issuance.status !== 'ISSUED') throw new Error('This asset is no longer in an issued state.');
      if (payload.returnedQty > issuance.issuedQty) throw new Error(`Cannot return more than the ${issuance.issuedQty} issued.`);
      const compensation = Number(payload.compensation) || 0;
      const newStatus = compensation > 0 ? 'COMPENSATION_PENDING' : 'CLOSED';
      await tx.asset.update({
        where: { id: issuance.assetId },
        data: { issuedQuantity: { decrement: payload.returnedQty }, status: 'available' },
      });
      await tx.assetIssuance.update({
        where: { id: issuance.id },
        data: { status: newStatus, returnedQty: payload.returnedQty, condition: payload.condition || null, compensation: new Prisma.Decimal(compensation) },
      });
      // Loss/damage compensation is added to the member's outstanding balance.
      if (compensation > 0 && issuance.memberId) {
        await tx.paymentStatus.upsert({
          where: { memberId: issuance.memberId },
          update: { balance: { increment: compensation }, status: 'PENDING' },
          create: { memberId: issuance.memberId, balance: new Prisma.Decimal(compensation), status: 'PENDING' },
        });
      }
    },
  });

  // ── Document Action (maker–checker for the document repository) ──────────────
  registerModule('DOCUMENT_ACTION', {
    async execute(payload: { documentId: string; action: string; changes?: any }, { tx, actor }) {
      const doc = await tx.dmsDocument.findUnique({ where: { id: payload.documentId } });
      if (!doc) throw new Error('The document no longer exists.');
      const now = new Date();
      const stamp = { reviewedById: actor.id, approvedById: actor.id, reviewedAt: now, approvedAt: now, pendingAction: null, pendingPayload: Prisma.DbNull, rejectionReason: null };
      const changes = payload.changes ?? {};
      switch (payload.action) {
        case 'upload':
          await tx.dmsDocument.update({ where: { id: doc.id }, data: { ...stamp, status: 'APPROVED' } });
          break;
        case 'edit':
          await tx.dmsDocument.update({ where: { id: doc.id }, data: { ...stamp, title: changes.title ?? doc.title, purpose: changes.purpose ?? doc.purpose, fileUrl: changes.fileUrl ?? doc.fileUrl, fileName: changes.fileName ?? doc.fileName, fileType: changes.fileType ?? doc.fileType } });
          break;
        case 'classify':
          await tx.dmsDocument.update({ where: { id: doc.id }, data: { ...stamp, category: changes.category ?? doc.category, tags: changes.tags ?? doc.tags } });
          break;
        case 'share':
          await tx.dmsDocument.update({ where: { id: doc.id }, data: { ...stamp, visibility: changes.visibility ?? doc.visibility } });
          break;
        case 'revoke':
          await tx.dmsDocument.update({ where: { id: doc.id }, data: { ...stamp, visibility: 'staff' } });
          break;
        case 'archive':
          await tx.dmsDocument.update({ where: { id: doc.id }, data: { ...stamp, status: 'ARCHIVED', archivedAt: now } });
          break;
        case 'delete':
          await tx.dmsDocument.delete({ where: { id: doc.id } });
          break;
        default:
          throw new Error(`Unknown document action: ${payload.action}`);
      }
    },
    // On rejection: a rejected upload becomes REJECTED; a rejected change to an
    // already-approved document simply drops the proposed action.
    async onReject(payload: { documentId: string; action: string }, { tx, actor, comment }) {
      const doc = await tx.dmsDocument.findUnique({ where: { id: payload.documentId } });
      if (!doc) return;
      const base = { reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: comment ?? null, pendingAction: null, pendingPayload: Prisma.DbNull };
      await tx.dmsDocument.update({
        where: { id: doc.id },
        data: payload.action === 'upload' ? { ...base, status: 'REJECTED' as const } : base,
      });
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

  // ── Edir Registration (approve the registration → Edir becomes ACTIVE) ─────────
  registerModule('EDIR_REGISTRATION', {
    async execute(payload: { edirId: string }, { tx }) {
      // Transition Edir from PENDING to ACTIVE upon approval
      const edir = await tx.edir.update({
        where: { id: payload.edirId },
        data: { status: 'ACTIVE' },
      });

      // Create default EdirSettings if not already present
      const existing = await tx.edirSettings.count({ where: { edirId: edir.id } });
      if (existing === 0) {
        await tx.edirSettings.create({ data: { edirId: edir.id } });
      }

      // Create default Edir roles (idempotent)
      const EDIR_ADMIN_PERMISSIONS = ['view_dashboard', 'view_members', 'manage_members', 'remove_members', 'approve_member_removal', 'view_payments', 'record_payment', 'approve_payment', 'waive_penalty', 'approve_penalty_waiver', 'void_payment', 'view_approvals', 'view_emergencies', 'manage_emergencies', 'approve_emergency_claim', 'approve_emergency_disbursement', 'view_events', 'manage_events', 'finalize_attendance', 'view_assets', 'manage_assets', 'manage_asset_categories', 'approve_asset_issuance', 'view_rules', 'manage_rules', 'approve_rule_change', 'view_committee_oversight', 'handle_member_requests', 'view_documents', 'manage_edir_settings', 'manage_committee', 'view_users', 'manage_users', 'view_roles', 'manage_roles', 'reset_password', 'lock_user', 'unlock_user', 'view_audit_log', 'manage_audit_log', 'view_payment_log'];
      const DEFAULT_EDIR_ROLES = [
        { name: 'Edir Admin', permissions: EDIR_ADMIN_PERMISSIONS },
        { name: 'Member', permissions: ['view_dashboard'] },
        { name: 'Committee (Oversight)', permissions: ['view_dashboard', 'view_committee_oversight', 'view_members', 'view_payments', 'view_audit_log', 'view_payment_log', 'view_approvals', 'view_documents'] },
      ];
      const roleCount = await tx.role.count({ where: { edirId: edir.id } });
      if (roleCount === 0) {
        await tx.role.createMany({
          data: DEFAULT_EDIR_ROLES.map(r => ({ name: r.name, scope: 'EDIR' as const, edirId: edir.id, permissions: r.permissions.join(',') })),
        });
      }
    },
  });

  // ── Edir Update (apply changed fields from payload to Edir) ────────────────────
  registerModule('EDIR_UPDATE', {
    async execute(payload: { edirId: string; changes: Record<string, any> }, { tx }) {
      // Only allow updates to specific fields
      const allowedFields = ['name', 'description', 'address', 'accountNumber', 'contactPersonName', 'contactAddress', 'contactMobile', 'contactEmail', 'agreementDocUrl'];
      const updates: Record<string, any> = {};
      for (const [key, value] of Object.entries(payload.changes)) {
        if (allowedFields.includes(key)) {
          updates[key] = value;
        }
      }
      if (Object.keys(updates).length > 0) {
        await tx.edir.update({ where: { id: payload.edirId }, data: updates });
      }
    },
  });

  // ── User Creation (create User + hashed password + membership) ────────────────
  registerModule('USER_CREATION', {
    async execute(payload: { edirId: string; email: string; phone: string; name: string; roleId: string }, { tx, actor }) {
      const hashedPassword = await bcrypt.hash(generateTempPassword(), 12);
      const user = await tx.user.create({
        data: {
          email: payload.email,
          phone: payload.phone,
          name: payload.name,
          edirId: payload.edirId,
          roleId: payload.roleId,
          hashedPassword,
          status: 'ACTIVE',
          mustChangePassword: true,
        },
      });
      // Create a default membership association
      await tx.userEdirAssociation.create({
        data: { userId: user.id, edirId: payload.edirId, role: 'USER', createdAt: new Date() },
      });
    },
  });
}

ensureApprovalModules();

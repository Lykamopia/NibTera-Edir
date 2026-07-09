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
import crypto from 'crypto';
import { generateTempPassword } from '@/lib/secure-random';
import { sendVerificationEmail } from '@/lib/email';
import { writeAudit } from '@/lib/audit';

let registered = false;

export function ensureApprovalModules() {
  if (registered) return;
  registered = true;

  // ── Manual Payment ─────────────────────────────────────────────────────────
  registerModule('MANUAL_PAYMENT', {
    async execute(payload: ManualPaymentPayload, { tx, request, actor }) {
      await settlePaymentTx(tx, {
        memberId: payload.memberId,
        paymentLogId: payload.paymentLogId,
        total: new Prisma.Decimal(payload.total),
        breakdown: payload.breakdown,
        method: 'MANUAL',
      });

      // Manual reinstatement: approving a reinstatement payment returns the member
      // to ACTIVE standing and restores a terminated login (mirrors setMemberStatus).
      if (payload.reinstate) {
        const member = await tx.member.findUnique({ where: { id: payload.memberId }, select: { status: true, name: true, edirId: true, user: { select: { id: true, status: true } } } });
        if (member && member.status !== 'ACTIVE') {
          await tx.member.update({ where: { id: payload.memberId }, data: { status: 'ACTIVE' } });
          if (member.user?.id && member.user.status === 'TERMINATED') {
            await tx.user.update({ where: { id: member.user.id }, data: { status: 'ACTIVE', tokenVersion: { increment: 1 } } });
          }
          if (member.user?.id) {
            await tx.notification.create({
              data: { userId: member.user.id, edirId: member.edirId, type: 'member', priority: 'normal', title: 'Membership reinstated', body: 'Your membership is active again — welcome back.', linkUrl: '/dashboard/account' },
            });
          }
          await writeAudit({ edirId: request.edirId, userId: actor.id, action: 'MEMBER_REINSTATED', targetType: 'Member', targetId: payload.memberId, details: `${member.name}: reinstated on approved payment.` }, tx);
        }
      }

      // File the payment evidence (receipt/attachment) into the central document
      // repository as an APPROVED record, so it is findable long after approval.
      const log = await tx.paymentLog.findUnique({
        where: { id: payload.paymentLogId },
        select: { receiptUrl: true, transactionId: true, member: { select: { name: true, memberId: true } } },
      });
      if (log?.receiptUrl) {
        const req = await tx.approvalRequest.findUnique({ where: { id: request.id }, select: { makerId: true } });
        const fileName = log.receiptUrl.split('/').pop() ?? 'receipt';
        const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
        const now = new Date();
        await tx.dmsDocument.create({
          data: {
            edirId: request.edirId,
            title: `Payment receipt — ${log.member?.name ?? 'Member'}${log.member?.memberId ? ` (${log.member.memberId})` : ''}`,
            category: 'Payment Receipts',
            tags: 'payment,receipt,manual',
            purpose: `Evidence for manual payment ${log.transactionId}, approved via Maker–Checker.`,
            fileUrl: log.receiptUrl,
            fileName,
            fileType: ext === 'pdf' ? 'pdf' : 'image',
            status: 'APPROVED',
            visibility: 'staff',
            uploadedById: req?.makerId ?? actor.id,
            reviewedById: actor.id,
            approvedById: actor.id,
            reviewedAt: now,
            approvedAt: now,
          },
        });
      }
    },
    // Rejecting a manual payment voids its holding PaymentLog so it doesn't linger
    // in PENDING (it was never settled, so no money moved). This makes the
    // two-person rejection the clean close-out for a recorded payment.
    async onReject(payload: ManualPaymentPayload, { tx, actor, request, comment }) {
      const log = await tx.paymentLog.findUnique({ where: { id: payload.paymentLogId }, select: { status: true, description: true } });
      if (!log || log.status !== 'PENDING') return;
      let desc: any = {};
      try { desc = JSON.parse(log.description || '{}') || {}; } catch { desc = {}; }
      desc.voidReason = comment ? `Rejected: ${comment}` : 'Payment rejected by checker.';
      await tx.paymentLog.update({ where: { id: payload.paymentLogId }, data: { status: 'VOID', description: JSON.stringify(desc) } });
      await writeAudit({ edirId: request.edirId, userId: actor.id, action: 'PAYMENT_VOIDED', targetType: 'PaymentLog', targetId: payload.paymentLogId, details: 'Voided on rejected manual payment.' }, tx);
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

  // ── Member Status Change (manual suspend / terminate, checker-approved) ─────
  registerModule('MEMBER_STATUS_CHANGE', {
    async execute(payload: { memberId: string; status: 'SUSPENDED' | 'TERMINATED' }, { tx, request, actor }) {
      const member = await tx.member.findUnique({
        where: { id: payload.memberId },
        select: { status: true, name: true, edirId: true, user: { select: { id: true, status: true } } },
      });
      if (!member) throw new Error('Member not found — they may have been removed since this request was made.');
      if (member.status === payload.status) return; // already in the requested state

      await tx.member.update({ where: { id: payload.memberId }, data: { status: payload.status } });

      // Login-account consequences (mirrors the former direct setMemberStatus):
      //  • TERMINATED — block the login entirely and revoke active sessions.
      //  • SUSPENDED — login stays open on purpose: a suspended member signs in
      //    and pays their dues (incl. the reinstatement fee) to come back.
      if (payload.status === 'TERMINATED' && member.user?.id) {
        await tx.user.update({ where: { id: member.user.id }, data: { status: 'TERMINATED', tokenVersion: { increment: 1 } } });
      }

      // Tell the member what happened to their standing.
      if (member.user?.id) {
        const copy = payload.status === 'SUSPENDED'
          ? { title: 'Membership suspended', body: 'Your membership has been suspended. Please contact your Edir administrator for details.', priority: 'high' }
          : { title: 'Membership terminated', body: 'Your membership has been terminated. Please contact your Edir administrator for details.', priority: 'critical' };
        await tx.notification.create({
          data: { userId: member.user.id, edirId: member.edirId, type: 'member', ...copy, linkUrl: '/dashboard/account' },
        });
      }

      await writeAudit({
        edirId: request.edirId, userId: actor.id, action: 'MEMBER_STATUS_CHANGED', targetType: 'Member', targetId: payload.memberId,
        details: `${member.name}: ${member.status} → ${payload.status}${payload.status === 'TERMINATED' && member.user ? ' (login blocked)' : ''} — approved via Maker–Checker.`,
      }, tx);
    },
  });

  // ── Payment Void (checker-approved cancellation of a non-settled payment) ─────
  registerModule('PAYMENT_VOID', {
    async execute(payload: { paymentLogId: string; reason?: string | null }, { tx, request, actor }) {
      const log = await tx.paymentLog.findUnique({ where: { id: payload.paymentLogId }, select: { status: true, description: true } });
      if (!log) throw new Error('Payment not found — it may have been removed since this request was made.');
      // Settled payments moved money and must never be voided; already-void is a no-op.
      if (log.status === 'SUCCESS' || log.status === 'PARTIAL') throw new Error('This payment has since settled and can no longer be voided.');
      if (log.status === 'VOID') return;
      let desc: any = {};
      try { desc = JSON.parse(log.description || '{}') || {}; } catch { desc = {}; }
      if (payload.reason) desc.voidReason = payload.reason;
      await tx.paymentLog.update({ where: { id: payload.paymentLogId }, data: { status: 'VOID', description: JSON.stringify(desc) } });
      await writeAudit({
        edirId: request.edirId, userId: actor.id, action: 'PAYMENT_VOIDED', targetType: 'PaymentLog', targetId: payload.paymentLogId,
        details: `Voided via approval${payload.reason ? `: ${payload.reason}` : '.'}`,
      }, tx);
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

  // ── Relative / Dependent Document (maker–checker for upload, edit, delete) ─────
  registerModule('RELATIVE_DOCUMENT_ACTION', {
    async execute(payload: { documentId: string; action: string; changes?: any }, { tx, actor }) {
      const doc = await tx.relativeDocument.findUnique({
        where: { id: payload.documentId },
        include: { relative: { include: { member: { select: { edirId: true } } } } },
      });
      if (!doc) throw new Error('The document no longer exists.');
      const now = new Date();
      const stamp = { reviewedById: actor.id, approvedById: actor.id, reviewedAt: now, approvedAt: now, pendingAction: null, pendingPayload: Prisma.DbNull, rejectionReason: null };
      const changes = payload.changes ?? {};
      const edirId = doc.relative.member?.edirId ?? null;

      switch (payload.action) {
        case 'upload':
          await tx.relativeDocument.update({ where: { id: doc.id }, data: { ...stamp, status: 'APPROVED' } });
          // Archive the prior version so the newly-approved one becomes current.
          if (doc.supersedesId) {
            await tx.relativeDocument.update({ where: { id: doc.supersedesId }, data: { archivedAt: now } });
          }
          break;
        case 'edit':
          await tx.relativeDocument.update({
            where: { id: doc.id },
            data: { ...stamp, status: 'APPROVED', category: changes.category ?? doc.category, documentName: changes.documentName ?? doc.documentName, remarks: changes.remarks ?? doc.remarks },
          });
          break;
        case 'delete':
          await tx.relativeDocument.delete({ where: { id: doc.id } });
          break;
        default:
          throw new Error(`Unknown relative document action: ${payload.action}`);
      }

      if (doc.uploadedById && payload.action !== 'delete') {
        await tx.notification.create({
          data: {
            userId: doc.uploadedById, edirId, type: 'document', priority: 'normal',
            title: 'Document approved',
            body: `Your ${payload.action} request for "${doc.documentName || doc.fileName || 'document'}" was approved.`,
            linkUrl: '/dashboard/members', entityType: 'RelativeDocument',
          },
        });
      }
    },
    async onReject(payload: { documentId: string; action: string }, { tx, actor, comment }) {
      const doc = await tx.relativeDocument.findUnique({
        where: { id: payload.documentId },
        include: { relative: { include: { member: { select: { edirId: true } } } } },
      });
      if (!doc) return;
      const base = { reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: comment ?? null, pendingAction: null, pendingPayload: Prisma.DbNull };
      // A rejected initial upload becomes REJECTED; a rejected edit/delete just clears the pending flag.
      await tx.relativeDocument.update({
        where: { id: doc.id },
        data: payload.action === 'upload' ? { ...base, status: 'REJECTED' as const } : base,
      });
      if (doc.uploadedById) {
        await tx.notification.create({
          data: {
            userId: doc.uploadedById, edirId: doc.relative.member?.edirId ?? null, type: 'document', priority: 'normal',
            title: 'Document rejected',
            body: `Your ${payload.action} request for "${doc.documentName || doc.fileName || 'document'}" was rejected${comment ? `: ${comment}` : '.'}`,
            linkUrl: '/dashboard/members', entityType: 'RelativeDocument',
          },
        });
      }
    },
  });

  // ── Relationship Category (per-Edir family relationship config) ────────────────
  registerModule('RELATIONSHIP_CATEGORY', {
    async execute(payload: { categoryId: string; action: string; changes?: any }, { tx }) {
      const cat = await tx.relationshipCategory.findUnique({ where: { id: payload.categoryId } });
      if (!cat) throw new Error('The relationship category no longer exists.');
      const ALLOWED = ['name', 'description', 'isActive', 'benefitEligible', 'emergencyEligible', 'requiredDocuments', 'maxDependents'];
      switch (payload.action) {
        case 'create':
          // The row was provisionally created at submit time — approval just makes it live.
          await tx.relationshipCategory.update({ where: { id: cat.id }, data: { pendingAction: null, pendingPayload: Prisma.DbNull } });
          break;
        case 'edit': {
          const changes = payload.changes ?? {};
          const data: Record<string, any> = { pendingAction: null, pendingPayload: Prisma.DbNull };
          for (const [k, v] of Object.entries(changes)) if (ALLOWED.includes(k)) data[k] = v;
          await tx.relationshipCategory.update({ where: { id: cat.id }, data });
          break;
        }
        case 'delete':
          await tx.relationshipCategory.delete({ where: { id: cat.id } });
          break;
        default:
          throw new Error(`Unknown relationship category action: ${payload.action}`);
      }
    },
    async onReject(payload: { categoryId: string; action: string }, { tx }) {
      const cat = await tx.relationshipCategory.findUnique({ where: { id: payload.categoryId } });
      if (!cat) return;
      if (payload.action === 'create') {
        // A rejected create removes the provisional row entirely.
        await tx.relationshipCategory.delete({ where: { id: cat.id } });
      } else {
        await tx.relationshipCategory.update({ where: { id: cat.id }, data: { pendingAction: null, pendingPayload: Prisma.DbNull } });
      }
    },
  });

  // ── Rule Change (apply governance-setting or bylaw change + log the diff) ─────
  registerModule('RULE_CHANGE', {
    async execute(payload: any, { tx, request, actor }) {
      const edirId = request.edirId;

      // Bulk Edir-settings change submitted from the Rule Configuration Center
      // (e.g. by an Edir admin). Applies the full reviewed settings payload.
      if (payload.kind === 'SETTINGS_BULK') {
        const { buildEdirSettingsUpdate } = await import('@/lib/edir-settings');
        const update = buildEdirSettingsUpdate(payload.data);
        await tx.edirSettings.upsert({ where: { edirId }, update, create: { edirId, ...update } });
        const changes = Array.isArray(payload.changes) ? payload.changes : [];
        if (changes.length > 0) {
          await tx.ruleChangeLog.createMany({
            data: changes.map((c: any) => ({
              edirId, field: c.field, previousValue: String(c.previous), newValue: String(c.current),
              changedById: actor.id, comment: payload.reason ?? null,
            })),
          });
        }
        return;
      }

      // Edir branding (logo) change — applies the reviewed image and logs it.
      if (payload.kind === 'BRANDING') {
        await tx.edir.update({ where: { id: edirId }, data: { logoUrl: payload.newLogoUrl ?? null } });
        await tx.ruleChangeLog.create({
          data: {
            edirId, field: 'Edir logo',
            previousValue: payload.previousLogoUrl ?? '(none)',
            newValue: payload.newLogoUrl ?? '(removed)',
            changedById: actor.id, comment: payload.comment ?? null,
          },
        });
        return;
      }

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
    async execute(payload: { edirId: string; admin?: { name: string; email: string; phone: string } }, { tx, actor }) {
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

      // Default family relationship categories (idempotent) so the Edir starts with
      // a manageable, editable set rather than the hard-coded fallback.
      const catCount = await tx.relationshipCategory.count({ where: { edirId: edir.id } });
      if (catCount === 0) {
        const DEFAULT_CATEGORIES = [
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
        await tx.relationshipCategory.createMany({
          data: DEFAULT_CATEGORIES.map((c, i) => ({ edirId: edir.id, name: c.name, benefitEligible: c.benefitEligible, emergencyEligible: c.emergencyEligible, displayOrder: i })),
        });
      }

      // Provision the primary managing user (the Edir Admin login) captured at
      // registration. Older PENDING registrations have no admin payload — skip then.
      if (payload.admin?.email && payload.admin?.phone) {
        const email = payload.admin.email.toLowerCase().trim();
        const phone = payload.admin.phone;
        // Re-check uniqueness — the email/phone may have been taken between submit
        // and approval. On conflict, skip the user but still activate the Edir; the
        // Super-Admin can invite the admin manually from the Users page.
        const [emailTaken, phoneTaken] = await Promise.all([
          tx.user.findUnique({ where: { email }, select: { id: true } }),
          tx.user.findUnique({ where: { phone }, select: { id: true } }),
        ]);
        if (emailTaken || phoneTaken) {
          await writeAudit({
            edirId: edir.id, userId: actor.id, action: 'USER_INVITE_SKIPPED', targetType: 'Edir', targetId: edir.id,
            details: `Managing admin not provisioned for ${edir.name} — ${emailTaken ? 'email' : 'phone'} already in use (${email}).`,
          }, tx);
        } else {
          const adminRole = await tx.role.findFirst({ where: { edirId: edir.id, name: 'Edir Admin' }, select: { id: true } });
          const user = await tx.user.create({
            data: { name: payload.admin.name, email, phone, edirId: edir.id, roleId: adminRole?.id ?? null, status: 'INVITED', mustChangePassword: true },
          });
          // 48h single-use set-password token (reuses PasswordResetToken). Kept
          // inline on `tx` rather than the shared issueSetPasswordLink helper so the
          // token write stays inside this approval transaction (the helper uses the
          // global client and would commit the token even if the tx rolls back).
          const token = crypto.randomBytes(32).toString('hex');
          await tx.passwordResetToken.upsert({
            where: { email },
            update: { token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
            create: { email, token, expires: new Date(Date.now() + 48 * 60 * 60 * 1000) },
          });
          // Best-effort "account created, set your password" email (non-blocking).
          sendVerificationEmail({ to: email, name: payload.admin.name, token })
            .catch(err => console.error('Failed to send Edir admin invite email:', err));
          await writeAudit({
            edirId: edir.id, userId: actor.id, action: 'USER_INVITED', targetType: 'User', targetId: user.id,
            details: `Invited managing admin ${email} for ${edir.name}.`,
          }, tx);

          // Enroll the managing admin as a regular MEMBER of the new Edir too, so
          // they carry the same contribution obligations (monthly fees, penalties,
          // eligibility) as everyone else — their Edir Admin role simply adds the
          // administration capability on top. This Edir is brand-new, so the admin
          // is its first member (mirrors ensureMembershipForUser, done in-tx).
          const memberCount = await tx.member.count({ where: { edirId: edir.id } });
          const memberCode = `EDR-${new Date().getFullYear()}-${String(memberCount + 1).padStart(4, '0')}`;
          const settingsRow = await tx.edirSettings.findUnique({ where: { edirId: edir.id }, select: { registrationFee: true } });
          const regFee = settingsRow?.registrationFee ?? new Prisma.Decimal(0);
          await tx.member.create({
            data: {
              edirId: edir.id, memberId: memberCode, userId: user.id,
              name: payload.admin.name, phone, email,
              role: 'Member', status: 'ACTIVE', firstContributionAtJoin: true,
              paymentStatus: { create: { balance: regFee, status: regFee.greaterThan(0) ? 'PENDING' : 'PAID' } },
            },
          });
        }
      }
    },
    // A rejected registration is terminal: close the provisional Edir so it can
    // never be operated or accept payments. The registration surfaces show the
    // rejection (and its reason) from the approval request itself.
    async onReject(payload: { edirId: string }, { tx, actor, comment }) {
      const edir = await tx.edir.findUnique({ where: { id: payload.edirId }, select: { id: true, name: true, status: true } });
      if (!edir || edir.status !== 'PENDING') return;
      await tx.edir.update({ where: { id: edir.id }, data: { status: 'CLOSED' } });
      await writeAudit({
        edirId: edir.id, userId: actor.id, action: 'EDIR_REGISTRATION_REJECTED', targetType: 'Edir', targetId: edir.id,
        details: `Registration of "${edir.name}" rejected${comment ? `: ${comment}` : '.'}`,
      }, tx);
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

  // ── User Creation (create User + hashed password) ─────────────────────────────
  registerModule('USER_CREATION', {
    async execute(payload: { edirId: string; email: string; phone: string; name: string; roleId: string }, { tx }) {
      const hashedPassword = await bcrypt.hash(generateTempPassword(), 12);
      // User.edirId IS the association; membership records are ensured by the
      // user-management flows (ensureMembershipForUser) outside this transaction.
      await tx.user.create({
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
    },
  });
}

ensureApprovalModules();

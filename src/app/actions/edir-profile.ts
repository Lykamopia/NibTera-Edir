'use server';

import prisma from '@/lib/prisma';
import { getActor, actorHasPermission, assertSameTenant } from '@/lib/tenant-scope';
import { AccessDeniedError } from '@/lib/errors';

const num = (v: unknown) => Number(v ?? 0);

/** Derive a coarse file type from a filename/URL for preview purposes. */
function fileTypeOf(nameOrUrl: string | null | undefined): 'image' | 'pdf' | 'file' {
  const s = (nameOrUrl || '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(s)) return 'image';
  if (s.endsWith('.pdf')) return 'pdf';
  return 'file';
}

/** Is the actor an oversight role (platform / district / branch) able to see all Edir tabs? */
function isOversight(actor: Awaited<ReturnType<typeof getActor>>): boolean {
  return actor.isSuperAdmin
    || actorHasPermission(actor, ['manage_edirs', 'view_districts', 'manage_districts', 'view_branches', 'manage_branches', 'view_edir_reports']);
}

/**
 * Complete profile snapshot for a single Edir — the data behind the dedicated
 * Edir Details page (overview, stats, people, rules, documents, audit, and the
 * maker-checker registration status). Access is gated by permission AND tenant
 * scope; tab visibility is returned as `caps` for role-based rendering.
 */
export async function getEdirProfile(edirId: string) {
  const actor = await getActor();

  const oversight = isOversight(actor);
  const ownEdir = actor.edirId === edirId;
  const allowed = oversight
    || actorHasPermission(actor, ['approve_edir_registration', 'register_edir'])
    || (ownEdir && actorHasPermission(actor, ['manage_edir_settings', 'view_members', 'view_dashboard']));
  if (!allowed) throw new AccessDeniedError();
  // Enforce tenant scope (head-office/super pass; branch/district/edir checked).
  await assertSameTenant(actor, edirId);

  const edir = await prisma.edir.findUnique({
    where: { id: edirId },
    include: {
      settings: true,
      branch: { select: { id: true, name: true, code: true, district: { select: { id: true, name: true } } } },
      _count: { select: { members: true, users: true } },
    },
  });
  if (!edir) return null;

  const [
    membersByStatus,
    paymentsByStatus,
    recentPayments,
    outstanding,
    emergencies,
    assetAgg,
    documents,
    people,
    rules,
    recentActivity,
    approval,
  ] = await Promise.all([
    prisma.member.groupBy({ by: ['status'], where: { edirId }, _count: { _all: true } }),
    prisma.paymentLog.groupBy({ by: ['status'], where: { edirId }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.paymentLog.findMany({
      where: { edirId }, orderBy: { createdAt: 'desc' }, take: 6,
      select: { id: true, amount: true, status: true, method: true, createdAt: true, member: { select: { name: true, memberId: true } } },
    }),
    prisma.paymentStatus.aggregate({ where: { member: { edirId } }, _sum: { balance: true } }),
    prisma.emergencyClaim.groupBy({ by: ['status'], where: { edirId }, _count: { _all: true } }),
    prisma.asset.aggregate({ where: { edirId }, _count: { _all: true }, _sum: { currentValue: true, quantity: true } }),
    prisma.dmsDocument.findMany({
      where: { edirId }, orderBy: { createdAt: 'desc' }, take: 60,
      select: { id: true, title: true, category: true, fileName: true, fileUrl: true, fileType: true, status: true, visibility: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { edirId }, orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, status: true, role: { select: { name: true, permissions: true } } },
    }),
    prisma.rulesVersion.findFirst({
      where: { edirId }, orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true, title: true, status: true, effectiveDate: true, updatedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { edirId, archived: false }, orderBy: { createdAt: 'desc' }, take: 15,
      select: { id: true, action: true, details: true, createdAt: true, user: { select: { name: true, email: true } } },
    }),
    prisma.approvalRequest.findFirst({
      where: { edirId, module: 'EDIR_REGISTRATION' }, orderBy: { createdAt: 'desc' },
      include: {
        maker: { select: { name: true, email: true } },
        checker: { select: { name: true, email: true } },
        events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, email: true } } } },
      },
    }),
  ]);

  const activeMembers = membersByStatus.find(m => m.status === 'ACTIVE')?._count._all ?? 0;
  const collected = paymentsByStatus
    .filter(p => p.status === 'SUCCESS' || p.status === 'PARTIAL')
    .reduce((s, p) => s + num(p._sum.amount), 0);
  const transactions = paymentsByStatus.reduce((s, p) => s + p._count._all, 0);

  const has = (perms: Parameters<typeof actorHasPermission>[1]) => actorHasPermission(actor, perms);

  // Identify administrators and committee members from their role permissions.
  const hasPerm = (csv: string | undefined, ...needles: string[]) => {
    const set = (csv ?? '').split(',').map(p => p.trim());
    return needles.some(n => set.includes(n));
  };
  const admins = people
    .filter(u => hasPerm(u.role?.permissions, 'super_admin', 'manage_edir_settings', 'manage_users'))
    .map(u => ({ id: u.id, name: u.name, email: u.email, roleName: u.role?.name ?? null, status: u.status }));
  const committee = people
    .filter(u => hasPerm(u.role?.permissions, 'view_committee_oversight') && !hasPerm(u.role?.permissions, 'super_admin'))
    .map(u => ({ id: u.id, name: u.name, email: u.email, roleName: u.role?.name ?? null, status: u.status }));

  // Documents — DMS records plus the registration agreement document (surfaced
  // here with inline preview instead of being buried in the registration record).
  const docs = documents.map(d => ({
    id: d.id, title: d.title, category: d.category, fileName: d.fileName, fileUrl: d.fileUrl,
    fileType: d.fileType || fileTypeOf(d.fileName), status: String(d.status), visibility: d.visibility,
    createdAt: d.createdAt, isAgreement: false,
  }));
  if (edir.agreementDocUrl && !docs.some(d => d.fileUrl === edir.agreementDocUrl)) {
    docs.unshift({
      id: 'agreement', title: 'Registration Agreement', category: 'Agreement',
      fileName: edir.agreementDocUrl.split('/').pop() || 'agreement',
      fileUrl: edir.agreementDocUrl, fileType: fileTypeOf(edir.agreementDocUrl),
      status: 'APPROVED', visibility: 'staff', createdAt: edir.createdAt, isAgreement: true,
    });
  }

  return {
    id: edir.id,
    name: edir.name,
    description: edir.description,
    status: edir.status,
    logoUrl: edir.logoUrl,
    accountNumber: edir.accountNumber,
    address: edir.address,
    branchName: edir.branch?.name ?? null,
    branchCode: edir.branch?.code ?? null,
    districtName: edir.branch?.district?.name ?? null,
    contactPersonName: edir.contactPersonName,
    contactAddress: edir.contactAddress,
    contactMobile: edir.contactMobile,
    contactEmail: edir.contactEmail,
    agreementDocUrl: edir.agreementDocUrl,
    createdAt: edir.createdAt,
    settings: edir.settings ? {
      monthlyFee: num(edir.settings.monthlyFee),
      registrationFee: num(edir.settings.registrationFee),
      currency: edir.settings.currency,
      dueDay: edir.settings.dueDay,
      gracePeriodDays: edir.settings.gracePeriodDays,
    } : null,
    stats: {
      members: edir._count.members,
      activeMembers,
      users: edir._count.users,
      collected,
      transactions,
      outstanding: num(outstanding._sum.balance),
      emergencies: emergencies.reduce((s, e) => s + e._count._all, 0),
      assets: assetAgg._count._all,
      assetValue: num(assetAgg._sum.currentValue),
      assetQuantity: num(assetAgg._sum.quantity),
      documents: docs.length,
    },
    admins,
    committee,
    rules: rules ? {
      versionNumber: rules.versionNumber, title: rules.title,
      status: String(rules.status), effectiveDate: rules.effectiveDate, updatedAt: rules.updatedAt,
    } : null,
    documents: docs,
    recentActivity: recentActivity.map(a => ({
      id: a.id, action: a.action, details: a.details, createdAt: a.createdAt,
      actorName: a.user?.name ?? a.user?.email ?? 'System',
    })),
    recentPayments: recentPayments.map(p => ({
      id: p.id, amount: num(p.amount), status: String(p.status), method: p.method, createdAt: p.createdAt,
      memberName: p.member?.name ?? null, memberId: p.member?.memberId ?? null,
    })),
    approval: approval ? {
      status: String(approval.status),
      createdAt: approval.createdAt,
      makerName: approval.maker?.name ?? approval.maker?.email ?? null,
      checkerName: approval.checker?.name ?? approval.checker?.email ?? null,
      events: approval.events.map(e => ({
        id: e.id, type: String(e.type), comment: e.comment, createdAt: e.createdAt,
        actorName: e.actor?.name ?? e.actor?.email ?? 'Unknown',
      })),
    } : null,
    caps: {
      canEdit: has(['edit_edir', 'manage_edirs', 'super_admin']),
      canViewMembers: oversight || has(['view_members', 'manage_members']),
      canViewPayments: oversight || has(['view_payments', 'view_payment_log', 'record_payment']),
      canViewEmergencies: oversight || has(['view_emergencies', 'manage_emergencies']),
      canViewAssets: oversight || has(['view_assets', 'manage_assets']),
      canViewDocuments: oversight || has(['view_documents', 'upload_document', 'approve_document', 'review_document']),
      canViewReports: oversight || has(['view_edir_reports', 'view_committee_oversight']),
      canViewSettings: oversight || has(['manage_edir_settings', 'manage_committee']),
      canViewAudit: oversight || has(['view_audit_log', 'view_payment_log']),
    },
  };
}

export type EdirProfile = NonNullable<Awaited<ReturnType<typeof getEdirProfile>>>;

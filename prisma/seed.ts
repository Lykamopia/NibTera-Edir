import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Full Edir permission catalog (mirrors src/lib/permissions.ts). Inlined so the
// seed has no path-alias dependency under ts-node.
const EDIR_PERMISSIONS = [
  'view_dashboard', 'view_committee_oversight',
  'view_members', 'manage_members', 'remove_members', 'approve_member_removal', 'review_member_documents',
  'view_payments', 'record_payment', 'approve_payment', 'waive_penalty', 'approve_penalty_waiver', 'void_payment',
  'view_approvals',
  'view_emergencies', 'manage_emergencies', 'approve_emergency_claim', 'approve_emergency_disbursement',
  'view_events', 'manage_events', 'finalize_attendance',
  'view_assets', 'manage_assets', 'manage_asset_categories', 'approve_asset_issuance',
  'view_rules', 'manage_rules', 'approve_rule_change',
  'view_audit_log', 'view_payment_log', 'manage_audit_log',
  'handle_member_requests',
  'manage_edir_settings', 'manage_committee',
  'view_users', 'manage_users', 'view_roles', 'manage_roles', 'reset_password', 'lock_user', 'unlock_user',
];

async function main() {
  console.log('Resetting Edir demo data…');
  // Order respects FKs (children first).
  await prisma.approvalEvent.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.installment.deleteMany();
  await prisma.installmentPlan.deleteMany();
  await prisma.paymentLog.deleteMany();
  await prisma.paymentStatus.deleteMany();
  await prisma.relativeDocument.deleteMany();
  await prisma.relative.deleteMany();
  await prisma.eventParticipant.deleteMany();
  await prisma.event.deleteMany();
  await prisma.emergencyNote.deleteMany();
  await prisma.emergencyClaim.deleteMany();
  await prisma.emergencyType.deleteMany();
  await prisma.assetIssuance.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.assetCategory.deleteMany();
  await prisma.member.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.ruleChangeLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.edirSettings.deleteMany();
  await prisma.edir.deleteMany();

  const password = process.env.ADMIN_PASSWORD || 'Password123';
  const hashed = await bcrypt.hash(password, 10);

  // ── Tenant ──────────────────────────────────────────────────────────────
  const edir = await prisma.edir.create({ data: { name: 'Demo Edir', description: 'Seeded demonstration association.' } });
  await prisma.edirSettings.create({
    data: {
      edirId: edir.id, monthlyFee: 200, registrationFee: 1000, currency: 'ETB', dueDay: 5, gracePeriodDays: 5,
      emergencyReserve: 50000, minMembershipMonths: 3, reinstatementFee: 250,
      penaltyTiers: [
        { id: 'tier-1', label: '6–15 days late', fromDays: 6, toDays: 15, type: 'FIXED', value: 25 },
        { id: 'tier-2', label: '16–30 days late', fromDays: 16, toDays: 30, type: 'FIXED', value: 50 },
        { id: 'tier-3', label: '31 days and beyond', fromDays: 31, toDays: null, type: 'PERCENT', value: 5 },
      ],
    },
  });

  // ── Emergency payout types ────────────────────────────────────────────────
  await prisma.emergencyType.createMany({
    data: [
      { edirId: edir.id, name: 'Death in Family', description: 'Death of a registered member or immediate family member.', basePayout: 10000, documentationRequired: true, requiredDocuments: 'Death certificate', requiresApproval: true, eligibilityMonths: 3 },
      { edirId: edir.id, name: 'Serious Illness', description: 'Hospitalization or major medical treatment.', basePayout: 5000, documentationRequired: true, requiredDocuments: 'Hospital records', waitingPeriodDays: 7, eligibilityMonths: 3 },
      { edirId: edir.id, name: 'Natural Disaster', description: 'Loss from fire, flood, or other disaster.', basePayout: 7000, documentationRequired: false, eligibilityMonths: 1 },
      { edirId: edir.id, name: 'Accident', description: 'Injury or loss from an accident.', basePayout: 4000, documentationRequired: true, requiredDocuments: 'Police/medical report' },
    ],
  });

  // ── Roles ───────────────────────────────────────────────────────────────
  const superRole = await prisma.role.create({ data: { name: 'Super Admin', scope: 'SUPER_ADMIN', permissions: 'super_admin', edirId: null } });
  const adminRole = await prisma.role.create({ data: { name: 'Edir Admin', scope: 'EDIR', permissions: EDIR_PERMISSIONS.join(','), edirId: edir.id } });
  const memberRole = await prisma.role.create({ data: { name: 'Member', scope: 'EDIR', permissions: ['view_dashboard'].join(','), edirId: edir.id } });
  const committeeRole = await prisma.role.create({ data: { name: 'Committee (Oversight)', scope: 'EDIR', permissions: ['view_dashboard', 'view_committee_oversight', 'view_members', 'view_payments', 'view_audit_log', 'view_payment_log', 'view_approvals'].join(','), edirId: edir.id } });

  // ── Users (maker + checker share the admin role) ──────────────────────────
  const superEmail = process.env.ADMIN_EMAIL || 'superadmin@edir.local';
  await prisma.user.create({ data: { name: 'Super Admin', email: superEmail.toLowerCase(), phone: '251900000000', edirId: null, roleId: superRole.id, status: 'ACTIVE', hashedPassword: hashed, onboardingCompleted: true } });
  const abel = await prisma.user.create({ data: { name: 'Abel (Maker)', email: 'abel@edir.local', phone: '251911111111', edirId: edir.id, roleId: adminRole.id, status: 'ACTIVE', hashedPassword: hashed, onboardingCompleted: true } });
  const bru = await prisma.user.create({ data: { name: 'Bru (Checker)', email: 'bru@edir.local', phone: '251922222222', edirId: edir.id, roleId: adminRole.id, status: 'ACTIVE', hashedPassword: hashed, onboardingCompleted: true } });
  await prisma.user.create({ data: { name: 'Hana (Committee)', email: 'hana@edir.local', phone: '251933333333', edirId: edir.id, roleId: committeeRole.id, status: 'ACTIVE', hashedPassword: hashed, onboardingCompleted: true } });

  // ── Rules & Bylaws (approved v1) ───────────────────────────────────────────
  await prisma.rulesVersion.create({
    data: {
      edirId: edir.id, versionNumber: 1, title: 'Edir Rules & Bylaws', status: 'APPROVED',
      authorId: abel.id, approverId: bru.id, approvedAt: new Date(), effectiveDate: new Date(),
      changeSummary: 'Initial published rules.',
      content: [
        '<h1>Edir Rules &amp; Bylaws</h1>',
        '<h2>Article 1 — Membership</h2>',
        '<p>Membership is open to community residents who pay the registration fee and agree to abide by these rules. Members in good standing are eligible for emergency benefits after the minimum membership period.</p>',
        '<h2>Article 2 — Monthly Contributions</h2>',
        '<p>Every member shall pay the monthly contribution by the due day. Late payments are subject to the configured penalty tiers.</p>',
        '<h2>Article 3 — Emergency Benefits</h2>',
        '<ol><li>Death in family</li><li>Serious illness</li><li>Natural disaster</li><li>Accident</li></ol>',
        '<p>Claims are reviewed and approved through a maker–checker process before any payout is disbursed.</p>',
        '<h2>Article 4 — Suspension &amp; Termination</h2>',
        '<p>Members who fall behind on contributions beyond the configured thresholds may be suspended or terminated. Reinstatement requires settling arrears and paying the reinstatement fee.</p>',
      ].join(''),
    },
  });

  // ── Bylaws ────────────────────────────────────────────────────────────────
  await prisma.bylaw.createMany({
    data: [
      { edirId: edir.id, section: 'Article 1', title: 'Membership', content: 'Membership is open to residents of the community who pay the registration fee and agree to abide by these bylaws.', order: 0 },
      { edirId: edir.id, section: 'Article 2', title: 'Monthly Contributions', content: 'Every member shall pay the monthly contribution by the due day. Late payment is subject to the configured penalty.', order: 1 },
      { edirId: edir.id, section: 'Article 3', title: 'Attendance', content: 'Members are expected to attend events marked as mandatory. Unexcused absence is subject to the absence penalty.', order: 2 },
    ],
  });

  // ── Assets ────────────────────────────────────────────────────────────────
  const tentCat = await prisma.assetCategory.create({ data: { edirId: edir.id, name: 'Tents & Shelter' } });
  const kitchenCat = await prisma.assetCategory.create({ data: { edirId: edir.id, name: 'Kitchen & Catering' } });
  await prisma.asset.createMany({
    data: [
      { edirId: edir.id, categoryId: tentCat.id, name: 'Large Tent', purchaseValue: 25000, currentValue: 18000, quantity: 4, compensationCost: 20000, location: 'Store A' },
      { edirId: edir.id, categoryId: kitchenCat.id, name: 'Cooking Pot (large)', purchaseValue: 3000, currentValue: 2200, quantity: 10, compensationCost: 2500, location: 'Store B' },
      { edirId: edir.id, categoryId: kitchenCat.id, name: 'Plastic Chairs', purchaseValue: 250, currentValue: 150, quantity: 200, compensationCost: 200, location: 'Store B' },
    ],
  });

  // ── Members ───────────────────────────────────────────────────────────────
  const year = new Date().getFullYear();
  const memberData = [
    { name: 'Mekdes Alemu', phone: '251933000001', occupation: 'Teacher' },
    { name: 'Yonas Tadesse', phone: '251933000002', occupation: 'Driver' },
    { name: 'Saba Girma', phone: '251933000003', occupation: 'Nurse' },
  ];
  let i = 0;
  for (const m of memberData) {
    i += 1;
    await prisma.member.create({
      data: {
        edirId: edir.id,
        memberId: `EDR-${year}-${String(i).padStart(4, '0')}`,
        name: m.name, phone: m.phone, occupation: m.occupation,
        role: 'Member', status: 'ACTIVE',
        paymentStatus: { create: { balance: 1000, status: 'PENDING' } },
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  Super Admin: ${superEmail} (phone 251900000000)`);
  console.log('  Maker: abel@edir.local (phone 251911111111)');
  console.log('  Checker: bru@edir.local (phone 251922222222)');
  console.log('  Committee: hana@edir.local (phone 251933333333)');
  console.log(`  Password: ${password}`);
  void memberRole;
}

main()
  .catch((e) => { console.error('Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

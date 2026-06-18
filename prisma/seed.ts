
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const offices = [
  { id: 'off-1', name: 'Head Office', code: 'HO', type: 'division_office' },
];

const roles = [
  {
    id: 'role-1',
    name: 'Admin',
    permissions: [
      'view_dashboard',
      'view_offices', 'manage_offices', 'import_offices',
      'view_branches', 'manage_branches', 'import_branches',
      'view_districts', 'manage_districts', 'import_districts',
      'view_departments', 'manage_departments', 'import_departments',
      'view_divisions', 'manage_divisions', 'import_divisions',
      'view_users', 'manage_users', 'import_users',
      'view_roles', 'manage_roles',
      'view_security_logs', 'manage_security_logs',
      'lock_user', 'unlock_user', 'reset_password',
      'manage_audit_logs',
      'view_reports', 'view_all_reports',
      'view_plans', 'create_plans', 'approve_plans_head_office',
      'allocate_plans_to_districts', 'approve_district_allocations',
      'allocate_district_plans_to_branches', 'approve_branch_allocations',
      'view_leads', 'create_leads', 'manage_leads', 'assign_leads', 'update_assigned_leads',
      'view_jobs', 'manage_jobs', 'submit_jobs',
      'view_customers', 'manage_customers',
      'view_customer_visits',
      'view_daily_targets', 'import_daily_targets',
      'manage_branch_allocations',
      'manage_public_holidays',
      'manage_kpi_config',
      'manage_gps_verification',
      'view_performance',
      'view_rm_report',
    ].join(','),
  },
  {
    id: 'role-director',
    name: 'Director',
    permissions: [
      'view_dashboard',
      'view_offices',
      'view_branches',
      'view_districts',
      'view_departments',
      'view_divisions',
      'view_users',
      'view_roles',
    ].join(','),
  },
  {
    id: 'role-chief',
    name: 'Chief',
    permissions: [
      'view_dashboard',
      'view_offices',
      'view_branches',
      'view_districts',
      'view_departments',
      'view_divisions',
      'view_users',
    ].join(','),
  },
  {
    id: 'role-2',
    name: 'Member',
    permissions: [
      'view_dashboard',
    ].join(',')
  },

  // ─── District Manager ────────────────────────────────────────────────────────
  // Assigned districtId on User. Sees only active plans assigned to their district.
  // Breaks allocated totals into monthly targets and distributes to branches.
  // Reviews and approves achievement submissions from all branches in the district.
  {
    id: 'role-district-manager',
    name: 'District Manager',
    permissions: [
      'view_dashboard',

      // Plans — district receives allocation, sets monthly breakdown, allocates to branches
      'manage_branch_allocations',        // set monthly breakdown + allocate to branches
      'approve_branch_allocations',       // approve staff achievement submissions
      'view_daily_targets',               // view staff daily targets/achievements

      // Reports
      'view_reports',
      'view_performance',

      // Jobs & Leads
      'view_jobs',
      'manage_jobs',
      'view_leads',

      // Customers
      'view_customers',
      'view_customer_visits',

      // RM Report
      'view_rm_report',
    ].join(','),
  },

  // ─── Branch Manager ──────────────────────────────────────────────────────────
  // Assigned branchId on User. Receives monthly targets from district.
  // Assigns daily targets to individual staff members.
  // Reviews and approves achievement submissions from their branch staff.
  {
    id: 'role-branch-manager',
    name: 'Branch Manager',
    permissions: [
      'view_dashboard',

      // Plans — branch receives allocation, assigns daily targets to staff
      'manage_branch_allocations',        // assign daily targets to staff
      'approve_branch_allocations',       // approve staff achievement submissions
      'view_daily_targets',               // view staff daily targets/achievements
      'import_daily_targets',             // bulk-import daily targets from Excel

      // Reports
      'view_reports',
      'view_performance',

      // Jobs & Leads
      'view_jobs',
      'manage_jobs',
      'view_leads',
      'assign_leads',

      // Customers
      'view_customers',
      'view_customer_visits',
      'manage_customers',

      // RM Report
      'view_rm_report',
    ].join(','),
  },

  // ─── Sales Staff ─────────────────────────────────────────────────────────────
  // Assigned branchId on User. Sees their own daily targets.
  // Submits daily achievement progress for manager approval.
  {
    id: 'role-sales-staff',
    name: 'Sales Staff',
    permissions: [
      'view_dashboard',

      // Daily targets — view assigned targets, submit achievements for approval
      'view_daily_targets',

      // Jobs & Leads
      'view_jobs',
      'submit_jobs',
      'view_leads',
      'update_assigned_leads',

      // Customers
      'view_customers',
      'view_customer_visits',

      // Reports — basic own-performance visibility
      'view_reports',
      'view_performance',
    ].join(','),
  },
];

async function main() {
  console.log('Cleaning database for production deployment...');
  
  // Cleanup in reverse order of relations (based on current schema)
  await prisma.passwordResetToken.deleteMany();
  
  // Clear all gamification models first
  await prisma.leaderboardEntry.deleteMany();
  await prisma.leaderboardSnapshot.deleteMany();
  await prisma.pointTransaction.deleteMany();
  await prisma.earnedBadge.deleteMany();
  await prisma.badge.deleteMany();
  await prisma.gamificationProfile.deleteMany();
  
  // Clear sales models
  await prisma.salesOfficerDailyAchievement.deleteMany();
  await prisma.salesOfficerDailyTarget.deleteMany();
  await prisma.branchPlanTarget.deleteMany();
  await prisma.districtMonthlyTarget.deleteMany();
  await prisma.districtPlanTarget.deleteMany();
  await prisma.planAssignment.deleteMany();
  await prisma.planTarget.deleteMany();
  await prisma.planMetric.deleteMany();
  await prisma.plan.deleteMany();
  
  // Clear customer visit models
  await prisma.gPSVerification.deleteMany();
  await prisma.customerInteraction.deleteMany();
  await prisma.customerVisit.deleteMany();
  await prisma.customer.deleteMany();
  
  // Clear job/lead models
  await prisma.jobApprovalHistory.deleteMany();
  await prisma.jobKpiValue.deleteMany();
  await prisma.job.deleteMany();
  await prisma.leadAssignmentHistory.deleteMany();
  await prisma.leadKpi.deleteMany();
  await prisma.lead.deleteMany();
  
  // Clear other models
  await prisma.publicHoliday.deleteMany();
  await prisma.securityLog.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.setting.deleteMany();
  
  // Clear user and structural models
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.division.deleteMany();
  await prisma.district.deleteMany();
  await prisma.department.deleteMany();
  await prisma.office.deleteMany();
  
  console.log('Cleared all existing data.');

  // Seed essential structural data
  await prisma.office.createMany({ data: offices });
  console.log(`Seeded production-ready office structure.`);

  await prisma.role.createMany({ data: roles });
  console.log(`Seeded system roles.`);

  // Seed Primary Admin User from environment variables
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error('CRITICAL: Please set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file before seeding for production.');
  }

  console.log(`Creating primary system administrator: ${adminEmail}...`);
  
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const adminUser = await prisma.user.create({
      data: {
          id: 'user-admin',
          name: 'System Administrator',
          email: adminEmail,
          hashedPassword: hashedPassword,
          roleId: 'role-1',
          officeId: 'off-1',
          onboardingCompleted: true,
          status: 'active',
      }
  });
  
  console.log(`Primary Administrator "${adminUser.name}" created successfully.`);
  console.log('Production seeding finished. You can now log in and begin organizational setup.');
}

main()
  .catch((e) => {
    console.error('Error during production seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

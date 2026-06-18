
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const allPermissions = [
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
  'adjust_kpi',
];

async function main() {
  console.log('Updating Admin role with all permissions...');

  const updatedRole = await prisma.role.update({
    where: { id: 'role-1' },
    data: {
      permissions: allPermissions.join(','),
    },
  });

  console.log('Admin role updated successfully!');
  console.log(`Permissions set: ${updatedRole.permissions}`);
}

main()
  .catch((e) => {
    console.error('Error updating Admin role:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

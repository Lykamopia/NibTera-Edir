import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rolesToUpdate = [
  {
    id: 'role-1',
    name: 'Admin',
    permissions: [
      'manage_memos',
      'manage_general_settings',
      'manage_email_settings',
      'manage_divisions',
      'manage_departments',
      'manage_branches',
      'manage_districts',
      'manage_offices',
      'manage_users',
      'manage_roles',
      'manage_archive',
      'manage_labels',
      'manage_audit_log',
      'manage_security_logs',
      'view_reports',
      'view_all_reports',
    ].join(','),
  },
  {
    id: 'role-director',
    name: 'Director',
    permissions: ['manage_memos', 'manage_archive', 'manage_audit_log', 'view_reports', 'view_all_reports'].join(','),
  },
  {
    id: 'role-chief',
    name: 'Chief',
    permissions: ['manage_memos', 'manage_archive', 'view_reports', 'view_all_reports'].join(','),
  },
  { id: 'role-2', name: 'Member', permissions: ['manage_memos', 'view_reports'].join(',') },
];

async function main() {
  console.log('Starting safe role update...');

  for (const role of rolesToUpdate) {
    console.log(`Updating permissions for role: ${role.name} (${role.id})...`);
    
    await prisma.role.upsert({
      where: { id: role.id },
      update: {
        permissions: role.permissions,
        name: role.name, // Ensure name is also correct
      },
      create: {
        id: role.id,
        name: role.name,
        permissions: role.permissions,
      },
    });
  }

  console.log('Role updates completed successfully. No data was deleted.');
}

main()
  .catch((e) => {
    console.error('Error during role update:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

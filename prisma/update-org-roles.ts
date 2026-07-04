/**
 * Backfill: merge the user-management permissions into the existing default
 * District/Branch roles (District Manager/Operator, Branch Manager/Operator).
 * New districts/branches already get these via provisionDistrictRoles /
 * provisionBranchRoles — this script upgrades roles created before that change.
 * Purely additive: existing permissions are preserved (set union).
 *
 * Run with:  npx tsx prisma/update-org-roles.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ADDITIONS: { name: string; scope: 'DISTRICT' | 'BRANCH'; add: string[] }[] = [
  { name: 'District Manager', scope: 'DISTRICT', add: ['view_users', 'manage_users', 'reset_password', 'lock_user', 'unlock_user'] },
  { name: 'District Operator', scope: 'DISTRICT', add: ['view_users'] },
  { name: 'Branch Manager', scope: 'BRANCH', add: ['view_users', 'manage_users', 'reset_password', 'lock_user', 'unlock_user'] },
  { name: 'Branch Operator', scope: 'BRANCH', add: ['view_users'] },
];

async function main() {
  console.log('Backfilling user-management permissions on org roles…');
  for (const def of ADDITIONS) {
    const roles = await prisma.role.findMany({ where: { name: def.name, scope: def.scope } });
    for (const role of roles) {
      const current = role.permissions.split(',').map(p => p.trim()).filter(Boolean);
      const merged = Array.from(new Set([...current, ...def.add]));
      if (merged.length === current.length) {
        console.log(`  ${def.name} (${role.id}): already up to date.`);
        continue;
      }
      await prisma.role.update({ where: { id: role.id }, data: { permissions: merged.join(',') } });
      console.log(`  ${def.name} (${role.id}): +${merged.length - current.length} permission(s).`);
    }
  }
  console.log('Done. No permissions were removed.');
}

main()
  .catch((e) => {
    console.error('Error during org-role backfill:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

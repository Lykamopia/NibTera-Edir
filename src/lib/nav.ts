import { pagePermissions, PAGE_SECTIONS, type PagePermissionDef } from '@/lib/permissions';
import type { Permission } from '@/lib/types';

// Pages with a real UI in this iteration. Nav only renders these so there are no
// dead links; deferred modules are added here as they are built.
export const IMPLEMENTED_PAGES = new Set<string>([
  'dashboard',
  'members',
  'payments',
  'approvals',
  'member-requests',
  'emergencies',
  'events',
  'assets',
  'rules',
  'committee',
  'audit',
  'payment-log',
  'admin-users',
  'admin-roles',
  'admin-settings',
  'system-edirs',
]);

export interface NavItem extends PagePermissionDef {}
export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

/** Build the visible, permission-filtered navigation grouped by section. */
export function buildNav(permissions: Permission[], isSuperAdmin: boolean): NavSection[] {
  const has = (perms: Permission[]) => isSuperAdmin || perms.some(p => permissions.includes(p));

  return PAGE_SECTIONS.map(section => ({
    id: section.id,
    label: section.label,
    items: pagePermissions.filter(
      p => p.section === section.id && IMPLEMENTED_PAGES.has(p.id) && has(p.accessPermissions),
    ),
  })).filter(s => s.items.length > 0);
}

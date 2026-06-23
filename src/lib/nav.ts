import { pagePermissions, PAGE_SECTIONS, type PagePermissionDef } from '@/lib/permissions';
import type { Permission } from '@/lib/types';

// Pages with a real UI in this iteration. Nav only renders these so there are no
// dead links; deferred modules are added here as they are built.
export const IMPLEMENTED_PAGES = new Set<string>([
  'dashboard',
  'people', // unified Members + Users + Associations (adapts to role)
  'payments',
  'approvals',
  'edir-registration', // Unified Edir management: browse directory, register new, track submissions
  'member-requests',
  'emergencies',
  'events',
  'assets',
  'rules',
  'committee',
  'documents',
  'audit',
  'payment-log',
  'admin-roles',
  'admin-settings',
  'system-districts', // District management (Super Admin / DISTRICT scope)
  'system-branches', // Branch management (Super Admin / DISTRICT scope)
  'system-associations', // standalone access for limited platform roles (manage_associations)
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

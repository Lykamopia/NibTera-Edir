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
  // 'system-associations' retired — user creation/association now lives on the People page.
]);

export interface NavItem extends PagePermissionDef {}
export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

// Edir-operational pages a platform Super-Admin should NOT see. Edir-specific
// operations (approvals, payments, emergencies, events, assets, members, rules,
// documents, Edir settings, …) belong to Edir Administrators or users holding
// Edir-level permissions — the Super-Admin manages the platform, tenants, users,
// roles and governance instead.
export const SUPER_ADMIN_HIDDEN_PAGES = new Set<string>([
  'people', 'payments', 'payment-log', 'approvals', 'member-requests',
  'emergencies', 'events', 'assets', 'rules', 'committee', 'documents',
  'admin-settings',
]);

/** Build the visible, permission-filtered navigation grouped by section. */
export function buildNav(permissions: Permission[], isSuperAdmin: boolean): NavSection[] {
  const has = (perms: Permission[]) => isSuperAdmin || perms.some(p => permissions.includes(p));

  const sections: NavSection[] = PAGE_SECTIONS.map(section => ({
    id: section.id as string,
    label: section.label as string,
    items: pagePermissions.filter(
      p => p.section === section.id
        && IMPLEMENTED_PAGES.has(p.id)
        && !(isSuperAdmin && SUPER_ADMIN_HIDDEN_PAGES.has(p.id))
        && has(p.accessPermissions),
    ),
  })).filter(s => s.items.length > 0);

  // Super-Admins don't operate inside a single Edir by default, so the Edir-scoped
  // pages are pulled out of the normal sections above. Surface them TOGETHER in one
  // dedicated group so a Super-Admin can drill into any Edir's operational pages —
  // scoped via the top-bar Edir switcher. Routes already permit super_admin
  // (see src/middleware.ts), so these links resolve without extra gating.
  if (isSuperAdmin) {
    const edirItems = pagePermissions.filter(
      p => SUPER_ADMIN_HIDDEN_PAGES.has(p.id) && IMPLEMENTED_PAGES.has(p.id),
    );
    if (edirItems.length > 0) sections.push({ id: 'edir-ops', label: 'Edir Pages', items: edirItems });
  }

  return sections;
}

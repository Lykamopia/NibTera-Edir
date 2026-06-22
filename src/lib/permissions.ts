import type { Permission } from '@/lib/types';
import type { ApprovalModule } from '@prisma/client';

// ─── Page-based permission registry ─────────────────────────────────────────
// Drives route gating (middleware), sidebar/command-palette filtering, and the
// "first accessible page" resolution after login.

export interface PageAction {
  id: Permission;
  label: string;
  description: string;
  isAccess?: boolean;
}

export interface PagePermissionDef {
  id: string;
  label: string;
  path: string;
  icon: string; // lucide icon name
  section: string;
  accessPermissions: Permission[]; // user needs at least one to see/enter the page
  actions: PageAction[];
}

export const PAGE_SECTIONS = [
  { id: 'main', label: 'Main' },
  { id: 'operations', label: 'Operations' },
  { id: 'governance', label: 'Governance' },
  { id: 'admin', label: 'Administration' },
  { id: 'system', label: 'System' },
] as const;

export const pagePermissions: PagePermissionDef[] = [
  {
    id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', section: 'main',
    accessPermissions: ['view_dashboard'],
    actions: [{ id: 'view_dashboard', label: 'View Dashboard', description: 'Access the dashboard', isAccess: true }],
  },
  {
    id: 'people', label: 'People', path: '/dashboard/people', icon: 'UsersRound', section: 'operations',
    accessPermissions: ['view_members', 'manage_members', 'view_users', 'manage_users', 'manage_edirs', 'super_admin'],
    actions: [{ id: 'view_members', label: 'People Management', description: 'Unified members & users management (adapts to your role)', isAccess: true }],
  },
  {
    id: 'members', label: 'Members', path: '/dashboard/members', icon: 'Users', section: 'operations',
    accessPermissions: ['view_members', 'manage_members'],
    actions: [
      { id: 'view_members', label: 'View Members', description: 'View member profiles and lists', isAccess: true },
      { id: 'manage_members', label: 'Manage Members', description: 'Create and edit members' },
      { id: 'remove_members', label: 'Remove Members', description: 'Request member removal (maker)' },
      { id: 'approve_member_removal', label: 'Approve Member Removal', description: 'Authorize member removals (checker)' },
      { id: 'review_member_documents', label: 'Review Documents', description: 'Approve/reject relative documents' },
    ],
  },
  {
    id: 'payments', label: 'Payments', path: '/dashboard/payments', icon: 'CreditCard', section: 'operations',
    accessPermissions: ['view_payments', 'record_payment'],
    actions: [
      { id: 'view_payments', label: 'View Payments', description: 'View payments and contributions', isAccess: true },
      { id: 'record_payment', label: 'Record Payment', description: 'Record a manual payment (maker)' },
      { id: 'approve_payment', label: 'Approve Payment', description: 'Authorize recorded payments (checker)' },
      { id: 'waive_penalty', label: 'Waive Penalty', description: 'Request a penalty waiver (maker)' },
      { id: 'approve_penalty_waiver', label: 'Approve Penalty Waiver', description: 'Authorize penalty waivers (checker)' },
      { id: 'void_payment', label: 'Void Payment', description: 'Void a transaction' },
    ],
  },
  {
    id: 'approvals', label: 'Approvals Center', path: '/dashboard/approvals', icon: 'CheckSquare', section: 'operations',
    accessPermissions: [
      'view_approvals', 'approve_payment', 'approve_member_removal', 'approve_penalty_waiver',
      'approve_emergency_claim', 'approve_emergency_disbursement', 'approve_asset_issuance', 'approve_rule_change',
    ],
    actions: [{ id: 'view_approvals', label: 'View Approvals', description: 'Access the Approvals Center', isAccess: true }],
  },
  {
    id: 'emergencies', label: 'Emergencies', path: '/dashboard/emergencies', icon: 'Siren', section: 'operations',
    accessPermissions: ['view_emergencies', 'manage_emergencies'],
    actions: [
      { id: 'view_emergencies', label: 'View Emergencies', description: 'View emergency claims', isAccess: true },
      { id: 'manage_emergencies', label: 'Manage Emergencies', description: 'Report and process claims' },
      { id: 'approve_emergency_claim', label: 'Approve Claim', description: 'Authorize emergency claims (checker)' },
      { id: 'approve_emergency_disbursement', label: 'Approve Disbursement', description: 'Authorize disbursements (checker)' },
    ],
  },
  {
    id: 'events', label: 'Events', path: '/dashboard/events', icon: 'CalendarDays', section: 'operations',
    accessPermissions: ['view_events', 'manage_events'],
    actions: [
      { id: 'view_events', label: 'View Events', description: 'View events and attendance', isAccess: true },
      { id: 'manage_events', label: 'Manage Events', description: 'Create and edit events' },
      { id: 'finalize_attendance', label: 'Finalize Attendance', description: 'Finalize attendance and apply penalties' },
    ],
  },
  {
    id: 'assets', label: 'Assets', path: '/dashboard/assets', icon: 'Package', section: 'operations',
    accessPermissions: ['view_assets', 'manage_assets'],
    actions: [
      { id: 'view_assets', label: 'View Assets', description: 'View asset inventory', isAccess: true },
      { id: 'manage_assets', label: 'Manage Assets', description: 'Add/edit/issue assets' },
      { id: 'manage_asset_categories', label: 'Manage Categories', description: 'Manage asset categories' },
      { id: 'approve_asset_issuance', label: 'Approve Issuance', description: 'Authorize asset issuance (checker)' },
    ],
  },
  {
    id: 'rules', label: 'Rules & Bylaws', path: '/dashboard/rules', icon: 'Scale', section: 'governance',
    accessPermissions: ['view_rules', 'manage_rules'],
    actions: [
      { id: 'view_rules', label: 'View Rules', description: 'View rules, tiers, and change log', isAccess: true },
      { id: 'manage_rules', label: 'Manage Rules', description: 'Propose rule/bylaw changes (maker)' },
      { id: 'approve_rule_change', label: 'Approve Rule Change', description: 'Authorize rule changes (checker)' },
    ],
  },
  {
    id: 'committee', label: 'Committee Oversight', path: '/dashboard/oversight', icon: 'Gauge', section: 'governance',
    accessPermissions: ['view_committee_oversight'],
    actions: [{ id: 'view_committee_oversight', label: 'View Oversight', description: 'Read-only committee dashboard', isAccess: true }],
  },
  {
    id: 'member-requests', label: 'Member Requests', path: '/dashboard/requests', icon: 'Inbox', section: 'operations',
    accessPermissions: ['handle_member_requests'],
    actions: [{ id: 'handle_member_requests', label: 'Handle Member Requests', description: 'Review and respond to member self-service requests (relatives, emergencies, assets, grievances)', isAccess: true }],
  },
  {
    id: 'documents', label: 'Documents', path: '/dashboard/documents', icon: 'FolderArchive', section: 'governance',
    accessPermissions: ['view_documents'],
    actions: [{ id: 'view_documents', label: 'View Documents', description: 'Access the centralized document repository (scope-limited to authorized records)', isAccess: true }],
  },
  {
    id: 'audit', label: 'Audit Log', path: '/dashboard/audit', icon: 'ScrollText', section: 'governance',
    accessPermissions: ['view_audit_log', 'manage_audit_log'],
    actions: [
      { id: 'view_audit_log', label: 'View Audit Log', description: 'View the audit trail', isAccess: true },
      { id: 'manage_audit_log', label: 'Manage Audit Log', description: 'Archive/export audit entries' },
    ],
  },
  {
    id: 'payment-log', label: 'Payment Log', path: '/dashboard/payment-log', icon: 'ReceiptText', section: 'governance',
    accessPermissions: ['view_payment_log'],
    actions: [{ id: 'view_payment_log', label: 'View Payment Log', description: 'View all transactions', isAccess: true }],
  },
  // ── Administration (Edir-scoped) ─────────────────────────────────────────
  {
    id: 'admin-users', label: 'Users', path: '/dashboard/admin/users', icon: 'UserCog', section: 'admin',
    accessPermissions: ['view_users', 'manage_users'],
    actions: [
      { id: 'view_users', label: 'View Users', description: 'View user accounts', isAccess: true },
      { id: 'manage_users', label: 'Manage Users', description: 'Invite, edit, deactivate users' },
      { id: 'reset_password', label: 'Reset Password', description: "Reset a user's password" },
      { id: 'lock_user', label: 'Lock User', description: 'Lock a user account' },
      { id: 'unlock_user', label: 'Unlock User', description: 'Unlock a user account' },
    ],
  },
  {
    id: 'admin-roles', label: 'Roles', path: '/dashboard/admin/roles', icon: 'ShieldCheck', section: 'admin',
    accessPermissions: ['view_roles', 'manage_roles'],
    actions: [
      { id: 'view_roles', label: 'View Roles', description: 'View role definitions', isAccess: true },
      { id: 'manage_roles', label: 'Manage Roles', description: 'Create and edit roles' },
    ],
  },
  {
    id: 'admin-settings', label: 'Edir Settings', path: '/dashboard/admin/settings', icon: 'Settings', section: 'admin',
    accessPermissions: ['manage_edir_settings', 'manage_committee'],
    actions: [
      { id: 'manage_edir_settings', label: 'Manage Settings', description: 'Fees, currency, penalties, thresholds', isAccess: true },
      { id: 'manage_committee', label: 'Manage Committee', description: 'Invite/role/remove committee members' },
    ],
  },
  // ── System (Super Admin) ─────────────────────────────────────────────────
  {
    id: 'system-edirs', label: 'Edirs', path: '/dashboard/system/edirs', icon: 'Building2', section: 'system',
    accessPermissions: ['manage_edirs', 'super_admin'],
    actions: [{ id: 'manage_edirs', label: 'Manage Edirs', description: 'Create and manage tenant Edirs', isAccess: true }],
  },
  {
    id: 'system-associations', label: 'User Associations', path: '/dashboard/system/associations', icon: 'Network', section: 'system',
    accessPermissions: ['manage_edirs', 'super_admin'],
    actions: [{ id: 'super_admin', label: 'Manage Associations', description: 'Associate, transfer, and remove users across Edirs', isAccess: true }],
  },
];

// ─── Maker–Checker: module → required checker permission ─────────────────────
// The single configurable mapping the approval engine consults to decide who may
// approve a given module's requests.
export const MODULE_CHECKER_PERMISSION: Record<ApprovalModule, Permission> = {
  MANUAL_PAYMENT: 'approve_payment',
  EMERGENCY_CLAIM: 'approve_emergency_claim',
  EMERGENCY_DISBURSEMENT: 'approve_emergency_disbursement',
  ASSET_ISSUANCE: 'approve_asset_issuance',
  MEMBER_REMOVAL: 'approve_member_removal',
  RULE_CHANGE: 'approve_rule_change',
  PENALTY_WAIVER: 'approve_penalty_waiver',
};

export const MODULE_LABEL: Record<ApprovalModule, string> = {
  MANUAL_PAYMENT: 'Manual Payment',
  EMERGENCY_CLAIM: 'Emergency Claim',
  EMERGENCY_DISBURSEMENT: 'Emergency Disbursement',
  ASSET_ISSUANCE: 'Asset Issuance',
  MEMBER_REMOVAL: 'Member Removal',
  RULE_CHANGE: 'Rule Change',
  PENALTY_WAIVER: 'Penalty Waiver',
};

// All access permissions that gate an admin/system page — used to decide whether
// to show the "Admin" grouping in navigation.
export function getAdminAccessPermissions(): Permission[] {
  return Array.from(new Set(
    pagePermissions.filter(p => p.section === 'admin' || p.section === 'system').flatMap(p => p.accessPermissions),
  ));
}

// ─── Flat permission catalog (for the role editor tree) ──────────────────────

export interface PermissionGroup {
  id: string;
  label: string;
  icon: string;
  permissions: { id: Permission; label: string; description: string }[];
}

export const permissionGroups: PermissionGroup[] = pagePermissions.map(p => ({
  id: p.id,
  label: p.label,
  icon: p.icon,
  permissions: p.actions.map(a => ({ id: a.id, label: a.label, description: a.description })),
})).filter(g => g.permissions.length > 0);

// Add the Super Admin master switch as its own group.
permissionGroups.push({
  id: 'super',
  label: 'Super Admin',
  icon: 'Crown',
  permissions: [{ id: 'super_admin', label: 'Super Admin', description: 'Full cross-tenant access' }],
});

export const permissions = permissionGroups.flatMap(g => g.permissions);

// The full list of valid permission ids — used to validate the role editor.
export const ALL_PERMISSION_IDS: Permission[] = Array.from(new Set(permissions.map(p => p.id)));

// Platform/global permissions — only ever grantable by a Super-Admin. These gate
// cross-tenant capabilities (managing Edirs, associations, the super switch) and
// must never appear in an Edir-scoped role editor or be saved on an Edir role.
export const PLATFORM_PERMISSION_IDS: Permission[] = Array.from(new Set([
  ...pagePermissions.filter(p => p.section === 'system').flatMap(p => p.actions.map(a => a.id)),
  'super_admin',
])) as Permission[];

/** Permission groups assignable by the given actor scope. Edir (non-super) roles
 *  never see platform/global permissions. */
export function getAssignablePermissionGroups(isSuperAdmin: boolean): PermissionGroup[] {
  if (isSuperAdmin) return permissionGroups;
  const platform = new Set(PLATFORM_PERMISSION_IDS as string[]);
  return permissionGroups
    .map(g => ({ ...g, permissions: g.permissions.filter(p => !platform.has(p.id)) }))
    .filter(g => g.permissions.length > 0);
}

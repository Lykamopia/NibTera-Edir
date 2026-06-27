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
    actions: [
      { id: 'view_dashboard', label: 'View Dashboard', description: 'Access the dashboard', isAccess: true },
      { id: 'view_branch_dashboard', label: 'View Branch Dashboard', description: 'See analytics scoped to your branch' },
      { id: 'view_district_dashboard', label: 'View District Dashboard', description: 'See analytics scoped to your district (summed across its branches)' },
    ],
  },
  {
    id: 'people', label: 'People', path: '/dashboard/people', icon: 'UsersRound', section: 'operations',
    accessPermissions: ['view_members', 'manage_members', 'view_users', 'manage_users', 'super_admin'],
    actions: [{ id: 'view_members', label: 'People Management', description: 'Unified members & users management (adapts to your role)', isAccess: true }],
  },
  {
    id: 'members', label: 'Members', path: '/dashboard/members', icon: 'Users', section: 'operations',
    accessPermissions: ['view_members', 'manage_members'],
    actions: [
      { id: 'view_members', label: 'View Members', description: 'View member profiles and lists', isAccess: true },
      { id: 'manage_members', label: 'Manage Members', description: 'Umbrella: all member operations below' },
      { id: 'create_member', label: 'Create Member', description: 'Add new members' },
      { id: 'edit_member', label: 'Edit Member', description: 'Edit member profiles' },
      { id: 'suspend_member', label: 'Suspend Member', description: 'Suspend a member' },
      { id: 'reinstate_member', label: 'Reinstate Member', description: 'Reactivate a suspended/inactive member' },
      { id: 'approve_member', label: 'Approve Member', description: 'Approve pending member applications' },
      { id: 'manage_relatives', label: 'Manage Relatives', description: 'Add/edit/remove member relatives' },
      { id: 'manage_documents', label: 'Manage Documents', description: 'Upload/delete member & relative documents' },
      { id: 'remove_members', label: 'Remove Members', description: 'Request member removal (maker)' },
      { id: 'approve_member_removal', label: 'Approve Member Removal', description: 'Authorize member removals (checker)' },
      { id: 'review_member_documents', label: 'Review Documents', description: 'Approve/reject relative documents' },
      { id: 'export_members', label: 'Export Members', description: 'Download member data (CSV)' },
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
      { id: 'export_payments', label: 'Export Payments', description: 'Download the payment log (CSV)' },
    ],
  },
  {
    id: 'approvals', label: 'Approvals Center', path: '/dashboard/approvals', icon: 'CheckSquare', section: 'operations',
    accessPermissions: [
      'view_approvals', 'approve_payment', 'approve_member_removal', 'approve_penalty_waiver',
      'approve_emergency_claim', 'approve_emergency_disbursement', 'approve_asset_issuance', 'approve_rule_change',
      'approve_edir_registration', 'approve_edir_update', 'approve_user_creation',
    ],
    actions: [{ id: 'view_approvals', label: 'View Approvals', description: 'Access the Approvals Center', isAccess: true }],
  },
  {
    id: 'edir-registration', label: 'Edirs', path: '/dashboard/edir-registration', icon: 'Building2', section: 'operations',
    accessPermissions: ['view_edir', 'register_edir', 'approve_edir_registration', 'approve_edir_update', 'manage_edirs', 'create_edir', 'edit_edir', 'revoke_edir', 'delete_edir', 'view_edir_reports', 'super_admin'],
    actions: [
      { id: 'view_edir', label: 'View Edir', description: 'View Edir directory and details', isAccess: true },
      { id: 'register_edir', label: 'Register Edir', description: 'Submit new Edir for registration (maker)', isAccess: true },
      { id: 'approve_edir_registration', label: 'Approve Registration', description: 'Review and approve Edir registrations (checker)' },
      { id: 'approve_edir_update', label: 'Approve Edir Update', description: 'Review and approve Edir updates (checker)' },
      { id: 'manage_edirs', label: 'Manage Edirs', description: 'Umbrella: create, edit, revoke, delete, and manage Edirs' },
      { id: 'create_edir', label: 'Create Edir', description: 'Create a new Edir' },
      { id: 'edit_edir', label: 'Edit Edir', description: 'Edit an existing Edir’s profile' },
      { id: 'revoke_edir', label: 'Revoke Edir', description: 'Deactivate (suspend/close) an Edir without deleting it' },
      { id: 'delete_edir', label: 'Delete Edir', description: 'Permanently delete an Edir (only when it has no operational data)' },
      { id: 'manage_edir_users', label: 'Manage Edir Users', description: 'Create and manage user accounts within Edirs' },
      { id: 'manage_edir_associations', label: 'Manage Edir Associations', description: 'Associate, transfer, and remove users across Edirs' },
      { id: 'view_edir_reports', label: 'View Edir Reports', description: 'View cross-Edir reports and metrics' },
    ],
  },
  {
    id: 'emergencies', label: 'Emergencies', path: '/dashboard/emergencies', icon: 'Siren', section: 'operations',
    accessPermissions: ['view_emergencies', 'manage_emergencies'],
    actions: [
      { id: 'view_emergencies', label: 'View Emergencies', description: 'View emergency claims', isAccess: true },
      { id: 'manage_emergencies', label: 'Manage Emergencies', description: 'Umbrella: report, process, and configure emergency claims' },
      { id: 'report_emergency', label: 'Report Claim', description: 'Report a new emergency claim (maker)' },
      { id: 'reject_emergency', label: 'Reject Claim', description: 'Reject a reported claim' },
      { id: 'request_disbursement', label: 'Request Disbursement', description: 'Request disbursement of an approved claim (maker)' },
      { id: 'approve_emergency_claim', label: 'Approve Claim', description: 'Authorize emergency claims (checker)' },
      { id: 'approve_emergency_disbursement', label: 'Approve Disbursement', description: 'Authorize disbursements (checker)' },
      { id: 'export_emergencies', label: 'Export Emergencies', description: 'Download emergency claims (CSV)' },
    ],
  },
  {
    id: 'events', label: 'Events', path: '/dashboard/events', icon: 'CalendarDays', section: 'operations',
    accessPermissions: ['view_events', 'manage_events'],
    actions: [
      { id: 'view_events', label: 'View Events', description: 'View events and attendance', isAccess: true },
      { id: 'manage_events', label: 'Manage Events', description: 'Create and edit events' },
      { id: 'reschedule_event', label: 'Reschedule Event', description: 'Change the date/time of a scheduled event' },
      { id: 'cancel_event', label: 'Cancel Event', description: 'Cancel a scheduled event' },
      { id: 'finalize_attendance', label: 'Finalize Attendance', description: 'Finalize attendance and apply penalties' },
      { id: 'export_events', label: 'Export Events', description: 'Download events (CSV)' },
    ],
  },
  {
    id: 'assets', label: 'Assets', path: '/dashboard/assets', icon: 'Package', section: 'operations',
    accessPermissions: ['view_assets', 'manage_assets'],
    actions: [
      { id: 'view_assets', label: 'View Assets', description: 'View asset inventory', isAccess: true },
      { id: 'manage_assets', label: 'Manage Assets', description: 'Umbrella: all asset operations below' },
      { id: 'create_asset', label: 'Create Asset', description: 'Add new assets to inventory' },
      { id: 'edit_asset', label: 'Edit Asset', description: 'Edit asset details and quantities' },
      { id: 'delete_asset', label: 'Delete Asset', description: 'Remove an asset from inventory' },
      { id: 'issue_asset', label: 'Issue Asset', description: 'Issue an asset to a member (maker)' },
      { id: 'return_asset', label: 'Return Asset', description: 'Submit an asset return for approval (maker)' },
      { id: 'manage_asset_categories', label: 'Manage Categories', description: 'Manage asset categories' },
      { id: 'approve_asset_issuance', label: 'Approve Issuance', description: 'Authorize asset issuance/return (checker)' },
      { id: 'export_assets', label: 'Export Assets', description: 'Download asset inventory/issuances (CSV)' },
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
    actions: [
      { id: 'handle_member_requests', label: 'Handle Member Requests', description: 'Review and respond to member self-service requests (relatives, emergencies, assets, grievances)', isAccess: true },
      { id: 'export_member_requests', label: 'Export Requests', description: 'Download member requests/grievances (CSV)' },
    ],
  },
  {
    id: 'documents', label: 'Documents', path: '/dashboard/documents', icon: 'FolderArchive', section: 'governance',
    accessPermissions: ['view_documents', 'upload_document', 'approve_document'],
    actions: [
      { id: 'view_documents', label: 'View Documents', description: 'Access the centralized document repository (scope-limited to authorized records)', isAccess: true },
      // ── Maker actions (routed through approval) ──
      { id: 'upload_document', label: 'Upload Document', description: 'Upload documents (maker — stays pending until approved)' },
      { id: 'edit_document', label: 'Edit Document', description: 'Propose edits to a document (maker)' },
      { id: 'classify_document', label: 'Classify Document', description: 'Propose category/tag changes (maker)' },
      { id: 'share_document', label: 'Share Document', description: 'Propose sharing / visibility changes (maker)' },
      { id: 'archive_document', label: 'Archive Document', description: 'Propose archiving a document (maker)' },
      { id: 'delete_document', label: 'Delete Document', description: 'Propose deleting a document (maker)' },
      // ── Checker actions ──
      { id: 'review_document', label: 'Review Document', description: 'Open the review/approval queue for documents (checker)' },
      { id: 'approve_document', label: 'Approve Document', description: 'Authorize document actions (checker)' },
      { id: 'reject_document', label: 'Reject Document', description: 'Reject document actions (checker)' },
      { id: 'revoke_document_access', label: 'Revoke Access', description: 'Revoke a document’s shared visibility' },
      { id: 'export_documents', label: 'Export Documents', description: 'Download document metadata (CSV)' },
    ],
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
  // ── System (Super Admin / District & Branch Management) ─────────────────────
  {
    id: 'system-districts', label: 'Districts', path: '/dashboard/system/districts', icon: 'MapPin', section: 'system',
    accessPermissions: ['manage_districts', 'view_districts', 'create_district', 'edit_district', 'super_admin'],
    actions: [
      { id: 'view_districts', label: 'View Districts', description: 'View district information', isAccess: true },
      { id: 'manage_districts', label: 'Manage Districts', description: 'Umbrella: all district operations below' },
      { id: 'create_district', label: 'Create District', description: 'Create new districts' },
      { id: 'edit_district', label: 'Edit District', description: 'Edit district details' },
      { id: 'delete_district', label: 'Delete District', description: 'Delete a district (when empty)' },
      { id: 'import_districts', label: 'Import Districts', description: 'Bulk-import districts from CSV' },
    ],
  },
  {
    id: 'system-branches', label: 'Branches', path: '/dashboard/system/branches', icon: 'Building', section: 'system',
    accessPermissions: ['manage_branches', 'view_branches', 'create_branch', 'edit_branch', 'manage_districts', 'super_admin'],
    actions: [
      { id: 'view_branches', label: 'View Branches', description: 'View branch information', isAccess: true },
      { id: 'manage_branches', label: 'Manage Branches', description: 'Umbrella: all branch operations below' },
      { id: 'create_branch', label: 'Create Branch', description: 'Create new branches' },
      { id: 'edit_branch', label: 'Edit Branch', description: 'Edit branch details' },
      { id: 'delete_branch', label: 'Delete Branch', description: 'Delete a branch (when empty)' },
      { id: 'import_branches', label: 'Import Branches', description: 'Bulk-import branches from CSV' },
    ],
  },
  {
    id: 'system-associations', label: 'User Associations', path: '/dashboard/system/associations', icon: 'Network', section: 'system',
    accessPermissions: ['manage_associations', 'manage_edirs', 'super_admin'],
    actions: [{ id: 'manage_associations', label: 'Assign & Transfer Users', description: 'Associate, transfer, and remove users across Edirs (assign Edir Admins)', isAccess: true }],
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
  ASSET_RETURN: 'approve_asset_issuance',
  MEMBER_REMOVAL: 'approve_member_removal',
  RULE_CHANGE: 'approve_rule_change',
  PENALTY_WAIVER: 'approve_penalty_waiver',
  EDIR_REGISTRATION: 'approve_edir_registration',
  EDIR_UPDATE: 'approve_edir_update',
  USER_CREATION: 'approve_user_creation',
  DOCUMENT_ACTION: 'approve_document',
  RELATIVE_DOCUMENT_ACTION: 'review_member_documents',
  RELATIONSHIP_CATEGORY: 'manage_edir_settings',
};

// Approval modules that represent platform/org governance of an Edir's lifecycle
// (registering a new Edir, updating its official profile). These are routed UP the
// branch → district → head-office hierarchy: any org user with the checker
// permission whose org unit covers the Edir's branch may review them. Every OTHER
// module is Edir-operational and may be reviewed ONLY by the request's own Edir
// users. See pendingScopeWhere / assertCanCheckRequest in approval-engine.ts.
export const ORG_GOVERNANCE_MODULES: ApprovalModule[] = ['EDIR_REGISTRATION', 'EDIR_UPDATE'];
export function isOrgGovernanceModule(m: ApprovalModule): boolean {
  return ORG_GOVERNANCE_MODULES.includes(m);
}

export const MODULE_LABEL: Record<ApprovalModule, string> = {
  MANUAL_PAYMENT: 'Manual Payment',
  EMERGENCY_CLAIM: 'Emergency Claim',
  EMERGENCY_DISBURSEMENT: 'Emergency Disbursement',
  ASSET_ISSUANCE: 'Asset Issuance',
  ASSET_RETURN: 'Asset Return',
  MEMBER_REMOVAL: 'Member Removal',
  RULE_CHANGE: 'Rule Change',
  PENALTY_WAIVER: 'Penalty Waiver',
  EDIR_REGISTRATION: 'Edir Registration',
  EDIR_UPDATE: 'Edir Update',
  USER_CREATION: 'User Creation',
  DOCUMENT_ACTION: 'Document Action',
  RELATIVE_DOCUMENT_ACTION: 'Relative Document',
  RELATIONSHIP_CATEGORY: 'Relationship Category',
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
export const PLATFORM_PERMISSION_IDS: Permission[] = Array.from(new Set<Permission>([
  ...pagePermissions.filter(p => p.section === 'system').flatMap(p => p.actions.map(a => a.id)),
  // Cross-tenant Edir management — grantable only to platform roles, never Edir-scoped roles.
  // NOTE: manage_edir_settings is intentionally NOT here — it is an Edir-scoped permission
  // (fees, penalties, branding, rules config) held by Edir Admins; see the 'admin-settings' page.
  'view_edir', 'manage_edirs', 'create_edir', 'edit_edir', 'revoke_edir', 'delete_edir',
  'manage_edir_users', 'manage_edir_associations', 'view_edir_reports',
  'approve_edir_registration', 'approve_edir_update',
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

// ─── Action taxonomy ─────────────────────────────────────────────────────────
// Each permission is classified into a granular "action" so the role editor can
// label and group capabilities consistently (Create, Read, Update, Approve, …).

export type ActionKind =
  | 'View' | 'Reports' | 'Create' | 'Update' | 'Delete' | 'Manage'
  | 'Approve' | 'Reject' | 'Assign' | 'Export' | 'Print' | 'Upload' | 'Download' | 'Other';

/** Ordered for stable display. */
export const ACTION_KINDS: ActionKind[] = [
  'View', 'Reports', 'Create', 'Update', 'Delete', 'Manage',
  'Approve', 'Reject', 'Assign', 'Export', 'Print', 'Upload', 'Download', 'Other',
];

/** Per-permission overrides where the id prefix is ambiguous. */
const ACTION_OVERRIDES: Partial<Record<Permission, ActionKind>> = {
  view_committee_oversight: 'Reports',
  view_audit_log: 'Reports',
  view_payment_log: 'Reports',
  record_payment: 'Create',
  remove_members: 'Delete',
  void_payment: 'Delete',
  waive_penalty: 'Approve',
  finalize_attendance: 'Approve',
  review_member_documents: 'Approve',
  handle_member_requests: 'Manage',
  reset_password: 'Manage',
  lock_user: 'Manage',
  unlock_user: 'Manage',
  manage_committee: 'Assign',
  manage_associations: 'Assign',
  manage_edirs: 'Create',
  manage_districts: 'Create',
  manage_branches: 'Create',
  manage_asset_categories: 'Manage',
  register_edir: 'Create',
  view_branch_dashboard: 'View',
  view_district_dashboard: 'View',
  super_admin: 'Other',
};

// ─── Permission matrix (enterprise Role & Permission Matrix UI) ──────────────
// Columns of the matrix. A permission is mapped to exactly one column so the
// matrix can render modules (rows) × actions (columns).

export const MATRIX_ACTIONS = [
  'Read', 'Create', 'Update', 'Delete', 'Approve', 'Reject', 'Export', 'Import',
  'Assign', 'Revoke', 'Cancel', 'Reschedule', 'Bulk Create', 'Bulk Update', 'Bulk Delete',
  'Settings', 'Reports', 'Other',
] as const;
export type MatrixAction = (typeof MATRIX_ACTIONS)[number];

const MATRIX_OVERRIDES: Record<string, MatrixAction> = {
  view_committee_oversight: 'Reports', view_audit_log: 'Reports', view_payment_log: 'Reports',
  view_branch_dashboard: 'Reports', view_district_dashboard: 'Reports', view_edir_reports: 'Reports',
  record_payment: 'Create', register_edir: 'Create', report_emergency: 'Create', upload_document: 'Create',
  remove_members: 'Delete', void_payment: 'Delete', delete_edir: 'Delete',
  revoke_edir: 'Revoke', cancel_event: 'Cancel', reschedule_event: 'Reschedule',
  waive_penalty: 'Approve', finalize_attendance: 'Approve', review_member_documents: 'Approve',
  approve_member: 'Approve', review_document: 'Approve',
  manage_associations: 'Assign', manage_committee: 'Assign', manage_edir_associations: 'Assign', manage_edir_users: 'Assign',
  issue_asset: 'Assign', request_disbursement: 'Update', return_asset: 'Update',
  manage_edir_settings: 'Settings', manage_asset_categories: 'Settings',
  suspend_member: 'Update', reinstate_member: 'Update', handle_member_requests: 'Update',
  reset_password: 'Update', lock_user: 'Update', unlock_user: 'Update',
  super_admin: 'Other',
};

/** Map a permission to its matrix action column. */
export function permissionMatrixAction(id: string): MatrixAction {
  if (MATRIX_OVERRIDES[id]) return MATRIX_OVERRIDES[id];
  if (id.startsWith('view_')) return 'Read';
  if (id.startsWith('approve_')) return 'Approve';
  if (id.startsWith('reject_')) return 'Reject';
  if (id.startsWith('export_')) return 'Export';
  if (id.startsWith('import_')) return 'Import';
  if (id.startsWith('assign_')) return 'Assign';
  if (id.startsWith('revoke_')) return 'Revoke';
  if (id.startsWith('cancel_')) return 'Cancel';
  if (id.startsWith('reschedule_')) return 'Reschedule';
  if (id.startsWith('create_') || id.startsWith('add_')) return 'Create';
  if (id.startsWith('edit_') || id.startsWith('update_')) return 'Update';
  if (id.startsWith('delete_') || id.startsWith('remove_')) return 'Delete';
  if (id.includes('settings')) return 'Settings';
  if (id.startsWith('manage_')) return 'Update';
  return 'Other';
}

/** Destructive / high-blast-radius permissions — flagged red in the matrix. */
export function isDangerousPermission(id: string): boolean {
  if (id === 'super_admin') return true;
  return /^(delete_|remove_|revoke_|void_|suspend_)/.test(id) || id === 'waive_penalty';
}

/** Checker (approval) permissions — the second half of a maker–checker pair. */
export function isCheckerPermission(id: string): boolean {
  return id.startsWith('approve_') || id.startsWith('reject_') || id === 'finalize_attendance' || id === 'review_member_documents';
}

/** True if the permission is platform/cross-tenant scoped (scope restriction). */
export function isPlatformPermission(id: string): boolean {
  return PLATFORM_SET.has(id);
}

/** Module (page) id → its section id, for grouping matrix rows under categories. */
export const MODULE_SECTION: Record<string, string> = {
  ...Object.fromEntries(pagePermissions.map(p => [p.id, p.section])),
  super: 'system',
};

/** Classify a permission id into its action kind (prefix heuristic + overrides). */
export function permissionActionKind(id: Permission): ActionKind {
  if (ACTION_OVERRIDES[id]) return ACTION_OVERRIDES[id]!;
  if (id.startsWith('view_')) return 'View';
  if (id.startsWith('approve_')) return 'Approve';
  if (id.startsWith('reject_')) return 'Reject';
  if (id.startsWith('export_')) return 'Export';
  if (id.startsWith('print_')) return 'Print';
  if (id.startsWith('upload_')) return 'Upload';
  if (id.startsWith('download_')) return 'Download';
  if (id.startsWith('assign_')) return 'Assign';
  if (id.startsWith('create_')) return 'Create';
  if (id.startsWith('update_') || id.startsWith('edit_')) return 'Update';
  if (id.startsWith('delete_') || id.startsWith('remove_')) return 'Delete';
  if (id.startsWith('manage_')) return 'Manage';
  return 'Other';
}

// ─── Role scope helpers ──────────────────────────────────────────────────────
// A role is either Edir-scoped (operates within one tenant, or a template for
// all Edirs) or Platform-scoped (cross-tenant, Super-Admin managed).

export type RoleScopeKind = 'EDIR' | 'PLATFORM';

const PLATFORM_SET = new Set(PLATFORM_PERMISSION_IDS as string[]);

/** Permission groups to show in the editor for a given role scope. Edir roles get
 *  every non-platform capability; Platform roles get only platform capabilities. */
export function getPermissionGroupsForScope(scope: RoleScopeKind): PermissionGroup[] {
  return permissionGroups
    .map(g => ({ ...g, permissions: g.permissions.filter(p => (scope === 'PLATFORM' ? PLATFORM_SET.has(p.id) : !PLATFORM_SET.has(p.id))) }))
    .filter(g => g.permissions.length > 0);
}

/** Keep only permission ids valid for the given scope (server-side hardening). */
export function filterPermissionsForScope(ids: string[], scope: RoleScopeKind): string[] {
  const valid = new Set(ALL_PERMISSION_IDS as string[]);
  return ids.filter(p => valid.has(p) && (scope === 'PLATFORM' ? PLATFORM_SET.has(p) : !PLATFORM_SET.has(p)));
}

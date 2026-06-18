import type { Permission } from '@/lib/types';

// ─── Page-based permission registry ─────────────────────────────────────────

export interface PageAction {
  id: Permission;
  label: string;
  description: string;
  isAccess?: boolean; // primary page-access permission
}

export interface PagePermissionDef {
  id: string;
  label: string;
  path: string;
  icon: string; // lucide icon name
  section: string;
  accessPermissions: Permission[]; // user needs at least one to see the page
  actions: PageAction[];
}

export const PAGE_SECTIONS = [
  { id: 'main', label: 'Main Pages' },
  { id: 'admin-users', label: 'Admin — Users & Access' },
  { id: 'admin-org', label: 'Admin — Organization Structure' },
  { id: 'admin-settings', label: 'Admin — Settings & System' },
] as const;

export const pagePermissions: PagePermissionDef[] = [
  // ── Main Pages ──────────────────────────────────────────────────────────────
  {
    id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', section: 'main',
    accessPermissions: ['view_dashboard'],
    actions: [
      { id: 'view_dashboard', label: 'View Dashboard', description: 'Can access the main dashboard', isAccess: true },
    ],
  },
  {
    id: 'plans', label: 'Plans & Targets', path: '/dashboard/plans', icon: 'BarChart3', section: 'main',
    accessPermissions: ['view_plans', 'create_plans', 'approve_plans_head_office', 'edit_active_plans', 'allocate_plans_to_districts', 'approve_district_allocations', 'allocate_district_plans_to_branches', 'approve_branch_allocations'],
    actions: [
      { id: 'view_plans', label: 'View Plans', description: 'Can view organizational plans', isAccess: true },
      { id: 'create_plans', label: 'Create Plans', description: 'Can create new plans' },
      { id: 'edit_active_plans', label: 'Edit Active Plans', description: 'Can modify plans after they become active' },
      { id: 'approve_plans_head_office', label: 'Approve (Head Office)', description: 'Can approve plans at head office level' },
      { id: 'allocate_plans_to_districts', label: 'Allocate to Districts', description: 'Can allocate plans to districts' },
      { id: 'approve_district_allocations', label: 'Approve District Allocs.', description: 'Can approve plan allocations to districts' },
      { id: 'allocate_district_plans_to_branches', label: 'Allocate to Branches', description: 'Can allocate district plans to branches' },
      { id: 'approve_branch_allocations', label: 'Approve Branch Allocs.', description: 'Can approve plan allocations to branches' },
    ],
  },
  {
    id: 'branch-allocation', label: 'Branch Allocation', path: '/dashboard/branch-allocation', icon: 'Users', section: 'main',
    accessPermissions: ['allocate_district_plans_to_branches', 'approve_branch_allocations'],
    actions: [
      { id: 'allocate_district_plans_to_branches', label: 'Allocate to Branches', description: 'Can allocate district plans to branch targets', isAccess: true },
      { id: 'approve_branch_allocations', label: 'Approve Branch Allocations', description: 'Can approve plan allocations to branches', isAccess: true },
    ],
  },
  {
    id: 'branch-targets', label: 'Branch Targets', path: '/dashboard/branch-targets', icon: 'Target', section: 'main',
    accessPermissions: ['view_branch_targets', 'assign_staff_targets'],
    actions: [
      { id: 'view_branch_targets', label: 'View Branch Targets', description: 'Can view the branch targets page and allocated KPI overview', isAccess: true },
      { id: 'assign_staff_targets', label: 'Assign Staff Targets', description: 'Can assign KPI targets to branch staff and bulk-import via Excel' },
    ],
  },
  {
    id: 'daily-targets', label: 'Daily Targets', path: '/dashboard/daily-targets', icon: 'CalendarCheck', section: 'main',
    accessPermissions: ['view_daily_targets'],
    actions: [
      { id: 'view_daily_targets', label: 'View Daily Targets', description: 'Can view daily targets and achievements', isAccess: true },
      { id: 'view_performance', label: 'View Performance', description: 'Can view performance metrics' },
      { id: 'import_daily_targets', label: 'Import Daily Targets', description: 'Can import daily targets from Excel files' },
    ],
  },
  {
    id: 'my-targets', label: 'My Targets', path: '/dashboard/my-targets', icon: 'Crosshair', section: 'main',
    accessPermissions: ['view_my_targets'],
    actions: [
      { id: 'view_my_targets', label: 'View My Targets', description: 'Can view own KPI targets and progress', isAccess: true },
      { id: 'submit_kpi_progress', label: 'Submit Progress', description: 'Can submit progress updates against KPI targets' },
    ],
  },
  {
    id: 'approvals', label: 'Approvals Center', path: '/dashboard/approvals', icon: 'CheckSquare', section: 'main',
    accessPermissions: ['approve_branch_allocations', 'manage_branch_allocations', 'approve_staff_progress', 'manage_jobs', 'manage_leads', 'assign_leads', 'assign_staff_targets', 'manage_general_settings'],
    actions: [
      { id: 'approve_branch_allocations', label: 'Approve Branch Allocations', description: 'Can approve plan allocations to branches', isAccess: true },
      { id: 'manage_branch_allocations', label: 'Manage Branch Allocations', description: 'Can review and manage staff daily achievement approvals', isAccess: true },
      { id: 'approve_staff_progress', label: 'Approve Staff Progress', description: 'Can review and approve/reject staff KPI progress submissions', isAccess: true },
      { id: 'manage_jobs', label: 'Manage Jobs', description: 'Can approve/reject job submissions', isAccess: true },
      { id: 'manage_leads', label: 'Manage Leads', description: 'Can manage leads requiring approval', isAccess: true },
      { id: 'assign_leads', label: 'Assign Leads', description: 'Can assign leads to staff', isAccess: true },
      { id: 'assign_staff_targets', label: 'Assign Staff Targets', description: 'Can assign KPI targets requiring approval', isAccess: true },
      { id: 'manage_general_settings', label: 'Manage Settings', description: 'Admin-level access to approvals', isAccess: true },
    ],
  },
  {
    id: 'leads', label: 'Leads', path: '/dashboard/leads', icon: 'TrendingUp', section: 'main',
    accessPermissions: ['view_leads'],
    actions: [
      { id: 'view_leads', label: 'View Leads', description: 'Can view sales leads', isAccess: true },
      { id: 'create_leads', label: 'Create Leads', description: 'Can create new leads' },
      { id: 'manage_leads', label: 'Manage Leads', description: 'Can create, edit, and view sales leads' },
      { id: 'assign_leads', label: 'Assign Leads', description: 'Can assign leads to sales officers' },
      { id: 'update_assigned_leads', label: 'Update Assigned Leads', description: 'Can update leads assigned to themselves' },
    ],
  },
  {
    id: 'jobs', label: 'Jobs', path: '/dashboard/jobs', icon: 'Briefcase', section: 'main',
    accessPermissions: ['view_jobs'],
    actions: [
      { id: 'view_jobs', label: 'View Jobs', description: 'Can view job submissions', isAccess: true },
      { id: 'submit_jobs', label: 'Submit Jobs', description: 'Can submit completed sales activities' },
      { id: 'manage_jobs', label: 'Manage Jobs', description: 'Can approve/reject job submissions and view all jobs' },
      { id: 'manage_gps_verification', label: 'GPS Verification', description: 'Can review and manage GPS verification for job submissions' },
    ],
  },
  {
    id: 'customers', label: 'Customers', path: '/dashboard/customers', icon: 'Users2', section: 'main',
    accessPermissions: ['view_customers'],
    actions: [
      { id: 'view_customers', label: 'View Customers', description: 'Can view customer profiles', isAccess: true },
      { id: 'manage_customers', label: 'Manage Customers', description: 'Can create, edit, and manage customer profiles' },
    ],
  },
  {
    id: 'customer-visits', label: 'Customer Visits', path: '/dashboard/customer-visits', icon: 'UsersRound', section: 'main',
    accessPermissions: ['view_customer_visits'],
    actions: [
      { id: 'view_customer_visits', label: 'View Customer Visits', description: 'Can view customer visit records', isAccess: true },
    ],
  },
  {
    id: 'rm-report', label: 'RM Report', path: '/dashboard/rm-report', icon: 'FileBarChart2', section: 'main',
    accessPermissions: ['view_rm_report'],
    actions: [
      { id: 'view_rm_report', label: 'View RM Report', description: 'Can view the district-level RM Report and branch performance rankings', isAccess: true },
      { id: 'adjust_kpi', label: 'Adjust KPI Values', description: 'Can record manual +/- adjustments (with a reason) for adjustment-enabled KPIs' },
    ],
  },
  {
    id: 'performance-reports', label: 'Performance Reports', path: '/dashboard/performance-reports', icon: 'BarChart3', section: 'main',
    accessPermissions: ['view_reports'],
    actions: [
      { id: 'view_reports', label: 'View Reports', description: 'Can access and view the performance reporting dashboard', isAccess: true },
      { id: 'view_all_reports', label: 'View All Reports', description: 'Can view system-wide reporting data and analytics' },
    ],
  },
  // ── Admin — Users & Access ─────────────────────────────────────────────────
  {
    id: 'admin-users', label: 'Users', path: '/dashboard/admin/users', icon: 'Users', section: 'admin-users',
    accessPermissions: ['view_users', 'manage_users'],
    actions: [
      { id: 'view_users', label: 'View Users', description: 'Can view user profiles and lists', isAccess: true },
      { id: 'manage_users', label: 'Manage Users', description: 'Can create, edit, and delete users' },
      { id: 'import_users', label: 'Import Users', description: 'Can import users from CSV files' },
      { id: 'lock_user', label: 'Lock Users', description: 'Can lock user accounts' },
      { id: 'unlock_user', label: 'Unlock Users', description: 'Can unlock user accounts' },
      { id: 'reset_password', label: 'Reset Password', description: "Can reset another user's password" },
    ],
  },
  {
    id: 'admin-roles', label: 'Roles & Permissions', path: '/dashboard/admin/roles', icon: 'ShieldCheck', section: 'admin-users',
    accessPermissions: ['view_roles', 'manage_roles'],
    actions: [
      { id: 'view_roles', label: 'View Roles', description: 'Can view role definitions', isAccess: true },
      { id: 'manage_roles', label: 'Manage Roles', description: 'Can create, edit, and manage roles and permissions' },
    ],
  },
  // ── Admin — Organization Structure ────────────────────────────────────────
  {
    id: 'admin-offices', label: 'Offices', path: '/dashboard/admin/offices', icon: 'Building', section: 'admin-org',
    accessPermissions: ['view_offices', 'manage_offices'],
    actions: [
      { id: 'view_offices', label: 'View Offices', description: 'Can view office information', isAccess: true },
      { id: 'manage_offices', label: 'Manage Offices', description: 'Can create, edit, and delete offices' },
      { id: 'import_offices', label: 'Import Offices', description: 'Can import offices from CSV files' },
    ],
  },
  {
    id: 'admin-departments', label: 'Departments', path: '/dashboard/admin/departments', icon: 'Network', section: 'admin-org',
    accessPermissions: ['view_departments', 'manage_departments'],
    actions: [
      { id: 'view_departments', label: 'View Departments', description: 'Can view department information', isAccess: true },
      { id: 'manage_departments', label: 'Manage Departments', description: 'Can create, edit, and delete departments' },
      { id: 'import_departments', label: 'Import Departments', description: 'Can import departments from CSV files' },
    ],
  },
  {
    id: 'admin-divisions', label: 'Divisions', path: '/dashboard/admin/divisions', icon: 'Briefcase', section: 'admin-org',
    accessPermissions: ['view_divisions', 'manage_divisions'],
    actions: [
      { id: 'view_divisions', label: 'View Divisions', description: 'Can view division information', isAccess: true },
      { id: 'manage_divisions', label: 'Manage Divisions', description: 'Can create, edit, and delete divisions' },
      { id: 'import_divisions', label: 'Import Divisions', description: 'Can import divisions from CSV files' },
    ],
  },
  {
    id: 'admin-districts', label: 'Districts', path: '/dashboard/admin/districts', icon: 'MapPin', section: 'admin-org',
    accessPermissions: ['view_districts', 'manage_districts'],
    actions: [
      { id: 'view_districts', label: 'View Districts', description: 'Can view district information', isAccess: true },
      { id: 'manage_districts', label: 'Manage Districts', description: 'Can create, edit, and delete districts' },
      { id: 'import_districts', label: 'Import Districts', description: 'Can import districts from CSV files' },
    ],
  },
  {
    id: 'admin-branches', label: 'Branches', path: '/dashboard/admin/branches', icon: 'Store', section: 'admin-org',
    accessPermissions: ['view_branches', 'manage_branches'],
    actions: [
      { id: 'view_branches', label: 'View Branches', description: 'Can view branch information', isAccess: true },
      { id: 'manage_branches', label: 'Manage Branches', description: 'Can create, edit, and delete branches' },
      { id: 'import_branches', label: 'Import Branches', description: 'Can import branches from CSV files' },
    ],
  },
  {
    id: 'admin-kpi-config', label: 'KPI Configuration', path: '/dashboard/admin/kpi-config', icon: 'Target', section: 'admin-org',
    accessPermissions: ['manage_kpi_config'],
    actions: [
      { id: 'manage_kpi_config', label: 'Manage KPI Configurations', description: 'Can create and manage KPI definitions and approval requirements', isAccess: true },
    ],
  },
  // ── Admin — Settings & System ──────────────────────────────────────────────
  {
    id: 'admin-general', label: 'General Settings', path: '/dashboard/admin/general', icon: 'Settings', section: 'admin-settings',
    accessPermissions: ['manage_general_settings'],
    actions: [
      { id: 'manage_general_settings', label: 'Manage General Settings', description: 'Can configure system-wide settings, branding, and integrations', isAccess: true },
    ],
  },
  {
    id: 'admin-email', label: 'Email Settings', path: '/dashboard/admin/email', icon: 'Mail', section: 'admin-settings',
    accessPermissions: ['manage_email_settings'],
    actions: [
      { id: 'manage_email_settings', label: 'Manage Email Settings', description: 'Can configure email server and notification settings', isAccess: true },
    ],
  },
  {
    id: 'admin-public-holidays', label: 'Public Holidays', path: '/dashboard/admin/public-holidays', icon: 'Calendar', section: 'admin-settings',
    accessPermissions: ['manage_public_holidays'],
    actions: [
      { id: 'manage_public_holidays', label: 'Manage Public Holidays', description: 'Can add, edit, and delete public holidays and configure weekends', isAccess: true },
    ],
  },
  {
    id: 'admin-security', label: 'Security', path: '/dashboard/admin/security', icon: 'ShieldAlert', section: 'admin-settings',
    accessPermissions: ['view_security_logs', 'manage_security_logs'],
    actions: [
      { id: 'view_security_logs', label: 'View Security Logs', description: 'Can view security logs', isAccess: true },
      { id: 'manage_security_logs', label: 'Manage Security Logs', description: 'Can manage and clear security logs' },
    ],
  },
  {
    id: 'admin-gps', label: 'GPS Verifications', path: '/dashboard/admin/gps-verifications', icon: 'Map', section: 'admin-settings',
    accessPermissions: ['manage_gps_verification'],
    actions: [
      { id: 'manage_gps_verification', label: 'Manage GPS Verification', description: 'Can review and manage GPS verification for job submissions', isAccess: true },
    ],
  },
];

// Any access permission that gates an admin/* page — used to decide whether
// a user should see the "Admin" entry in the sidebar/bottom navigation.
export function getAdminAccessPermissions(): Permission[] {
  return Array.from(new Set(
    pagePermissions
      .filter(p => p.section !== 'main')
      .flatMap(p => p.accessPermissions)
  ));
}

// ─── Legacy flat group structure (kept for reference) ────────────────────────

export interface PermissionGroup {
  id: string;
  label: string;
  icon: string; // Icon name from lucide-react
  permissions: { id: Permission; label: string; description: string }[];
}

export const permissionGroups: PermissionGroup[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    permissions: [
      { id: 'view_dashboard', label: 'View Dashboard', description: 'Can access the main dashboard' }
    ]
  },
  {
    id: 'user-management',
    label: 'User Management',
    icon: 'Users',
    permissions: [
      { id: 'view_users', label: 'View Users', description: 'Can view user profiles and lists' },
      { id: 'manage_users', label: 'Manage Users', description: 'Can create, edit, and delete users' },
      { id: 'import_users', label: 'Import Users', description: 'Can import users from CSV files' },
      { id: 'manage_roles', label: 'Manage Roles', description: 'Can create, edit, and manage roles and permissions' },
      { id: 'lock_user', label: 'Lock Users', description: 'Can lock user accounts' },
      { id: 'unlock_user', label: 'Unlock Users', description: 'Can unlock user accounts' }
    ]
  },
  {
    id: 'organization-structure',
    label: 'Organization Structure',
    icon: 'Building',
    permissions: [
      { id: 'view_offices', label: 'View Offices', description: 'Can view office information' },
      { id: 'view_branches', label: 'View Branches', description: 'Can view branch information' },
      { id: 'view_districts', label: 'View Districts', description: 'Can view district information' },
      { id: 'view_departments', label: 'View Departments', description: 'Can view department information' },
      { id: 'view_divisions', label: 'View Divisions', description: 'Can view division information' },
      { id: 'manage_offices', label: 'Manage Offices', description: 'Can create, edit, and delete offices' },
      { id: 'import_offices', label: 'Import Offices', description: 'Can import offices from CSV files' },
      { id: 'manage_departments', label: 'Manage Departments', description: 'Can create, edit, and delete departments' },
      { id: 'import_departments', label: 'Import Departments', description: 'Can import departments from CSV files' },
      { id: 'manage_divisions', label: 'Manage Divisions', description: 'Can create, edit, and delete divisions' },
      { id: 'import_divisions', label: 'Import Divisions', description: 'Can import divisions from CSV files' },
      { id: 'manage_districts', label: 'Manage Districts', description: 'Can create, edit, and delete districts' },
      { id: 'import_districts', label: 'Import Districts', description: 'Can import districts from CSV files' },
      { id: 'manage_branches', label: 'Manage Branches', description: 'Can create, edit, and delete branches' },
      { id: 'import_branches', label: 'Import Branches', description: 'Can import branches from CSV files' }
    ]
  },
  {
    id: 'plans',
    label: 'Plans & Targets',
    icon: 'Target',
    permissions: [
      { id: 'view_plans', label: 'View Plans', description: 'Can view organizational plans' },
      { id: 'create_plans', label: 'Create Plans', description: 'Can create new plans' },
      { id: 'edit_active_plans', label: 'Edit Active Plans', description: 'Can modify plans after they have become active' },
      { id: 'approve_plans_head_office', label: 'Approve Plans (Head Office)', description: 'Can approve plans at head office level' },
      { id: 'allocate_plans_to_districts', label: 'Allocate Plans to Districts', description: 'Can allocate generic plans to districts (percentage or fixed amount)' },
      { id: 'approve_district_allocations', label: 'Approve District Allocations', description: 'Can approve plan allocations to districts' },
      { id: 'allocate_district_plans_to_branches', label: 'Allocate District Plans to Branches', description: 'Can allocate cascaded district plans to branches' },
      { id: 'approve_branch_allocations', label: 'Approve Branch Allocations', description: 'Can approve plan allocations to branches' },
      { id: 'manage_branch_allocations', label: 'Manage Branch Allocations', description: 'Can review and manage staff daily achievement approvals' },
      { id: 'import_daily_targets', label: 'Import Daily Targets', description: 'Can import daily targets from Excel files' },
      { id: 'manage_public_holidays', label: 'Manage Public Holidays', description: 'Can add, edit, and delete public holidays' }
    ]
  },
  {
    id: 'leads',
    label: 'Leads',
    icon: 'TrendingUp',
    permissions: [
      { id: 'view_leads', label: 'View Leads', description: 'Can view sales leads' },
      { id: 'create_leads', label: 'Create Leads', description: 'Can create new leads' },
      { id: 'manage_leads', label: 'Manage Leads', description: 'Can create, edit, and view sales leads' },
      { id: 'assign_leads', label: 'Assign Leads', description: 'Can assign leads to sales officers' },
      { id: 'update_assigned_leads', label: 'Update Assigned Leads', description: 'Can update leads assigned to themselves' }
    ]
  },
  {
    id: 'jobs',
    label: 'Jobs',
    icon: 'Briefcase',
    permissions: [
      { id: 'view_jobs', label: 'View Jobs', description: 'Can view job submissions' },
      { id: 'submit_jobs', label: 'Submit Jobs', description: 'Can submit completed sales activities' },
      { id: 'manage_jobs', label: 'Manage Jobs', description: 'Can approve/reject job submissions and view all jobs' },
      { id: 'manage_gps_verification', label: 'Manage GPS Verification', description: 'Can review and manage GPS verification for job submissions' }
    ]
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: 'User',
    permissions: [
      { id: 'view_customers', label: 'View Customers', description: 'Can view customer profiles' },
      { id: 'view_customer_visits', label: 'View Customer Visits', description: 'Can view customer visit records' },
      { id: 'manage_customers', label: 'Manage Customers', description: 'Can create, edit, and manage customer profiles and interactions' }
    ]
  },
  {
    id: 'kpi',
    label: 'KPIs',
    icon: 'BarChart3',
    permissions: [
      { id: 'manage_kpi_config', label: 'Manage KPI Configurations', description: 'Can create and manage KPI definitions and approval requirements' },
      { id: 'adjust_kpi', label: 'Adjust KPI Values', description: 'Can record manual +/- adjustments (with a reason) for adjustment-enabled KPIs' }
    ]
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'FileText',
    permissions: [
      { id: 'view_reports', label: 'View Reports', description: 'Can access and view the reporting dashboard' },
      { id: 'view_all_reports', label: 'View All Reports', description: 'Can view system-wide reporting data and analytics' },
      { id: 'view_rm_report', label: 'View RM Report', description: 'Can view the district-level RM Report and branch performance rankings' }
    ]
  },
  {
    id: 'daily-targets',
    label: 'Daily Targets',
    icon: 'CalendarCheck',
    permissions: [
      { id: 'view_daily_targets', label: 'View Daily Targets', description: 'Can view daily targets and achievements' },
      { id: 'view_performance', label: 'View Performance', description: 'Can view performance metrics' },
      { id: 'view_branch_targets', label: 'View Branch Targets', description: 'Can view the branch targets page and allocated KPI overview' },
      { id: 'assign_staff_targets', label: 'Assign Staff Targets', description: 'Can assign daily, monthly, quarterly, or annual KPI targets to branch staff, and bulk-import targets via Excel' },
      { id: 'view_my_targets', label: 'View My Targets', description: 'Can view own assigned KPI targets and progress history' },
      { id: 'submit_kpi_progress', label: 'Submit KPI Progress', description: 'Can submit daily or custom-date progress updates against own KPI targets' },
      { id: 'approve_staff_progress', label: 'Approve Staff Progress', description: 'Can review, approve, or reject staff KPI progress submissions' }
    ]
  },
  {
    id: 'security',
    label: 'Security & Auditing',
    icon: 'Shield',
    permissions: [
      { id: 'view_roles', label: 'View Roles', description: 'Can view role definitions' },
      { id: 'view_security_logs', label: 'View Security Logs', description: 'Can view security logs' },
      { id: 'manage_audit_logs', label: 'Manage Audit Log', description: 'Can view the full audit trail' },
      { id: 'manage_security_logs', label: 'Manage Security Logs', description: 'Can manage security logs' }
    ]
  },
  {
    id: 'system-settings',
    label: 'System Settings',
    icon: 'Settings',
    permissions: [
      { id: 'manage_general_settings', label: 'Manage General Settings', description: 'Can configure system-wide settings, branding, and integrations' },
      { id: 'manage_email_settings', label: 'Manage Email Settings', description: 'Can configure email server and notification settings' }
    ]
  },
  {
    id: 'gamification',
    label: 'Gamification',
    icon: 'Trophy',
    permissions: []
  }
];

// Keep original flat array for backward compatibility
export const permissions = permissionGroups.flatMap(group => group.permissions);

export const delegationPermissions = [
  { id: 'delegation:view', label: 'View Plans', description: "Can view the delegator's plans and reports" },
  { id: 'delegation:manage', label: 'Manage Plans', description: "Can create, edit, and manage plans on behalf of the delegator" },
] as const;

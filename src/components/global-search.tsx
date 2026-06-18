'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';
import {
  Home, BarChart3, Target, Users, Users2, UsersRound, Briefcase,
  CalendarDays, BarChart2, FileBarChart2, Building2, CheckSquare,
  Settings, Settings2, ShieldAlert, ShieldCheck, Mail, MapPin,
  Lock, User, ClipboardList, Layers, Search, Crosshair, Network,
  GitBranch, ArrowRight,
} from 'lucide-react';
import type { LoggedInUser, Permission } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────────────────
type SearchCategory =
  | 'Navigation'
  | 'Targets & KPIs'
  | 'Daily Operations'
  | 'Sales & CRM'
  | 'Plans & Allocation'
  | 'Approvals & Reviews'
  | 'Reports & Analytics'
  | 'Administration'
  | 'Profile & Account';

type SearchItem = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  href: string;
  icon: React.ReactNode;
  category: SearchCategory;
  permissions: Permission[];   // user needs at least ONE of these (empty = universal)
  requiresBranchId?: boolean;  // only show when user has a branch assignment
  noActingUser?: boolean;      // hide when acting as another user
};

// ── Category display order ─────────────────────────────────────────────────────
const CATEGORY_ORDER: SearchCategory[] = [
  'Navigation',
  'Targets & KPIs',
  'Daily Operations',
  'Sales & CRM',
  'Plans & Allocation',
  'Approvals & Reviews',
  'Reports & Analytics',
  'Administration',
  'Profile & Account',
];

// ── Search registry ────────────────────────────────────────────────────────────
// Every navigable feature the system supports. Filtered at runtime by the
// current user's permissions, org scope, and acting-user status.
const SEARCH_ITEMS: SearchItem[] = [
  // ── Navigation ────────────────────────────────────────────────────────────
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Main overview with KPI summaries, recent activity, and quick stats',
    keywords: ['home', 'overview', 'main page', 'landing', 'summary', 'start'],
    href: '/dashboard',
    icon: <Home className="h-4 w-4 shrink-0" />,
    category: 'Navigation',
    permissions: ['view_dashboard'],
    noActingUser: true,
  },

  // ── Targets & KPIs ────────────────────────────────────────────────────────
  {
    id: 'branch-targets',
    title: 'Branch Targets',
    description: 'View branch KPI targets and assign individual staff targets',
    keywords: ['kpi target', 'branch kpi', 'assign target', 'staff target', 'target management', 'target setting', 'quota'],
    href: '/dashboard/branch-targets',
    icon: <Target className="h-4 w-4 shrink-0" />,
    category: 'Targets & KPIs',
    permissions: ['view_branch_targets', 'assign_staff_targets'],
    requiresBranchId: true,
    noActingUser: true,
  },
  {
    id: 'my-targets',
    title: 'My Targets',
    description: 'Track your personal KPI targets, progress, and achievement status',
    keywords: ['personal targets', 'my kpis', 'my goals', 'individual targets', 'kpi progress', 'staff kpi', 'my performance', 'scorecard'],
    href: '/dashboard/my-targets',
    icon: <Crosshair className="h-4 w-4 shrink-0" />,
    category: 'Targets & KPIs',
    permissions: ['view_my_targets'],
    noActingUser: true,
  },

  // ── Daily Operations ──────────────────────────────────────────────────────
  {
    id: 'daily-targets',
    title: 'Daily Targets',
    description: 'Manage daily sales officer targets and achievement submissions',
    keywords: ['daily achievement', 'daily submission', 'sales officer target', 'daily kpi', 'daily work', 'approve achievement'],
    href: '/dashboard/daily-targets',
    icon: <CalendarDays className="h-4 w-4 shrink-0" />,
    category: 'Daily Operations',
    permissions: ['view_daily_targets'],
    noActingUser: true,
  },
  {
    id: 'daily-plan',
    title: 'Daily Planner',
    description: 'Plan and log daily field activities, visits, and task assignments',
    keywords: ['daily plan', 'activity plan', 'field activity', 'field plan', 'daily schedule', 'planner', 'day plan', 'plan activities'],
    href: '/dashboard/daily-plan',
    icon: <ClipboardList className="h-4 w-4 shrink-0" />,
    category: 'Daily Operations',
    permissions: ['view_daily_targets'],
    noActingUser: true,
  },

  // ── Sales & CRM ───────────────────────────────────────────────────────────
  {
    id: 'leads',
    title: 'Leads',
    description: 'Manage sales leads, prospects, and business opportunities',
    keywords: ['sales lead', 'prospect', 'opportunity', 'pipeline', 'potential customer', 'crm', 'business development', 'new business'],
    href: '/dashboard/leads',
    icon: <Crosshair className="h-4 w-4 shrink-0" />,
    category: 'Sales & CRM',
    permissions: ['view_leads'],
    noActingUser: true,
  },
  {
    id: 'jobs',
    title: 'Jobs',
    description: 'Submit job completions and log KPI achievement activities',
    keywords: ['job submission', 'work completion', 'activity log', 'kpi submission', 'task completion', 'job report', 'completed work', 'done'],
    href: '/dashboard/jobs',
    icon: <Briefcase className="h-4 w-4 shrink-0" />,
    category: 'Sales & CRM',
    permissions: ['view_jobs'],
    noActingUser: true,
  },
  {
    id: 'customers',
    title: 'Customers',
    description: 'View and manage the customer database and account records',
    keywords: ['client', 'customer list', 'account', 'contact', 'customer database', 'customer records', 'beneficiary'],
    href: '/dashboard/customers',
    icon: <Users2 className="h-4 w-4 shrink-0" />,
    category: 'Sales & CRM',
    permissions: ['view_customers'],
    noActingUser: true,
  },
  {
    id: 'customer-visits',
    title: 'Customer Visits',
    description: 'Log and review customer visit history and field activity records',
    keywords: ['visit', 'customer meeting', 'client visit', 'field visit', 'visit log', 'customer interaction', 'site visit'],
    href: '/dashboard/customer-visits',
    icon: <UsersRound className="h-4 w-4 shrink-0" />,
    category: 'Sales & CRM',
    permissions: ['view_customer_visits'],
    noActingUser: true,
  },

  // ── Plans & Allocation ────────────────────────────────────────────────────
  {
    id: 'plans',
    title: 'Plans',
    description: 'View, create, and approve annual KPI performance plans',
    keywords: ['annual plan', 'performance plan', 'kpi plan', 'target plan', 'head office plan', 'plan creation', 'plan approval', 'budget plan', 'fiscal plan'],
    href: '/dashboard/plans',
    icon: <BarChart3 className="h-4 w-4 shrink-0" />,
    category: 'Plans & Allocation',
    permissions: [
      'view_plans', 'create_plans', 'approve_plans_head_office', 'edit_active_plans',
      'allocate_plans_to_districts', 'approve_district_allocations',
      'allocate_district_plans_to_branches', 'approve_branch_allocations',
    ],
    noActingUser: true,
  },
  {
    id: 'branch-allocation',
    title: 'Branch Allocation',
    description: 'Distribute district KPI plan targets across individual branches',
    keywords: ['allocate', 'plan allocation', 'branch plan', 'district allocation', 'distribute targets', 'plan distribution', 'target cascade'],
    href: '/dashboard/branch-allocation',
    icon: <Network className="h-4 w-4 shrink-0" />,
    category: 'Plans & Allocation',
    permissions: ['allocate_district_plans_to_branches', 'approve_branch_allocations'],
    noActingUser: true,
  },

  // ── Approvals & Reviews ───────────────────────────────────────────────────
  {
    id: 'approvals',
    title: 'Approvals Center',
    description: 'Review and action all pending KPI, lead, job, and plan approvals',
    keywords: ['approve', 'pending', 'review', 'reject', 'approval queue', 'pending approval', 'workflow', 'authorize', 'pending items'],
    href: '/dashboard/approvals',
    icon: <CheckSquare className="h-4 w-4 shrink-0" />,
    category: 'Approvals & Reviews',
    permissions: [
      'approve_branch_allocations', 'manage_branch_allocations', 'approve_staff_progress',
      'manage_jobs', 'manage_leads', 'assign_leads', 'assign_staff_targets', 'manage_general_settings',
    ],
    noActingUser: true,
  },

  // ── Reports & Analytics ───────────────────────────────────────────────────
  {
    id: 'performance-reports',
    title: 'Performance Reports',
    description: 'KPI achievement analysis across the HO → District → Branch → Staff chain',
    keywords: [
      'report', 'analytics', 'kpi report', 'achievement analysis', 'scorecard',
      'performance analysis', 'branch performance', 'staff performance', 'trend analysis',
      'target vs actual', 'cascade report', 'kpi drill down', 'monthly report',
    ],
    href: '/dashboard/performance-reports',
    icon: <BarChart2 className="h-4 w-4 shrink-0" />,
    category: 'Reports & Analytics',
    permissions: ['view_reports'],
    noActingUser: true,
  },
  {
    id: 'rm-report',
    title: 'RM Report',
    description: 'Relationship manager performance and client activity report',
    keywords: ['rm report', 'relationship manager', 'manager report', 'account manager', 'rm performance'],
    href: '/dashboard/rm-report',
    icon: <FileBarChart2 className="h-4 w-4 shrink-0" />,
    category: 'Reports & Analytics',
    permissions: ['view_rm_report'],
    noActingUser: true,
  },

  // ── Administration ────────────────────────────────────────────────────────
  {
    id: 'admin-users',
    title: 'User Management',
    description: 'Create, edit, activate, or deactivate system user accounts',
    keywords: ['users', 'staff', 'accounts', 'employees', 'user list', 'add user', 'create user', 'deactivate user', 'user admin'],
    href: '/dashboard/admin/users',
    icon: <UsersRound className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_users', 'view_users'],
    noActingUser: true,
  },
  {
    id: 'admin-roles',
    title: 'Roles & Permissions',
    description: 'Define user roles and configure granular access permissions',
    keywords: ['role', 'permission', 'access control', 'role management', 'user role', 'authorization', 'rbac', 'privileges'],
    href: '/dashboard/admin/roles',
    icon: <ShieldCheck className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_roles', 'view_roles'],
    noActingUser: true,
  },
  {
    id: 'admin-branches',
    title: 'Branch Management',
    description: 'Add, edit, and configure bank branches and their district assignments',
    keywords: ['branch', 'bank branch', 'branch config', 'manage branches', 'branch list', 'branch setup'],
    href: '/dashboard/admin/branches',
    icon: <Building2 className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_branches', 'view_branches'],
    noActingUser: true,
  },
  {
    id: 'admin-districts',
    title: 'District Management',
    description: 'Configure districts and assign branches to geographic regions',
    keywords: ['district', 'region', 'territory', 'district list', 'manage district', 'geographic'],
    href: '/dashboard/admin/districts',
    icon: <MapPin className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_districts', 'view_districts'],
    noActingUser: true,
  },
  {
    id: 'admin-departments',
    title: 'Department Management',
    description: 'Manage organizational departments and their structure',
    keywords: ['department', 'dept', 'org structure', 'organizational unit', 'team'],
    href: '/dashboard/admin/departments',
    icon: <Layers className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_departments', 'view_departments'],
    noActingUser: true,
  },
  {
    id: 'admin-divisions',
    title: 'Division Management',
    description: 'Manage business divisions and their organizational assignments',
    keywords: ['division', 'business unit', 'unit management', 'org division', 'business division'],
    href: '/dashboard/admin/divisions',
    icon: <GitBranch className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_divisions', 'view_divisions'],
    noActingUser: true,
  },
  {
    id: 'admin-offices',
    title: 'Office Management',
    description: 'Manage physical office locations and their configurations',
    keywords: ['office', 'location', 'office list', 'physical location', 'work location'],
    href: '/dashboard/admin/offices',
    icon: <Building2 className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_offices', 'view_offices'],
    noActingUser: true,
  },
  {
    id: 'admin-kpi-config',
    title: 'KPI Configuration',
    description: 'Set up KPI metrics, measurement units, and calculation rules',
    keywords: ['kpi config', 'metric setup', 'kpi settings', 'performance indicator', 'indicator config', 'kpi types', 'measurement unit'],
    href: '/dashboard/admin/kpi-config',
    icon: <Settings2 className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_kpi_config'],
    noActingUser: true,
  },
  {
    id: 'admin-holidays',
    title: 'Public Holidays',
    description: 'Manage holiday calendar for accurate working-day calculations',
    keywords: ['holiday', 'public holiday', 'calendar', 'working days', 'non-working day', 'bank holiday', 'national holiday'],
    href: '/dashboard/admin/public-holidays',
    icon: <CalendarDays className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_public_holidays'],
    noActingUser: true,
  },
  {
    id: 'admin-security',
    title: 'Security Logs',
    description: 'Monitor security events, login attempts, and suspicious activity',
    keywords: ['security', 'audit log', 'login history', 'security event', 'access log', 'breach', 'failed login', 'lockout'],
    href: '/dashboard/admin/security',
    icon: <ShieldAlert className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_security_logs', 'view_security_logs'],
    noActingUser: true,
  },
  {
    id: 'admin-general',
    title: 'General Settings',
    description: 'Configure system-wide application settings and preferences',
    keywords: ['settings', 'configuration', 'system settings', 'app config', 'preferences', 'general config', 'system config'],
    href: '/dashboard/admin/general',
    icon: <Settings className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_general_settings'],
    noActingUser: true,
  },
  {
    id: 'admin-email',
    title: 'Email Settings',
    description: 'Configure email server (SMTP) and notification templates',
    keywords: ['email', 'smtp', 'email server', 'mail config', 'email template', 'notification email', 'outgoing mail'],
    href: '/dashboard/admin/email',
    icon: <Mail className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_email_settings'],
    noActingUser: true,
  },
  {
    id: 'admin-gps',
    title: 'GPS Verifications',
    description: 'Review and manage staff GPS location check-in verifications',
    keywords: ['gps', 'location', 'verification', 'check-in', 'geolocation', 'location verify', 'attendance location'],
    href: '/dashboard/admin/gps-verifications',
    icon: <MapPin className="h-4 w-4 shrink-0" />,
    category: 'Administration',
    permissions: ['manage_gps_verification'],
    noActingUser: true,
  },

  // ── Profile & Account ─────────────────────────────────────────────────────
  {
    id: 'profile',
    title: 'My Profile',
    description: 'View and update your personal profile and contact information',
    keywords: ['profile', 'my account', 'personal info', 'account', 'bio', 'my details', 'name', 'contact'],
    href: '/dashboard/profile',
    icon: <User className="h-4 w-4 shrink-0" />,
    category: 'Profile & Account',
    permissions: [],
  },
  {
    id: 'change-password',
    title: 'Change Password',
    description: 'Update your account password to maintain account security',
    keywords: ['password', 'change password', 'update password', 'security', 'new password', 'reset password'],
    href: '/dashboard/profile?tab=security',
    icon: <Lock className="h-4 w-4 shrink-0" />,
    category: 'Profile & Account',
    permissions: [],
  },
];

// ── Filter logic ───────────────────────────────────────────────────────────────
function filterItems(user: LoggedInUser): SearchItem[] {
  const perms = (user.role?.permissions ?? '').split(',').filter(Boolean) as Permission[];
  const hasAny = (...required: Permission[]) =>
    required.length === 0 || required.some(p => perms.includes(p));

  return SEARCH_ITEMS.filter(item => {
    if (item.noActingUser && user.actingUser) return false;
    if (item.requiresBranchId && !user.branchId) return false;
    if (!hasAny(...item.permissions)) return false;
    return true;
  });
}

// ── Search trigger button ──────────────────────────────────────────────────────
// Exported separately so it can be placed in the header
function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open global search"
      className="group flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline-block max-w-[140px] truncate">Search features...</span>
      <span className="hidden lg:flex items-center gap-0.5 ml-1">
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          Ctrl K
        </kbd>
      </span>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function GlobalSearch({ user }: { user: LoggedInUser }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = useMemo(() => filterItems(user), [user]);

  // Group filtered items by category, preserving defined order
  const groups = useMemo(() => {
    const map = new Map<SearchCategory, SearchItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of items) map.get(item.category)?.push(item);
    return [...map.entries()].filter(([, list]) => list.length > 0);
  }, [items]);

  const handleSelect = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <SearchTrigger onClick={() => setOpen(true)} />

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, features, and actions…" />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
              <Search className="h-8 w-8 opacity-30" />
              <p className="text-sm">No results found.</p>
              <p className="text-xs opacity-70">Try a different keyword or phrase.</p>
            </div>
          </CommandEmpty>

          {groups.map(([category, groupItems], idx) => (
            <div key={category}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup heading={category}>
                {groupItems.map(item => (
                  <CommandItem
                    key={item.id}
                    value={`${item.title} ${item.description} ${item.keywords.join(' ')}`}
                    onSelect={() => handleSelect(item.href)}
                    className="group flex items-start gap-3 py-2.5 cursor-pointer"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground transition-colors group-aria-selected:border-primary/30 group-aria-selected:bg-primary/5 group-aria-selected:text-primary">
                      {item.icon}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium leading-none">{item.title}</span>
                      <span className="text-xs text-muted-foreground leading-snug line-clamp-1">
                        {item.description}
                      </span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-1 text-muted-foreground/40 opacity-0 transition-opacity group-aria-selected:opacity-100" />
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>

        {/* Footer */}
        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border bg-background px-1 font-mono text-[10px]">↑</kbd>
              <kbd className="inline-flex h-4 items-center rounded border bg-background px-1 font-mono text-[10px]">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border bg-background px-1 font-mono text-[10px]">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 items-center rounded border bg-background px-1 font-mono text-[10px]">Esc</kbd>
              close
            </span>
          </div>
          <span className="opacity-60">{items.length} feature{items.length !== 1 ? 's' : ''} available</span>
        </div>
      </CommandDialog>
    </>
  );
}

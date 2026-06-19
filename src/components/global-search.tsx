'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';
import {
  Home, UsersRound, Building2, Settings, ShieldAlert, ShieldCheck, Mail, MapPin,
  Lock, User, Layers, Search, GitBranch, ArrowRight,
} from 'lucide-react';
import type { LoggedInUser, Permission } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────────────────
type SearchCategory =
  | 'Navigation'
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

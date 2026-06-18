
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { FilePlus, PanelLeft, Shield, User as UserIcon, ShieldAlert, AlertCircle, Trophy, TrendingUp, CalendarDays, Target, Users, BarChart3, Target as TargetIcon, Briefcase, UsersRound, Users2, BarChart2, Home, FileBarChart2, Crosshair, CheckSquare } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import type { Permission, LoggedInUser } from '@/lib/types';
import { getAdminAccessPermissions } from '@/lib/permissions';
import { GlobalSearch } from '@/components/global-search';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import Logo from '@/components/logo';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserNav } from '@/components/user-nav';
import { NotificationBell } from '@/components/notification-bell';
import { HoneycombLoader } from '@/components/honeycomb-loader';
import { SessionTimeoutManager } from '@/components/session-timeout-manager';
import { ThemeToggle } from '@/components/theme-toggle';
import { Breadcrumb } from '@/components/breadcrumb';

interface DashboardContentWrapperProps {
  user: LoggedInUser | null;
  children: React.ReactNode;
}

export function DashboardContentWrapper({ user, children }: DashboardContentWrapperProps) {
  const pathname = usePathname();
  const [isMounted, setIsMounted] = useState(false);
  const { update: updateSession } = useSession();

  const permissions = useMemo(() => user?.role?.permissions?.split(',') || [], [user?.role?.permissions]);

  // Any permission that gates an admin/* page grants admin nav access
  const hasAdminAccess = useMemo(() => {
    if (!user) return false;
    const adminPagePerms = getAdminAccessPermissions();
    return adminPagePerms.some(p => permissions.includes(p));
  }, [user, permissions]);

  const navItems = useMemo(() => {
    if (!user) return [];
    const userPermissions = user.role?.permissions?.split(',') || [];
    
    return [
      { href: "/dashboard", icon: <Home />, label: "Dashboard", active: pathname === '/dashboard', visible: !user.actingUser && userPermissions.includes('view_dashboard') },
      {
        href: "/dashboard/branch-targets",
        icon: <Target />,
        label: "Branch Targets",
        active: pathname.startsWith('/dashboard/branch-targets'),
        visible: !user.actingUser && !!user.branchId && (
          userPermissions.includes('view_branch_targets') ||
          userPermissions.includes('assign_staff_targets')
        ),
      },
      {
        href: "/dashboard/branch-allocation",
        icon: <Users />,
        label: "Branch Allocation",
        active: pathname.startsWith('/dashboard/branch-allocation'),
        visible: !user.actingUser && (
          userPermissions.includes('allocate_district_plans_to_branches') ||
          userPermissions.includes('approve_branch_allocations')
        ),
      },
      { href: "/dashboard/plans", icon: <BarChart3 />, label: "Plans", active: pathname.startsWith('/dashboard/plans'), visible: !user.actingUser && (['view_plans','create_plans','approve_plans_head_office','edit_active_plans','allocate_plans_to_districts','approve_district_allocations','allocate_district_plans_to_branches','approve_branch_allocations'] as const).some(p => userPermissions.includes(p)) },
      { href: "/dashboard/leads", icon: <TargetIcon />, label: "Leads", active: pathname.startsWith('/dashboard/leads'), visible: !user.actingUser && userPermissions.includes('view_leads') },
      { href: "/dashboard/jobs", icon: <Briefcase />, label: "Jobs", active: pathname.startsWith('/dashboard/jobs'), visible: !user.actingUser && userPermissions.includes('view_jobs') },
      { href: "/dashboard/customers", icon: <Users2 />, label: "Customers", active: pathname.startsWith('/dashboard/customers'), visible: !user.actingUser && userPermissions.includes('view_customers') },
      { href: "/dashboard/customer-visits", icon: <UsersRound />, label: "Customer Visits", active: pathname.startsWith('/dashboard/customer-visits'), visible: !user.actingUser && userPermissions.includes('view_customer_visits') },
      { href: "/dashboard/daily-targets", icon: <CalendarDays />, label: "Daily Targets", active: pathname.startsWith('/dashboard/daily-targets'), visible: !user.actingUser && userPermissions.includes('view_daily_targets') },
      {
        href: "/dashboard/my-targets",
        icon: <Crosshair />,
        label: "My Targets",
        active: pathname.startsWith('/dashboard/my-targets'),
        visible: !user.actingUser && userPermissions.includes('view_my_targets'),
      },
      {
        href: "/dashboard/approvals",
        icon: <CheckSquare />,
        label: "Approvals Center",
        active: pathname.startsWith('/dashboard/approvals'),
        visible: !user.actingUser && (
          userPermissions.includes('approve_branch_allocations') ||
          userPermissions.includes('manage_branch_allocations') ||
          userPermissions.includes('approve_staff_progress') ||
          userPermissions.includes('manage_jobs') ||
          userPermissions.includes('manage_leads') ||
          userPermissions.includes('assign_leads') ||
          userPermissions.includes('assign_staff_targets') ||
          userPermissions.includes('manage_general_settings')
        ),
      },
      { href: "/dashboard/rm-report", icon: <FileBarChart2 />, label: "RM Report", active: pathname.startsWith('/dashboard/rm-report'), visible: !user.actingUser && userPermissions.includes('view_rm_report') },
      { href: "/dashboard/performance-reports", icon: <BarChart2 />, label: "Performance Reports", active: pathname.startsWith('/dashboard/performance-reports'), visible: !user.actingUser && userPermissions.includes('view_reports') },
      { href: "/dashboard/profile", icon: <UserIcon />, label: "Profile", active: pathname === '/dashboard/profile', visible: !user.actingUser },
      { href: "/dashboard/admin", icon: <Shield />, label: "Admin", active: pathname.startsWith('/dashboard/admin'), visible: hasAdminAccess && !user.actingUser },
      { href: "/dashboard/access-denied", icon: <ShieldAlert />, label: "Access Denied", active: pathname === '/dashboard/access-denied', visible: true, className: "hidden" },
    ];
  }, [user, pathname, hasAdminAccess]);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || !user) {
    return <div className="h-screen w-full flex items-center justify-center bg-background"><HoneycombLoader /></div>;
  }

  return (
    <>
    <SessionTimeoutManager />
    <div className="grid min-h-screen w-full transition-[grid-template-columns] ease-in-out duration-300 md:grid-cols-[var(--sidebar-width)_1fr]">
      <Sidebar collapsible="icon" className="hidden md:flex no-print">
        <SidebarContent>
          <SidebarHeader className="h-14 lg:h-[60px] border-b justify-center">
            <div className="flex items-center group-data-[collapsible=icon]:justify-center">
              <Logo className="group-data-[collapsible=icon]:hidden" />
              <Logo className="hidden group-data-[collapsible=icon]:flex" hideText />
            </div>
          </SidebarHeader>
          <SidebarMenu className="flex-1 px-3">
            {navItems.filter(item => item.visible).map(item => (
              <SidebarMenuItem key={item.label} className={item.className}>
                <Link href={item.href}>
                  <SidebarMenuButton tooltip={item.label} isActive={item.active}>
                    {item.icon}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <div className="flex flex-col h-screen">
        <header className="flex h-14 items-center border-b bg-card no-print shrink-0 lg:h-[60px]">
          <div className="flex items-center gap-2 sm:gap-4 w-full h-full px-2 sm:px-4 lg:px-6">
            <Sheet>
              <SheetTrigger asChild>
                <Button size="icon" variant="outline" className="md:hidden shrink-0">
                  <PanelLeft className="h-5 w-5" />
                  <span className="sr-only">Toggle Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="sm:max-w-xs">
                <SheetHeader className="p-4">
                  <SheetTitle className="sr-only">Main Menu</SheetTitle>
                   <Link href="/dashboard/plans" className="flex items-center gap-2">
                      <Logo />
                  </Link>
                </SheetHeader>
                <nav className="grid gap-4 p-4 text-lg font-medium">
                  {navItems.filter(item => item.visible && !item.className?.includes('hidden')).map(item => (
                    <Link key={item.label} href={item.href} className={`flex items-center gap-4 px-2.5 ${item.active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                      {item.icon}
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
            <SidebarTrigger className="hidden md:flex" />
            <div className="md:flex items-center">
              <Breadcrumb />
            </div>
            <div className="w-full flex-1 min-w-0">
              <div className="md:hidden">
                <Breadcrumb />
              </div>
            </div>
            {/* Global search — permission-aware, accessible via Ctrl+K */}
            {user && !user.actingUser && <GlobalSearch user={user} />}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <ThemeToggle />
              <NotificationBell />
              {user && <UserNav user={user} />}
            </div>
          </div>
        </header>
        <main className="flex flex-1 flex-col bg-muted/40 overflow-y-auto overflow-x-auto no-print">
          <div className="flex-1 p-2 sm:p-4 min-h-0 min-w-0">
            {children}
          </div>
        </main>
        <div className="hidden print:block">
          {children}
        </div>
      </div>
    </div>
    </>
  );
}

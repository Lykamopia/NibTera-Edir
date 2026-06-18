'use client';

import { Shield, User as UserIcon, MoreHorizontal, ShieldAlert, Info, BarChart3, CalendarDays, Target, Users, Target as TargetIcon, Briefcase, Trophy, UsersRound, Users2, BarChart2, Home, CheckSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { Permission, User } from '@/lib/types';
import { getAdminAccessPermissions } from '@/lib/permissions';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import Logo from './logo';

interface BottomNavigationProps {
  user: User & { role: { permissions: Permission[] } };
}

export function BottomNavigation({ user }: BottomNavigationProps) {
  const pathname = usePathname();
  const userPermissions = user.role?.permissions?.split(',') || [];
  const adminAccessPermissions = getAdminAccessPermissions();
  const hasAdminAccess = adminAccessPermissions.some(p => userPermissions.includes(p));

  const allNavItems: { href: string; icon: JSX.Element; label: string; active: boolean; visible: boolean; className?: string }[] = [
    { href: "/dashboard", icon: <Home />, label: "Dashboard", active: pathname === '/dashboard', visible: user.role?.permissions?.split(',').includes('view_dashboard') },
    { href: "/dashboard/plans", icon: <BarChart3 />, label: "Plans", active: pathname.startsWith('/dashboard/plans'), visible: user.role?.permissions?.split(',').includes('view_plans') },
    { href: "/dashboard/leads", icon: <TargetIcon />, label: "Leads", active: pathname.startsWith('/dashboard/leads'), visible: user.role?.permissions?.split(',').includes('view_leads') },
    { href: "/dashboard/jobs", icon: <Briefcase />, label: "Jobs", active: pathname.startsWith('/dashboard/jobs'), visible: user.role?.permissions?.split(',').includes('view_jobs') },
    { href: "/dashboard/customers", icon: <Users2 />, label: "Customers", active: pathname.startsWith('/dashboard/customers'), visible: user.role?.permissions?.split(',').includes('view_customers') },
    { href: "/dashboard/customer-visits", icon: <UsersRound />, label: "Customer Visits", active: pathname.startsWith('/dashboard/customer-visits'), visible: user.role?.permissions?.split(',').includes('view_customer_visits') },
    { href: "/dashboard/performance-reports", icon: <BarChart2 />, label: "Performance Reports", active: pathname.startsWith('/dashboard/performance-reports'), visible: user.role?.permissions?.split(',').includes('view_reports') },
  ];

  if (user.districtId) {
    allNavItems.push({
      href: "/dashboard/branch-allocation",
      icon: <Users />,
      label: "Branch Allocation",
      active: pathname.startsWith('/dashboard/branch-allocation'),
      visible: true,
    });
  }

  if (user.branchId) {
    allNavItems.push({
      href: "/dashboard/branch-targets",
      icon: <Target />,
      label: "My Targets",
      active: pathname.startsWith('/dashboard/branch-targets'),
      visible: true,
    });
  }

  allNavItems.push(
    { href: "/dashboard/daily-targets", icon: <CalendarDays />, label: "Daily Targets", active: pathname.startsWith('/dashboard/daily-targets'), visible: true },
    {
      href: "/dashboard/approvals",
      icon: <CheckSquare />,
      label: "Approvals",
      active: pathname.startsWith('/dashboard/approvals'),
      visible: (user.role?.permissions as any)?.includes?.('approve_branch_allocations') ||
               (user.role?.permissions as any)?.includes?.('approve_staff_progress') ||
               (user.role?.permissions as any)?.includes?.('manage_jobs') ||
               (user.role?.permissions as any)?.includes?.('assign_staff_targets'),
    },
    { href: "/dashboard/profile", icon: <UserIcon />, label: "Profile", active: pathname === '/dashboard/profile', visible: true },
    { href: "/dashboard/about", icon: <Info />, label: "About", active: pathname.startsWith('/dashboard/about'), visible: true },
    { href: "/dashboard/admin", icon: <Shield />, label: "Admin", active: pathname.startsWith('/dashboard/admin'), visible: hasAdminAccess },
    { href: "/dashboard/access-denied", icon: <ShieldAlert />, label: "Access Denied", active: pathname === '/dashboard/access-denied', visible: true, className: "hidden" },
  );

  const visibleNavItems = allNavItems.filter(item => item.visible && !item.className?.includes('hidden'));

  const mainItems = visibleNavItems.slice(0, 4);
  const moreItems = visibleNavItems.slice(4);

  const NavItem = ({ item }: { item: typeof visibleNavItems[0] }) => (
    <Link href={item.href} className="flex flex-col items-center justify-center text-center gap-1 text-xs font-medium">
      <div className={cn("relative w-8 h-8 flex items-center justify-center rounded-full transition-colors", item.active && "bg-primary/10 text-primary")}>
        {item.icon}
      </div>
      <span className={cn("text-muted-foreground", item.active && "text-primary")}>{item.label}</span>
    </Link>
  );

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 h-[calc(env(safe-area-inset-bottom,0)+4.5rem)] bg-card border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.05)] md:hidden z-40">
        <div className="flex justify-around items-center h-full max-w-md mx-auto px-4 pb-[env(safe-area-inset-bottom,0)]">
          {mainItems.map(item => (
            <NavItem key={item.href} item={item} />
          ))}

          {moreItems.length > 0 && (
            <Sheet>
              <SheetTrigger asChild>
                <div className="flex flex-col items-center justify-center text-center gap-1 text-xs font-medium text-muted-foreground">
                  <div className="w-8 h-8 flex items-center justify-center rounded-full">
                    <MoreHorizontal />
                  </div>
                  <span>More</span>
                </div>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-lg">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2"><Logo hideText /> More Options</SheetTitle>
                </SheetHeader>
                <nav className="grid gap-2 py-4">
                  {moreItems.map(item => (
                    <Link key={item.href} href={item.href} className={cn("flex items-center gap-4 p-3 rounded-md", item.active ? 'bg-muted text-primary' : 'text-foreground')}>
                      <div className={cn("p-2 rounded-full", item.active ? 'bg-primary/10' : 'bg-muted')}>
                        {item.icon}
                      </div>
                      <span className="font-medium">{item.label}</span>
                    </Link>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
      {/* Spacer to prevent content from being hidden behind the bottom nav */}
      <div className="h-[calc(env(safe-area-inset-bottom,0)+4.5rem)] md:hidden" />
    </>
  );
}

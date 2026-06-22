'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import { PanelLeft } from 'lucide-react';

import type { LoggedInUser, Permission } from '@/lib/types';
import { buildNav } from '@/lib/nav';
import { getPendingApprovalCount } from '@/app/actions/approvals';

import {
  Sidebar, SidebarContent, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import Logo from '@/components/logo';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { UserNav } from '@/components/user-nav';
import { NotificationBell } from '@/components/notification-bell';
import { EdirSwitcher } from '@/components/edir-switcher';
import { HoneycombLoader } from '@/components/honeycomb-loader';
import { SessionTimeoutManager } from '@/components/session-timeout-manager';
import { ThemeToggle } from '@/components/theme-toggle';
import { Breadcrumb } from '@/components/breadcrumb';

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as any)[name] ?? Icons.Circle;
  return <Cmp className={className} />;
}

/** Edir identity on the right of the header so members always know their Edir. */
function EdirBadge({ edir }: { edir?: { name?: string | null; logoUrl?: string | null } | null }) {
  if (!edir?.name) return null;
  const initials = edir.name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1 shadow-sm">
      {edir.logoUrl
        ? <img src={edir.logoUrl} alt={edir.name} className="h-7 w-7 rounded-md object-contain" />
        : <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-primary">{initials}</span>}
      <span className="hidden max-w-[160px] truncate text-sm font-semibold sm:inline">{edir.name}</span>
    </div>
  );
}

export function DashboardContentWrapper({ user, children }: { user: LoggedInUser | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMounted, setIsMounted] = useState(false);
  const [pending, setPending] = useState(0);

  const permissions = useMemo(() => (user?.role?.permissions?.split(',').filter(Boolean) || []) as Permission[], [user?.role?.permissions]);
  const isSuperAdmin = useMemo(() => (user?.role as any)?.scope === 'SUPER_ADMIN' || permissions.includes('super_admin'), [user?.role, permissions]);
  const sections = useMemo(() => (user ? buildNav(permissions, isSuperAdmin) : []), [user, permissions, isSuperAdmin]);

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => {
    let active = true;
    getPendingApprovalCount().then(c => { if (active) setPending(c); }).catch(() => {});
    return () => { active = false; };
  }, [pathname]);

  if (!isMounted || !user) {
    return <div className="h-screen w-full flex items-center justify-center bg-background"><HoneycombLoader /></div>;
  }

  const isActive = (path: string) => (path === '/dashboard' ? pathname === path : pathname.startsWith(path));

  const NavLinks = () => (
    <>
      {sections.map(section => (
        <div key={section.id} className="mb-2">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 group-data-[collapsible=icon]:hidden">{section.label}</div>
          {section.items.map(item => (
            <SidebarMenuItem key={item.id}>
              <Link href={item.path}>
                <SidebarMenuButton tooltip={item.label} isActive={isActive(item.path)}>
                  <Icon name={item.icon} />
                  <span className="flex-1">{item.label}</span>
                  {item.id === 'approvals' && pending > 0 && (
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden">{pending}</span>
                  )}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </div>
      ))}
    </>
  );

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
            <SidebarMenu className="flex-1 px-3 py-2">
              <NavLinks />
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
        <div className="flex flex-col h-screen">
          <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-card/60 backdrop-blur-md no-print shrink-0 lg:h-[60px]">
            <div className="flex items-center gap-2 sm:gap-4 w-full h-full px-2 sm:px-4 lg:px-6">
              <Sheet>
                <SheetTrigger asChild>
                  <Button size="icon" variant="outline" className="md:hidden shrink-0">
                    <PanelLeft className="h-5 w-5" />
                    <span className="sr-only">Toggle Menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="sm:max-w-xs p-0">
                  <SheetHeader className="p-4 border-b">
                    <SheetTitle className="sr-only">Main Menu</SheetTitle>
                    <Link href="/dashboard" className="flex items-center gap-2"><Logo /></Link>
                  </SheetHeader>
                  <nav className="p-3"><SidebarMenu><NavLinks /></SidebarMenu></nav>
                </SheetContent>
              </Sheet>
              <SidebarTrigger className="hidden md:flex" />
              <div className="hidden md:flex items-center"><Breadcrumb /></div>
              <div className="w-full flex-1" />
              <EdirSwitcher />
              <EdirBadge edir={(user as any)?.edir} />
              <ThemeToggle />
              <NotificationBell />
              {user && <UserNav user={user as any} />}
            </div>
          </header>
          <main className="flex flex-1 flex-col bg-muted/40 overflow-auto no-print">
            <div key={pathname} className="page-enter mx-auto w-full max-w-7xl flex-1 p-4 min-h-0 min-w-0 sm:p-6">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}

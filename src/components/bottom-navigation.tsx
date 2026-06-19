'use client';

import { MoreHorizontal, User as UserIcon, Home } from 'lucide-react';
import * as Icons from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { Permission, User } from '@/lib/types';
import { buildNav } from '@/lib/nav';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import Logo from './logo';

function Icon({ name }: { name: string }) {
  const Cmp = (Icons as any)[name] ?? Icons.Circle;
  return <Cmp />;
}

export function BottomNavigation({ user }: { user: User & { role: { permissions: string; scope?: string } | null } }) {
  const pathname = usePathname();
  const permissions = (user.role?.permissions?.split(',').filter(Boolean) || []) as Permission[];
  const isSuperAdmin = (user.role as any)?.scope === 'SUPER_ADMIN' || permissions.includes('super_admin');
  const items = buildNav(permissions, isSuperAdmin).flatMap(s => s.items);

  const isActive = (path: string) => (path === '/dashboard' ? pathname === path : pathname.startsWith(path));
  const main = items.slice(0, 4);
  const more = items.slice(4);

  const NavLink = ({ path, icon, label }: { path: string; icon: string; label: string }) => (
    <Link href={path} className="flex flex-col items-center justify-center text-center gap-1 text-xs font-medium">
      <div className={cn('relative w-8 h-8 flex items-center justify-center rounded-full transition-colors', isActive(path) && 'bg-primary/10 text-primary')}>
        <Icon name={icon} />
      </div>
      <span className={cn('text-muted-foreground truncate max-w-16', isActive(path) && 'text-primary')}>{label}</span>
    </Link>
  );

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 h-[calc(env(safe-area-inset-bottom,0)+4.5rem)] bg-card border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.05)] md:hidden z-40">
        <div className="flex justify-around items-center h-full max-w-md mx-auto px-4 pb-[env(safe-area-inset-bottom,0)]">
          {main.map(item => <NavLink key={item.id} path={item.path} icon={item.icon} label={item.label} />)}
          {more.length > 0 && (
            <Sheet>
              <SheetTrigger asChild>
                <div className="flex flex-col items-center justify-center text-center gap-1 text-xs font-medium text-muted-foreground">
                  <div className="w-8 h-8 flex items-center justify-center rounded-full"><MoreHorizontal /></div>
                  <span>More</span>
                </div>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-lg">
                <SheetHeader><SheetTitle className="flex items-center gap-2"><Logo hideText /> More</SheetTitle></SheetHeader>
                <nav className="grid gap-2 py-4">
                  {more.map(item => (
                    <Link key={item.id} href={item.path} className={cn('flex items-center gap-4 p-3 rounded-md', isActive(item.path) ? 'bg-muted text-primary' : 'text-foreground')}>
                      <div className={cn('p-2 rounded-full', isActive(item.path) ? 'bg-primary/10' : 'bg-muted')}><Icon name={item.icon} /></div>
                      <span className="font-medium">{item.label}</span>
                    </Link>
                  ))}
                  <Link href="/dashboard/account" className="flex items-center gap-4 p-3 rounded-md text-foreground">
                    <div className="p-2 rounded-full bg-muted"><UserIcon /></div>
                    <span className="font-medium">My Account</span>
                  </Link>
                </nav>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>
      <div className="h-[calc(env(safe-area-inset-bottom,0)+4.5rem)] md:hidden" />
    </>
  );
}

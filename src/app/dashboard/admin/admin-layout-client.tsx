
'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { LoggedInUser } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatePresence } from 'framer-motion';
import { AnimatedContent } from '@/components/animated-content';
import { navItemsConfig, type NavItemConfig } from './config';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreHorizontal } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { AdminDataProvider, useAdminData } from './hooks';
import AccessDeniedClient from '../access-denied/access-denied-client';


function useAdminNavigation(user: LoggedInUser | null) {
  const pathname = usePathname();
  const router = useRouter();

  const accessibleNavItems = useMemo(() => {
    if (!user || !user.role?.permissions) return [];
    const userPermissions = user.role.permissions.split(',');
    return navItemsConfig.filter(item => {
      const requiredPermissions = Array.isArray(item.permission) ? item.permission : [item.permission];
      return requiredPermissions.some(p => userPermissions.includes(p));
    });
  }, [user]);

  const activeTab = useMemo(() => {
    // Find the best-matching tab for the current path
    return accessibleNavItems.find(item => pathname.startsWith(item.value))?.value || null;
  }, [accessibleNavItems, pathname]);

  useEffect(() => {
    if (user && accessibleNavItems.length > 0) {
      const currentTabIsValid = accessibleNavItems.some(item => pathname.startsWith(item.value));
      // If the current URL doesn't match any accessible tab, redirect to the first accessible one.
      if (!currentTabIsValid) {
        router.replace(accessibleNavItems[0].value);
      }
    }
  }, [user, pathname, accessibleNavItems, router]);

  return { activeTab, accessibleNavItems };
}

function AdminPageContent({ user, activeTab, accessibleNavItems, handleTabChange, children, sidebarState }: {
    user: LoggedInUser;
    activeTab: string | null;
    accessibleNavItems: NavItemConfig[];
    handleTabChange: (value: string) => void;
    children: React.ReactNode;
    sidebarState: 'expanded' | 'collapsed';
}) {
    const tabsListRef = useRef<HTMLDivElement>(null);
    const [visibleItems, setVisibleItems] = useState(accessibleNavItems);
    const [hiddenItems, setHiddenItems] = useState<typeof accessibleNavItems>([]);

    const updateVisibleTabs = useCallback(() => {
        if (!tabsListRef.current) return;
        
        const container = tabsListRef.current;
        const containerWidth = container.offsetWidth;
        const moreButtonWidth = 80; // Approx width for "More" button

        let totalWidth = 0;
        let newVisible: NavItemConfig[] = [];
        let newHidden: NavItemConfig[] = [];

        // Create a hidden temporary container to measure tab widths without affecting the layout
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.visibility = 'hidden';
        tempContainer.style.display = 'flex';
        tempContainer.style.height = '0';
        tempContainer.style.overflow = 'hidden';
        document.body.appendChild(tempContainer);

        const tabElements = accessibleNavItems.map(item => {
            const el = document.createElement('button');
            // This class must match the TabsTrigger for accurate measurement
            el.className = 'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium gap-2';
            // Simulate the icon taking up its space.
            el.innerHTML = `<span style="width:1rem; height:1rem; flex-shrink: 0;"></span><span>${item.label}</span>`;
            tempContainer.appendChild(el);
            return el;
        });

        // Determine which items fit and which should be in the "More" menu
        const maxVisibleTabs = sidebarState === 'expanded' ? 9 : 11;
        let needsDropdown = false;
        for (let i = 0; i < tabElements.length; i++) {
            const itemWidth = tabElements[i].offsetWidth;
            // The check is against the container width minus the space needed for the "More" button
            // AND also check against the max number of tabs.
            if (needsDropdown || (totalWidth + itemWidth > containerWidth - moreButtonWidth) || newVisible.length >= maxVisibleTabs) {
                needsDropdown = true;
                newHidden.push(accessibleNavItems[i]);
            } else {
                newVisible.push(accessibleNavItems[i]);
                totalWidth += itemWidth;
            }
        }
        
        document.body.removeChild(tempContainer);

        setVisibleItems(newVisible);
        setHiddenItems(newHidden);

    }, [accessibleNavItems, sidebarState]);

    useEffect(() => {
        const observer = new ResizeObserver(updateVisibleTabs);
        const container = tabsListRef.current;
        if (container) {
            observer.observe(container);
        }
        updateVisibleTabs(); // Initial calculation
        return () => {
            if (container) {
                observer.unobserve(container);
            }
        }
    }, [updateVisibleTabs]);

    if (!activeTab) {
        return <Skeleton className="h-[200px] w-full" />;
    }

    const isMoreMenuActive = hiddenItems.some(item => item.value === activeTab);

    return (
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b">
                <TabsList ref={tabsListRef} className="relative flex h-auto w-full justify-start p-1">
                    {visibleItems.map((item) => (
                        <TabsTrigger 
                            key={item.value} 
                            value={item.value}
                            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground flex items-center gap-2"
                        >
                            {React.cloneElement(item.icon as React.ReactElement, { className: 'h-4 w-4' })}
                            {item.label}
                        </TabsTrigger>
                    ))}
                    {hiddenItems.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    className={cn(
                                        "h-9 px-3 data-[state=open]:bg-muted flex items-center gap-2",
                                        isMoreMenuActive && "bg-primary/10 text-primary"
                                    )}
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                    More
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {hiddenItems.map((item) => (
                                    <DropdownMenuItem
                                        key={item.value}
                                        onClick={() => handleTabChange(item.value)}
                                        className={cn("flex items-center gap-2", activeTab === item.value && 'bg-accent')}
                                    >
                                        {React.cloneElement(item.icon as React.ReactElement, { className: 'h-4 w-4' })}
                                        {item.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </TabsList>
            </div>
            <div className="mt-4">
                <AnimatePresence mode="wait">
                    <AnimatedContent key={activeTab}>
                        {children}
                    </AnimatedContent>
                </AnimatePresence>
            </div>
        </Tabs>
    );
}


function AdminLayoutComponent({ user, children, hasAdminAccess }: { user: LoggedInUser; children: React.ReactNode, hasAdminAccess: boolean }) {
  const router = useRouter();
  const { state: sidebarState } = useSidebar();
  const { mutate } = useAdminData();

  const { activeTab, accessibleNavItems } = useAdminNavigation(user);

  if (!hasAdminAccess) {
    return <AccessDeniedClient returnPath="/dashboard" />;
  }
  
  const handleTabChange = (value: string) => {
    router.push(value);
    mutate();
  };
  
  return (
    <Card>
       <CardHeader>
        <CardTitle>Admin Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminPageContent
            user={user}
            activeTab={activeTab}
            accessibleNavItems={accessibleNavItems}
            handleTabChange={handleTabChange}
            sidebarState={sidebarState}
        >
            {children}
        </AdminPageContent>
      </CardContent>
    </Card>
  );
};


export default function AdminLayoutClient({ user, children, hasAdminAccess }: { user: LoggedInUser; children: React.ReactNode, hasAdminAccess: boolean }) {
    return (
        <AdminDataProvider>
            <AdminLayoutComponent user={user} hasAdminAccess={hasAdminAccess}>
                {children}
            </AdminLayoutComponent>
        </AdminDataProvider>
    )
}

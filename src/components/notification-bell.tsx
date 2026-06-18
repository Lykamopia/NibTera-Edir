
"use client";

import { useState } from 'react';
import { Bell, Settings } from 'lucide-react';
import { useNotification } from '@/components/notification-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NotificationList, type NotificationView } from './notification-list';
import { NotificationSettings } from './notification-settings';

export function NotificationBell() {
  const { unreadCount, markAllAsRead, dbUnreadCount, markAllDbAsRead } = useNotification();
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [activeView, setActiveView] = useState<NotificationView>('unread');

  const totalUnread = unreadCount + dbUnreadCount;

  const handleMarkAllAsRead = () => {
    markAllAsRead();
    markAllDbAsRead();
  };

  const handleSettingsDialogClose = (open: boolean) => {
    setIsSettingsDialogOpen(open);
    if (!open) {
      setTimeout(() => {
        const allOverlays = document.querySelectorAll('[data-radix-dialog-overlay], [data-radix-alert-dialog-overlay]');
        allOverlays.forEach(overlay => {
          const state = overlay.getAttribute('data-state');
          if (!state || state === 'closed') {
            (overlay as HTMLElement).style.display = 'none';
            overlay.remove();
          }
        });
        document.body.style.pointerEvents = '';
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
      }, 200);
    }
  };

  return (
    <Dialog open={isSettingsDialogOpen} onOpenChange={handleSettingsDialogClose}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {totalUnread > 0 && (
              <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
            <span className="sr-only">View notifications</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-80 p-0">
          {/* Header row */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <span className="font-semibold text-sm">Notifications</span>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setIsSettingsDialogOpen(true)}
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
          </div>

          {/* View toggle row */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex rounded-md border overflow-hidden text-xs">
              <button
                className={cn(
                  "px-3 py-1 transition-colors",
                  activeView === 'unread'
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setActiveView('unread')}
              >
                Unread
                {totalUnread > 0 && (
                  <span className={cn(
                    "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    activeView === 'unread' ? "bg-primary-foreground/20" : "bg-primary/10 text-primary"
                  )}>
                    {totalUnread}
                  </span>
                )}
              </button>
              <button
                className={cn(
                  "px-3 py-1 transition-colors border-l",
                  activeView === 'history'
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setActiveView('history')}
              >
                History
              </button>
            </div>

            {activeView === 'unread' && totalUnread > 0 && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={handleMarkAllAsRead}
              >
                Mark all read
              </Button>
            )}
          </div>

          <DropdownMenuSeparator className="my-0" />
          <NotificationList view={activeView} />
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Notification Settings</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <NotificationSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
}

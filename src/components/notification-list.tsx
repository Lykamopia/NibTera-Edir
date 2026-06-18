"use client";

import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useNotification, type DbNotification, type Notification } from '@/components/notification-provider';
import { cn } from '@/lib/utils';

export type NotificationView = 'unread' | 'history';
import { formatDistanceToNow } from 'date-fns';
import { ShieldAlert, AlertCircle, Info, Bell, History } from 'lucide-react';
import { BellOffIllustration } from './bell-off-illustration';
import { NotificationIllustration } from './notification-illustration';

type CombinedItem = {
  id: string;
  source: 'db' | 'memory';
  title: string;
  body: string;
  createdAt: Date;
  read: boolean;
  priority: 'critical' | 'high' | 'normal' | 'low';
  linkUrl?: string | null;
};

const PRIORITY_CONFIG = {
  critical: {
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
    dotColor: 'bg-red-500',
    rowBg: 'bg-red-50/60 dark:bg-red-950/20',
    Icon: ShieldAlert,
  },
  high: {
    iconBg: 'bg-orange-100 dark:bg-orange-950/30',
    iconColor: 'text-orange-600',
    dotColor: 'bg-orange-500',
    rowBg: 'bg-orange-50/60 dark:bg-orange-950/10',
    Icon: AlertCircle,
  },
  normal: {
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    dotColor: 'bg-blue-500',
    rowBg: 'bg-primary/5',
    Icon: Info,
  },
  low: {
    iconBg: 'bg-muted',
    iconColor: 'text-muted-foreground',
    dotColor: 'bg-gray-400',
    rowBg: '',
    Icon: Bell,
  },
} as const;

function toMemoryItem(n: Notification): CombinedItem {
  return {
    id: n.id,
    source: 'memory',
    title: typeof n.title === 'string' ? n.title : 'Security Alert',
    body: typeof n.description === 'string' ? n.description : '',
    createdAt: n.createdAt,
    read: n.read,
    priority: n.type === 'security' ? 'critical' : 'normal',
    linkUrl: null,
  };
}

function toDbItem(n: DbNotification): CombinedItem {
  return {
    id: n.id,
    source: 'db',
    title: n.title,
    body: n.body,
    createdAt: n.createdAt,
    read: n.read,
    priority: (n.priority as CombinedItem['priority']) ?? 'normal',
    linkUrl: n.linkUrl,
  };
}

export function NotificationList({ view }: { view: NotificationView }) {
  const router = useRouter();
  const { notifications, dbNotifications, markAsRead, markDbAsRead, settings } = useNotification();

  if (!settings.notificationsEnabled) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <BellOffIllustration />
        <p className="mt-4 font-semibold">Notifications are disabled.</p>
        <p>You can enable them in the settings.</p>
      </div>
    );
  }

  const allItems = [
    ...notifications.map(toMemoryItem),
    ...dbNotifications.map(toDbItem),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const displayItems = view === 'unread'
    ? allItems.filter(item => !item.read)
    : allItems.filter(item => item.read);

  if (displayItems.length === 0) {
    if (view === 'unread') {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
          <NotificationIllustration />
          <p className="mt-4 font-semibold">All caught up!</p>
          <p>No unread notifications.</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <History className="h-12 w-12 opacity-20 mb-3" />
        <p className="font-semibold">No history yet.</p>
        <p>Read notifications will appear here.</p>
      </div>
    );
  }

  const handleClick = (item: CombinedItem) => {
    if (item.source === 'memory') {
      markAsRead(item.id);
    } else {
      markDbAsRead(item.id);
      if (item.linkUrl) {
        router.push(item.linkUrl);
      }
    }
  };

  return (
    <div className="max-h-96 overflow-y-auto">
      <AnimatePresence initial={false}>
        {displayItems.map(item => {
          const cfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.normal;
          const { Icon } = cfg;

          return (
            <motion.div
              key={`${item.source}-${item.id}`}
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              layout
            >
              <div
                className={cn(
                  "flex items-start gap-3 p-3 border-b transition-colors cursor-pointer",
                  view === 'unread'
                    ? cn("hover:bg-muted/50", cfg.rowBg)
                    : "hover:bg-muted/30 opacity-75"
                )}
                onClick={() => view === 'unread' ? handleClick(item) : undefined}
              >
                <div className="relative shrink-0">
                  <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", cfg.iconBg)}>
                    <Icon className={cn("h-4 w-4", cfg.iconColor)} />
                  </div>
                  {view === 'unread' && (
                    <span className={cn(
                      "absolute -top-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full border-2 border-background",
                      cfg.dotColor
                    )} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm truncate",
                    view === 'unread' ? "font-semibold" : "font-medium text-muted-foreground"
                  )}>
                    {item.title}
                  </p>
                  <p className="text-sm text-muted-foreground line-clamp-2">{item.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

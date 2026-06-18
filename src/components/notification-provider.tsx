"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { LoggedInUser } from '@/lib/types';
import { ShieldAlert, Info, Monitor, MapPin, Clock } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatTimestamp } from '@/lib/data';
import {
  getNotifications,
  markAsRead as markDbAsReadAction,
  markAllAsRead as markAllDbAsReadAction,
} from '@/app/actions/notifications';

export type Notification = {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  createdAt: Date;
  read: boolean;
  type?: 'security' | 'system';
  metadata?: any;
};

export type DbNotification = {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string;
  linkUrl: string | null;
  entityId: string | null;
  entityType: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
};

type ShowNotificationProps = {
    title: string;
    description: string;
};

type NotificationContextType = {
  settings: NotificationSettings;
  setSettings: (settings: Partial<NotificationSettings>) => void;
  showNotification: (props: ShowNotificationProps) => void;
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  initializeNotifications: (user: LoggedInUser) => Promise<void>;
  dbNotifications: DbNotification[];
  dbUnreadCount: number;
  markDbAsRead: (id: string) => void;
  markAllDbAsRead: () => void;
};

type NotificationSettings = {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [securityDetails, setSecurityDetails] = useState<Notification | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [dbNotifications, setDbNotifications] = useState<DbNotification[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  const [settings, setSettingsState] = useState<NotificationSettings>(() => {
    if (typeof window === 'undefined') {
      return { notificationsEnabled: true, soundEnabled: true };
    }
    try {
      const item = window.localStorage.getItem('notification-settings');
      return item ? JSON.parse(item) : { notificationsEnabled: true, soundEnabled: true };
    } catch {
      return { notificationsEnabled: true, soundEnabled: true };
    }
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const audioInstance = new Audio('/ring.mp3');
      audioInstance.load();
      setAudio(audioInstance);
    }
  }, []);

  // SSE connection for real-time DB notifications
  useEffect(() => {
    if (!userId) return;

    let retryTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      const es = new EventSource('/api/notifications/stream');
      sseRef.current = es;

      es.addEventListener('init', (_e: Event) => {
        getNotifications(30).then(rows => {
          setDbNotifications(rows.map(r => ({
            ...r,
            createdAt: new Date(r.createdAt),
            readAt: r.readAt ? new Date(r.readAt) : null,
          })));
        });
      });

      es.addEventListener('notification', (e) => {
        const data = JSON.parse(e.data) as { notifications: DbNotification[]; unreadCount: number };
        const incoming = data.notifications.map(n => ({
          ...n,
          createdAt: new Date(n.createdAt),
          readAt: n.readAt ? new Date(n.readAt) : null,
        }));

        setDbNotifications(prev => {
          const existingIds = new Set(prev.map(n => n.id));
          const fresh = incoming.filter(n => !existingIds.has(n.id));
          if (fresh.length === 0) return prev;

          if (settings.notificationsEnabled) {
            for (const n of fresh) {
              if (n.priority === 'critical' || n.priority === 'high') {
                toast(n.title, { description: n.body, duration: n.priority === 'critical' ? 10000 : 6000 });
                if (settings.soundEnabled && audio) {
                  audio.play().catch(() => {});
                }
              }
            }
          }

          return [...fresh, ...prev];
        });
      });

      es.addEventListener('ping', () => {});

      es.onerror = () => {
        es.close();
        retryTimeout = setTimeout(connect, 15_000);
      };
    };

    connect();

    return () => {
      sseRef.current?.close();
      clearTimeout(retryTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const setSettings = (newSettings: Partial<NotificationSettings>) => {
    setSettingsState(prev => {
      const updated = { ...prev, ...newSettings };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('notification-settings', JSON.stringify(updated));
      }
      if (newSettings.soundEnabled && !prev.soundEnabled && audio) {
        audio.play().catch(() => {});
      }
      return updated;
    });
  };

  const initializeNotifications = useCallback(async (user: LoggedInUser) => {
    setNotifications([]);
    setUserId(user.id);

    if ((user as any).showConcurrentAlert && settings.notificationsEnabled) {
      const details = (user as any).concurrentDetails;
      const logId = `concurrent-alert-${Date.now()}`;
      const newNotif: Notification = {
        id: logId,
        title: 'Security Alert: Concurrent Login',
        description: `A new login session was started while you were already active. Previous sessions have been invalidated for security.`,
        createdAt: new Date(),
        read: false,
        type: 'security',
        metadata: details,
      };

      toast.error(newNotif.title as string, {
        description: newNotif.description as string,
        icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
        duration: 15000,
        action: {
          label: 'View Details',
          onClick: () => {
            setSecurityDetails(newNotif);
            setIsDetailsOpen(true);
          },
        },
      });

      setNotifications(prev => [newNotif, ...prev]);
    }
  }, [settings.notificationsEnabled]);

  const showNotification = useCallback((props: ShowNotificationProps) => {
    if (settings.soundEnabled && audio) {
      audio.play().catch(() => {});
    }
    if (settings.notificationsEnabled) {
      toast(props.title, { description: props.description });
    }
  }, [settings, audio]);

  const markAsRead = useCallback((id: string) => {
    const notif = notifications.find(n => n.id === id);
    if (notif?.type === 'security') {
      setSecurityDetails(notif);
      setIsDetailsOpen(true);
    }
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, [notifications]);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const markDbAsRead = useCallback((id: string) => {
    setDbNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true, readAt: new Date() } : n));
    markDbAsReadAction(id).catch(console.error);
  }, []);

  const markAllDbAsRead = useCallback(() => {
    setDbNotifications(prev => prev.map(n => ({ ...n, read: true, readAt: n.readAt ?? new Date() })));
    markAllDbAsReadAction().catch(console.error);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;
  const dbUnreadCount = dbNotifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{
      settings, setSettings, showNotification,
      notifications, unreadCount, markAsRead, markAllAsRead, initializeNotifications,
      dbNotifications, dbUnreadCount, markDbAsRead, markAllDbAsRead,
    }}>
      {children}

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                    <ShieldAlert className="h-5 w-5" />
                    Security Alert Details
                </DialogTitle>
                <DialogDescription>
                    Information regarding the concurrent login attempt detected on your account.
                </DialogDescription>
            </DialogHeader>

            {securityDetails && (
                <div className="space-y-6 py-4">
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive font-medium">
                        {securityDetails.description}
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-3 items-center gap-4">
                            <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
                                <MapPin className="h-4 w-4" />
                                IP Address
                            </div>
                            <div className="col-span-2 font-mono text-sm bg-muted p-1.5 rounded border">
                                {securityDetails.metadata?.ip || 'Unknown'}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 items-center gap-4">
                            <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
                                <Monitor className="h-4 w-4" />
                                Device/UA
                            </div>
                            <div className="col-span-2 text-xs bg-muted p-2 rounded border break-all leading-relaxed">
                                {securityDetails.metadata?.userAgent || 'Unknown Device'}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 items-center gap-4">
                            <div className="flex items-center gap-2 text-muted-foreground text-sm font-medium">
                                <Clock className="h-4 w-4" />
                                Time
                            </div>
                            <div className="col-span-2 text-sm font-semibold">
                                {securityDetails.metadata?.timestamp ? formatTimestamp(securityDetails.metadata.timestamp) : 'N/A'}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 bg-muted/50 p-4 rounded-lg border border-dashed">
                        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div className="text-xs text-muted-foreground leading-relaxed">
                            If this wasn&apos;t you, your account may be compromised. All previous sessions have been logged out. We recommend changing your password immediately.
                        </div>
                    </div>
                </div>
            )}

            <DialogFooter>
                <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>Dismiss</Button>
                <Button variant="destructive" onClick={() => setIsDetailsOpen(false)}>
                    I Understand
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
}

"use client";

import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import { useNotification } from '@/components/notification-provider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function NotificationSettings() {
  const { settings, setSettings } = useNotification();

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between space-x-2">
        <Label htmlFor="notifications-enabled" className="flex flex-col space-y-1">
          <span>Show Notifications</span>
          <span className="font-normal leading-snug text-muted-foreground">
            Enable or disable all in-app notifications.
          </span>
        </Label>
        <div className="flex items-center gap-2">
          <BellOff className={`h-4 w-4 ${!settings.notificationsEnabled ? 'text-primary' : 'text-muted'}`} />
          <Switch
            id="notifications-enabled"
            checked={settings.notificationsEnabled}
            onCheckedChange={(checked) => setSettings({ notificationsEnabled: checked })}
          />
          <Bell className={`h-4 w-4 ${settings.notificationsEnabled ? 'text-primary' : 'text-muted'}`} />
        </div>
      </div>
      <div className="flex items-center justify-between space-x-2">
        <Label htmlFor="sound-enabled" className="flex flex-col space-y-1">
          <span>Notification Sound</span>
          <span className="font-normal leading-snug text-muted-foreground">
            Play a sound with each new notification.
          </span>
        </Label>
         <div className="flex items-center gap-2">
            <VolumeX className={`h-4 w-4 ${!settings.soundEnabled ? 'text-primary' : 'text-muted'}`} />
            <Switch
                id="sound-enabled"
                checked={settings.soundEnabled}
                onCheckedChange={(checked) => setSettings({ soundEnabled: checked })}
                disabled={!settings.notificationsEnabled}
            />
            <Volume2 className={`h-4 w-4 ${settings.soundEnabled ? 'text-primary' : 'text-muted'}`} />
        </div>
      </div>
    </div>
  );
}

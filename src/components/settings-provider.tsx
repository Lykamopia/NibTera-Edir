
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { saveGeneralSettings } from '@/app/actions/settings';
import type { AcknowledgementType } from '@/lib/types';
import { Skeleton } from './ui/skeleton';

type ReferenceFormatSettings = {
    separator: '-' | '/';
    numberLength: number;
};

type GeneralSettings = {
  acknowledgementType: AcknowledgementType;
  referenceFormat: ReferenceFormatSettings;
  acknowledgementMode: 'auto' | 'manual';
  enableCriticalAlerts: boolean;
};

type SettingsContextType = {
  settings: GeneralSettings;
  loading: boolean;
  updateSettings: (newSettings: Partial<GeneralSettings>) => Promise<void>;
};

type SettingsProviderProps = {
  children: ReactNode;
  initialSettings: GeneralSettings;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children, initialSettings }: SettingsProviderProps) {
  const [settings, setSettings] = useState<GeneralSettings>(initialSettings);
  const [loading, setLoading] = useState(!initialSettings);

  const updateSettings = async (newSettings: Partial<GeneralSettings>) => {
    const oldSettings = settings;
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings); // Optimistic update
    try {
      await saveGeneralSettings(updatedSettings as GeneralSettings);
      window.dispatchEvent(new CustomEvent('settings-updated'));
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSettings(oldSettings); // Revert on failure
    }
  };
  
  useEffect(() => {
    const handleSettingsUpdate = () => {
        window.location.reload(); 
    };
    window.addEventListener('settings-updated', handleSettingsUpdate);
    return () => window.removeEventListener('settings-updated', handleSettingsUpdate);
  }, []);

  const value = { settings, loading, updateSettings };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}

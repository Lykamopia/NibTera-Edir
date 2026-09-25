/**
 * Internal readers for platform-wide settings (Setting table: 'general', 'email').
 *
 * Not a 'use server' module on purpose: these read without an authenticated
 * caller because server internals need them outside any user session (e.g. the
 * security logger during a failed login, outgoing email templating). The
 * user-facing Server Actions in src/app/actions/settings.ts wrap them with
 * authentication.
 */

import 'server-only'; // build fails if a client component ever imports this module

import prisma from '@/lib/prisma';

export type AcknowledgementType = 'BADGE' | 'SIGNATURE';

export type ReferenceFormatSettings = {
  separator: '-' | '/';
  numberLength: number;
};

export type GeneralSettings = {
  acknowledgementType: AcknowledgementType;
  referenceFormat: ReferenceFormatSettings;
  acknowledgementMode: 'auto' | 'manual';
  enableCriticalAlerts: boolean;
};

export type EmailSettings = {
  notificationsEnabled: boolean;
  headerText: string;
  bodyText: string;
  footerText: string;
};

const defaultGeneralSettings: GeneralSettings = {
  acknowledgementType: 'SIGNATURE',
  acknowledgementMode: 'manual',
  referenceFormat: {
    separator: '-',
    numberLength: 4,
  },
  enableCriticalAlerts: true,
};

const defaultEmailSettings: EmailSettings = {
  notificationsEnabled: true,
  headerText: "New Plan Notification",
  bodyText: "Hello,\n\nYou have received a new plan titled '{{subject}}' from {{senderName}}. Please log in to view it.",
  footerText: "This is an automated message. Please do not reply.",
};

export async function readGeneralSettings(): Promise<GeneralSettings> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'general' } });
    if (setting && typeof setting.value === 'object' && setting.value !== null) {
      // Merge defaults with saved settings to ensure all keys are present
      const dbSettings = setting.value as Partial<GeneralSettings>;
      return {
        acknowledgementType: dbSettings.acknowledgementType || defaultGeneralSettings.acknowledgementType,
        acknowledgementMode: dbSettings.acknowledgementMode || defaultGeneralSettings.acknowledgementMode,
        referenceFormat: {
          separator: dbSettings.referenceFormat?.separator || defaultGeneralSettings.referenceFormat.separator,
          numberLength: dbSettings.referenceFormat?.numberLength || defaultGeneralSettings.referenceFormat.numberLength,
        },
        enableCriticalAlerts: dbSettings.enableCriticalAlerts ?? defaultGeneralSettings.enableCriticalAlerts,
      };
    }
  } catch (error) {
    console.error("Failed to fetch general settings, returning defaults:", error);
  }
  return defaultGeneralSettings;
}

export async function readEmailSettings(): Promise<EmailSettings> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'email' } });
    if (setting && typeof setting.value === 'object' && setting.value !== null) {
      return { ...defaultEmailSettings, ...(setting.value as Partial<EmailSettings>) };
    }
  } catch (error) {
    console.error("Failed to fetch email settings, returning defaults:", error);
  }
  return defaultEmailSettings;
}

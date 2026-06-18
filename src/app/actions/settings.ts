'use server'

import prisma from '@/lib/prisma';
import { readdir, stat, mkdir, writeFile, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { getLoggedInUser } from './auth';
import { hasPermission } from './auth';
import { LogSeverity } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { revalidatePath } from 'next/cache';

// Define the types locally as they are simple and specific to settings
type AcknowledgementType = 'BADGE' | 'SIGNATURE';

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

type EmailSettings = {
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
      numberLength: 4
    },
    enableCriticalAlerts: true,
};

const defaultEmailSettings: EmailSettings = {
    notificationsEnabled: true,
    headerText: "New Plan Notification",
    bodyText: "Hello,\n\nYou have received a new plan titled '{{subject}}' from {{senderName}}. Please log in to view it.",
    footerText: "This is an automated message. Please do not reply."
};

export async function getGeneralSettings(): Promise<GeneralSettings> {
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
                    numberLength: dbSettings.referenceFormat?.numberLength || defaultGeneralSettings.referenceFormat.numberLength
                },
                enableCriticalAlerts: dbSettings.enableCriticalAlerts ?? defaultGeneralSettings.enableCriticalAlerts,
            };
        }
    } catch (error) {
        console.error("Failed to fetch general settings, returning defaults:", error);
    }
    return defaultGeneralSettings;
}

export async function getEmailSettings(): Promise<EmailSettings> {
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

export async function deleteBackgroundImage(imagePath: string): Promise<{ success: boolean; error?: string }> {
    const user = await getLoggedInUser();
    if (!user || !user.role?.permissions?.includes('manage_general_settings')) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        const fileName = imagePath.split('/').pop();
        if (!fileName) throw new Error("Invalid file name");

        const absolutePath = join(process.cwd(), 'uploads', 'bg', fileName);
        
        // Security check
        const bgDir = join(process.cwd(), 'uploads', 'bg');
        if (!absolutePath.startsWith(bgDir)) {
            throw new Error("Invalid path");
        }

        await unlink(absolutePath);
        return { success: true };
    } catch (error) {
        console.error("Failed to delete background image:", error);
        return { success: false, error: 'Failed to delete image' };
    }
}

export async function uploadBackgroundImage(formData: FormData): Promise<{ success: boolean; error?: string; url?: string }> {
    const user = await getLoggedInUser();
    if (!user || !user.role?.permissions?.includes('manage_general_settings')) {
        return { success: false, error: 'Unauthorized' };
    }

    const file = formData.get('file') as File;
    if (!file) {
        return { success: false, error: 'No file provided' };
    }

    // --- Validation & Sanitization ---
    // 1. Size check (e.g., 5MB)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        return { success: false, error: 'File size exceeds 5MB limit' };
    }

    // 2. Type check
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
    const fileExtension = extname(file.name).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
        return { success: false, error: 'Invalid file type. Only PNG, JPG, JPEG, and WEBP are allowed.' };
    }

    // 3. Filename sanitization
    const sanitizedName = `ad_${Date.now()}_${file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase()}`;
    
    try {
        const bgDir = join(process.cwd(), 'uploads', 'bg');
        
        // Ensure directory exists
        try {
            await stat(bgDir);
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                await mkdir(bgDir, { recursive: true });
            }
        }

        const absolutePath = join(bgDir, sanitizedName);
        const buffer = Buffer.from(await file.arrayBuffer());
        
        await writeFile(absolutePath, buffer);
        
        return { 
            success: true, 
            url: `/uploads/bg/${sanitizedName}` 
        };
    } catch (error) {
        console.error("Failed to upload background image:", error);
        return { success: false, error: 'Failed to save image' };
    }
}

export async function getBackgroundImages(): Promise<string[]> {
    try {
        const bgDir = join(process.cwd(), 'uploads', 'bg');
        const files = await readdir(bgDir);
        // Filter for common image extensions
        const images = files.filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file));
        return images.map(file => `/uploads/bg/${file}`);
    } catch (error) {
        console.error("Failed to list background images:", error);
        return [];
    }
}

export async function saveGeneralSettings(settings: { 
    acknowledgementType: AcknowledgementType; 
    referenceFormat: ReferenceFormatSettings; 
    acknowledgementMode: 'auto' | 'manual'; 
    enableCriticalAlerts: boolean; 
    showOnboardingTour: boolean 
}) {
    const user = await hasPermission('manage_general_settings');
    await prisma.setting.upsert({
        where: { key: 'general' },
        update: { value: settings },
        create: { key: 'general', value: settings }
    });
    await logSecurityEvent({ 
        event: SecurityEvent.SETTINGS_UPDATED, 
        severity: LogSeverity.WARN, 
        actor: user, 
        details: 'General settings were updated.' 
    });
    revalidatePath('/dashboard/admin/general');
    return { success: true };
}

// ── Working Days / Weekend Settings ─────────────────────────────────────────

import type { WorkingDaysSettings } from '@/lib/working-days';

const defaultWorkingDaysSettings: WorkingDaysSettings = {
  saturdayWeekend: true,
  sundayWeekend: true,
};

export async function getWorkingDaysSettings(): Promise<WorkingDaysSettings> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'working_days' } });
    if (setting?.value && typeof setting.value === 'object') {
      const val = setting.value as Partial<WorkingDaysSettings>;
      return {
        saturdayWeekend: val.saturdayWeekend ?? true,
        sundayWeekend:   val.sundayWeekend   ?? true,
      };
    }
  } catch {}
  return defaultWorkingDaysSettings;
}

export async function saveWorkingDaysSettings(settings: WorkingDaysSettings) {
  await hasPermission('manage_public_holidays');
  await prisma.setting.upsert({
    where:  { key: 'working_days' },
    update: { value: settings as any },
    create: { key: 'working_days', value: settings as any },
  });
  revalidatePath('/dashboard/admin/public-holidays');
  return { success: true };
}

export async function saveEmailSettings(settings: {
    notificationsEnabled: boolean; 
    headerText: string; 
    bodyText: string; 
    footerText: string 
}) {
    const user = await hasPermission('manage_email_settings');
    await prisma.setting.upsert({
        where: { key: 'email' },
        update: { value: settings },
        create: { key: 'email', value: settings }
    });
    await logSecurityEvent({ 
        event: SecurityEvent.SETTINGS_UPDATED, 
        severity: LogSeverity.WARN, 
        actor: user, 
        details: 'Email settings were updated.' 
    });
    revalidatePath('/dashboard/admin/email');
    return { success: true };
}

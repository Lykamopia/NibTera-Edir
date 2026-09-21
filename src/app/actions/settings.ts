'use server'

import prisma from '@/lib/prisma';
import { readdir, stat, mkdir, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { UPLOAD_POLICIES, buildStoredFilename, validateUpload } from '@/lib/file-validation';
import { getLoggedInUser } from './auth';
import { hasPermission } from './auth';
import { LogSeverity } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { revalidatePath } from 'next/cache';
import { getActor, assertPermission } from '@/lib/tenant-scope';
import {
  MEMBERSHIP_SETTING_KEY,
  getMembershipPolicy,
  type MembershipPolicy,
} from '@/lib/membership-policy';
import { writeAudit } from '@/lib/audit';

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
    // Reject on the declared size before buffering the file into memory.
    if (file.size > UPLOAD_POLICIES.bg.maxBytes) {
        return { success: false, error: 'File size exceeds 5MB limit' };
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Strict allow list checked against the real magic bytes — an extension or
    // a client-declared Content-Type alone proves nothing.
    const validation = validateUpload('bg', { filename: file.name, declaredMime: file.type, buffer });
    if (!validation.ok) {
        await logSecurityEvent({
            event: SecurityEvent.FILE_UPLOAD_REJECTED,
            severity: LogSeverity.WARN,
            actor: user,
            details: `Rejected background-image upload '${file.name}' (declared=${file.type || 'none'}, ${file.size} bytes): ${validation.reason}.`,
        });
        return { success: false, error: validation.error };
    }

    // Filename sanitization — the extension comes from the verified content.
    const sanitizedName = buildStoredFilename(`ad_${randomUUID()}`, file.name, validation.type);

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

        // Write the exact bytes that were validated above — never re-read the
        // stream, so what is inspected is what lands on disk.
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

// ─── Platform membership policy (Super-Admin) ────────────────────────────────
// Whether one person may hold memberships in more than one Edir. Cross-tenant by
// nature, so it is a single platform-wide switch rather than a per-Edir setting.
// See lib/membership-policy.ts for how it is enforced.

/** Read the platform membership policy (Platform Settings → Membership). */
export async function getMembershipSettings(): Promise<MembershipPolicy> {
  const actor = await getActor();
  await assertPermission(actor, ['manage_platform_settings', 'super_admin']);
  return getMembershipPolicy();
}

/**
 * Save the platform membership policy.
 *
 * Turning it OFF is non-destructive: memberships created while it was ON are
 * kept, and only NEW cross-Edir memberships are refused from that point on. The
 * response reports how many people currently hold more than one membership so
 * the admin can see what they are leaving in place.
 */
export async function saveMembershipSettings(settings: MembershipPolicy) {
  try {
    const actor = await getActor();
    await assertPermission(actor, ['manage_platform_settings', 'super_admin']);

    const allowMultiEdir = !!settings?.allowMultiEdir;
    const previous = await getMembershipPolicy();

    await prisma.setting.upsert({
      where: { key: MEMBERSHIP_SETTING_KEY },
      update: { value: { allowMultiEdir } },
      create: { key: MEMBERSHIP_SETTING_KEY, value: { allowMultiEdir } },
    });

    if (previous.allowMultiEdir !== allowMultiEdir) {
      await logSecurityEvent({
        event: SecurityEvent.SETTINGS_UPDATED,
        severity: LogSeverity.WARN,
        actor: { id: actor.id, name: actor.name, email: actor.email } as any,
        details: `Multi-Edir membership ${allowMultiEdir ? 'ENABLED' : 'DISABLED'} platform-wide.`,
      });
      await writeAudit({
        edirId: null,
        userId: actor.id,
        action: 'PLATFORM_MEMBERSHIP_POLICY_CHANGED',
        targetType: 'Setting',
        targetId: MEMBERSHIP_SETTING_KEY,
        details: `Multi-Edir membership ${allowMultiEdir ? 'enabled' : 'disabled'}.`,
      });
    }

    revalidatePath('/dashboard/system/settings');
    return { success: true as const, policy: { allowMultiEdir } };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : 'Could not save membership settings.' };
  }
}

/** Count the people who currently hold memberships in more than one Edir. */
export async function getMultiEdirMemberStats() {
  const actor = await getActor();
  await assertPermission(actor, ['manage_platform_settings', 'super_admin']);

  // Group linked memberships by login account; anything with >1 row spans Edirs
  // (a second membership in the SAME Edir is blocked by a unique constraint).
  const grouped = await prisma.member.groupBy({
    by: ['userId'],
    where: { userId: { not: null } },
    _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
  });

  return {
    peopleWithMultipleEdirs: grouped.length,
    membershipsInvolved: grouped.reduce((sum, g) => sum + g._count._all, 0),
  };
}

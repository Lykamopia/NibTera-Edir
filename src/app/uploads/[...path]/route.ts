
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import mime from 'mime-types';
import { getLoggedInUser } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import type { LoggedInUser } from '@/lib/types';
import { LogSeverity } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { decryptBuffer } from '@/lib/encryption';

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
    const filePathParts = params.path;
    if (!filePathParts || filePathParts.length === 0) {
        return new NextResponse('File not found', { status: 404 });
    }

    const [fileType, ...fileNameParts] = filePathParts;

    // Allow public access to background images for the login page
    if (fileType === 'bg') {
        const uploadsDir = join(process.cwd(), 'uploads');
        const absolutePath = join(uploadsDir, ...filePathParts);
        
        if (!absolutePath.startsWith(uploadsDir)) {
            return new NextResponse('Invalid file path', { status: 403 });
        }

        try {
            const fileBuffer = await readFile(absolutePath);
            const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
            return new NextResponse(fileBuffer, {
                status: 200,
                headers: { 'Content-Type': contentType },
            });
        } catch (error: any) {
            if (error.code === 'ENOENT') return new NextResponse('File not found', { status: 404 });
            return new NextResponse('Internal server error', { status: 500 });
        }
    }

    const user = await getLoggedInUser();
    if (!user) {
        return new NextResponse('Authentication required', { status: 401 });
    }
    // Construct DB path with forward slashes for universal matching
    const dbPath = `/uploads/${filePathParts.join('/')}`;
    let isAuthorized = false;
    let eventTarget: { id: string, type: string } | null = null;

    const requestHeaders = req.headers;
    const fetchDest = requestHeaders.get('sec-fetch-dest');

    // --- Authorization Check ---
    if (fileType === 'profile' || fileType === 'signatures') {
        // Profile pictures and signatures are viewable by any authenticated user for UI purposes...
        // BUT direct access (entering the URL in address bar) is restricted for other users' signatures.
        
        const type = fileType === 'profile' ? 'Profile' : 'Signature';
        eventTarget = { id: dbPath, type };

        if (fileType === 'signatures') {
            const signatureOwner = await prisma.user.findFirst({
                where: { signature: dbPath },
                select: { id: true }
            });

            const isOwnSignature = signatureOwner?.id === user.id;
            
            // sec-fetch-dest: document means the user typed the URL or clicked a direct link (not an <img> tag)
            const isDirectAccessAttempt = fetchDest === 'document';

            if (isDirectAccessAttempt && !isOwnSignature) {
                await logSecurityEvent({
                    event: SecurityEvent.PERMISSION_DENIED,
                    severity: LogSeverity.WARN,
                    actor: user.actingUser || user,
                    details: `Unauthorized direct access attempt to signature: ${dbPath}. Destination: ${fetchDest}`,
                    targetId: dbPath,
                    targetType: 'Signature',
                });
                return new NextResponse('Forbidden: Direct access to other users signatures is prohibited.', { status: 403 });
            }
        }

        isAuthorized = true;
    }
    // Member relative documents: viewable by same-tenant users who manage or review members.
    else if (fileType === 'documents') {
        eventTarget = { id: dbPath, type: 'Document' };
        const [relDoc, memberDoc, reqDoc] = await Promise.all([
            prisma.relativeDocument.findFirst({ where: { fileUrl: dbPath }, include: { relative: { include: { member: { select: { edirId: true } } } } } }),
            prisma.memberDocument.findFirst({ where: { fileUrl: dbPath }, include: { member: { select: { edirId: true } } } }),
            prisma.memberRequest.findFirst({ where: { attachments: { array_contains: dbPath } }, include: { member: { select: { edirId: true, userId: true } } } }),
        ]);
        const perms = (user.role?.permissions?.split(',') ?? []).map(p => p.trim());
        const isSuper = user.role?.scope === 'SUPER_ADMIN' || perms.includes('super_admin');
        const canView = perms.includes('view_members') || perms.includes('manage_members') || perms.includes('review_member_documents') || perms.includes('handle_member_requests');
        const docEdirId = relDoc?.relative.member?.edirId ?? memberDoc?.member?.edirId ?? reqDoc?.member?.edirId ?? null;
        const sameTenant = !!docEdirId && docEdirId === (user as any).edirId;
        const isOwnRequestDoc = !!reqDoc && reqDoc.member?.userId === user.id; // member viewing their own attachment
        if (isSuper || isOwnRequestDoc || (canView && sameTenant)) isAuthorized = true;
    }
    // Rules & bylaws attachments: viewable by same-tenant users who can read rules.
    else if (fileType === 'rules') {
        eventTarget = { id: dbPath, type: 'RulesAttachment' };
        const att = await prisma.rulesAttachment.findFirst({ where: { url: dbPath }, include: { version: { select: { edirId: true } } } });
        const perms = (user.role?.permissions?.split(',') ?? []).map(p => p.trim());
        const isSuper = user.role?.scope === 'SUPER_ADMIN' || perms.includes('super_admin');
        const canView = perms.includes('view_rules') || perms.includes('manage_rules');
        const sameTenant = !!att?.version.edirId && att.version.edirId === (user as any).edirId;
        if (isSuper || (canView && sameTenant)) isAuthorized = true;
    }
    // --- End Authorization Check ---

    if (!isAuthorized) {
        await logSecurityEvent({
            event: SecurityEvent.PERMISSION_DENIED,
            severity: LogSeverity.WARN,
            actor: user.actingUser || user,
            details: `User attempted to access unauthorized file: ${dbPath}`,
            targetId: eventTarget?.id || dbPath,
            targetType: eventTarget?.type || fileType,
        });
        return new NextResponse('Forbidden: You do not have permission to access this file.', { status: 403 });
    }

    const uploadsDir = join(process.cwd(), 'uploads');
    const absolutePath = join(uploadsDir, ...filePathParts);

    if (!absolutePath.startsWith(uploadsDir)) {
        return new NextResponse('Invalid file path', { status: 403 });
    }

    try {
        let fileBuffer = await readFile(absolutePath);
        
        // Decrypt signatures if they were encrypted during upload
        if (fileType === 'signatures') {
            try {
                fileBuffer = decryptBuffer(fileBuffer);
            } catch (decryptError) {
                // If decryption fails, it might be an old unencrypted file.
                // We serve it as is for backward compatibility.
                console.warn(`[Encryption] Decryption failed for ${dbPath}. Serving as-is. Error:`, decryptError instanceof Error ? decryptError.message : decryptError);
            }
        }

        const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
        
        const isSignaturePreview = fileType === 'signatures';
        const isProfilePreview = fileType === 'profile';

        if (!isSignaturePreview && !isProfilePreview) {
            await logSecurityEvent({
                event: SecurityEvent.FILE_PREVIEW_SUCCESS,
                severity: LogSeverity.INFO,
                actor: user.actingUser || user,
                details: `User successfully previewed file: ${dbPath}`,
                targetId: eventTarget?.id || dbPath,
                targetType: eventTarget?.type || fileType,
            });
        }

        const headers = new Headers();
        headers.set('Content-Type', contentType);
        
        const disposition = 'inline';
        headers.set('Content-Disposition', `${disposition}; filename="${fileNameParts.join('')}"`);
        
        if (fileType === 'signatures') {
            headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            headers.set('Pragma', 'no-cache');
            headers.set('Expires', '0');
            headers.set('X-Content-Type-Options', 'nosniff');
        }

        return new NextResponse(fileBuffer, {
            status: 200,
            headers: headers,
        });
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return new NextResponse('File not found', { status: 404 });
        }
        console.error('Error reading file:', error);
        return new NextResponse('Internal server error', { status: 500 });
    }
}

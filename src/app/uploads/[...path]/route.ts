
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, sep } from 'path';
import mime from 'mime-types';
import { getLoggedInUser } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import type { LoggedInUser } from '@/lib/types';
import { LogSeverity } from '@/lib/types';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { decryptBuffer, decryptFile, isAuthenticatedFormat, isEncryptedFile, legacyCbcAllowed } from '@/lib/encryption';
import { detectFileType } from '@/lib/file-validation';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    const { path: filePathParts } = await params;
    if (!filePathParts || filePathParts.length === 0) {
        return new NextResponse('File not found', { status: 404 });
    }

    const [fileType, ...fileNameParts] = filePathParts;

    const uploadsRoot = join(process.cwd(), 'uploads');
    // Resolve a request path strictly inside the uploads directory. Rejects any
    // path-traversal attempt (`..`, absolute segments, encoded separators) by
    // requiring the normalized result to sit under uploadsRoot + separator.
    const safeResolve = (parts: string[]): string | null => {
        const abs = join(uploadsRoot, ...parts);
        if (abs !== uploadsRoot && !abs.startsWith(uploadsRoot + sep)) return null;
        return abs;
    };

    // Allow public access to background images and Edir logos (non-sensitive
    // branding shown on public pages such as the payment mini-app).
    if (fileType === 'bg' || fileType === 'logos') {
        const absolutePath = safeResolve(filePathParts);
        if (!absolutePath) {
            return new NextResponse('Invalid file path', { status: 403 });
        }

        try {
            const fileBuffer = await readFile(absolutePath);
            // Safe because uploads are stored under a content-derived extension
            // (see src/lib/file-validation.ts), so the extension cannot lie.
            const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
            return new NextResponse(fileBuffer, {
                status: 200,
                // nosniff: pin the browser to the declared type so a file whose
                // trailing bytes look like markup can never be treated as HTML.
                headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' },
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
    // Member relative documents AND enterprise (DMS) documents: viewable only by
    // same-tenant users holding a document/member permission, or the uploader/owner.
    else if (fileType === 'documents') {
        eventTarget = { id: dbPath, type: 'Document' };
        const [relDoc, memberDoc, reqDoc, dmsDoc] = await Promise.all([
            prisma.relativeDocument.findFirst({ where: { fileUrl: dbPath }, include: { relative: { include: { member: { select: { edirId: true } } } } } }),
            prisma.memberDocument.findFirst({ where: { fileUrl: dbPath }, include: { member: { select: { edirId: true } } } }),
            prisma.memberRequest.findFirst({ where: { attachments: { array_contains: dbPath } }, include: { member: { select: { edirId: true, userId: true } } } }),
            prisma.dmsDocument.findFirst({ where: { fileUrl: dbPath }, select: { edirId: true, uploadedById: true, visibility: true } }),
        ]);
        const perms = (user.role?.permissions?.split(',') ?? []).map(p => p.trim());
        const isSuper = user.role?.scope === 'SUPER_ADMIN' || perms.includes('super_admin');
        const userEdirId = (user as any).edirId;

        // Member / relative / request attachments (existing behaviour).
        const canViewMember = perms.includes('view_members') || perms.includes('manage_members') || perms.includes('review_member_documents') || perms.includes('handle_member_requests') || perms.includes('view_documents');
        const memberEdirId = relDoc?.relative.member?.edirId ?? memberDoc?.member?.edirId ?? reqDoc?.member?.edirId ?? null;
        const memberSameTenant = !!memberEdirId && memberEdirId === userEdirId;
        const isOwnRequestDoc = !!reqDoc && reqDoc.member?.userId === user.id; // member viewing their own attachment

        // Enterprise DMS document: must belong to the viewer's Edir AND the viewer
        // must hold a document permission — OR the viewer is the original uploader
        // (so they can see their own document on the My Account page). Committee-only
        // documents additionally require committee visibility.
        const isOwnDms = !!dmsDoc && !!dmsDoc.uploadedById && dmsDoc.uploadedById === user.id;
        const dmsSameTenant = !!dmsDoc?.edirId && dmsDoc.edirId === userEdirId;
        const canViewDms = perms.includes('view_documents') || perms.includes('review_document') || perms.includes('approve_document');
        const dmsVisibilityOk = dmsDoc?.visibility !== 'committee' || perms.includes('view_committee_oversight') || perms.includes('view_documents');

        // Oversight roles (platform / district / branch) may view documents for Edirs
        // within their scope — this powers the Edir Details page document previews for
        // non-Edir-scoped admins. Scope is checked against the document's Edir.
        let dmsOversight = false;
        if (dmsDoc?.edirId && !dmsSameTenant && !isSuper) {
            const uBranch = (user as any).branchId as string | null;
            const uDistrict = (user as any).districtId as string | null;
            if (perms.includes('manage_edirs') || perms.includes('view_edir_reports')) {
                dmsOversight = true; // platform-level oversight spans all Edirs
            } else if ((uBranch || uDistrict) && (canViewDms || perms.includes('view_branches') || perms.includes('view_districts') || perms.includes('manage_branches') || perms.includes('manage_districts'))) {
                const de = await prisma.edir.findUnique({ where: { id: dmsDoc.edirId }, select: { branchId: true, branch: { select: { districtId: true } } } });
                if (uBranch && de?.branchId === uBranch) dmsOversight = true;
                else if (uDistrict && de?.branch?.districtId === uDistrict) dmsOversight = true;
            }
        }
        const dmsAllowed = (isOwnDms || (canViewDms && dmsSameTenant) || dmsOversight) && (isOwnDms || dmsVisibilityOk);

        if (isSuper || isOwnRequestDoc || (canViewMember && memberSameTenant) || dmsAllowed) isAuthorized = true;
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
    // The uploader may always preview their own document/rules file — e.g. right
    // after uploading, before it is attached to any record.
    if (!isAuthorized && (fileType === 'documents' || fileType === 'rules')) {
        const own = await prisma.upload.findUnique({ where: { path: dbPath }, select: { ownerId: true } });
        if (own?.ownerId && own.ownerId === user.id) isAuthorized = true;
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

    const absolutePath = safeResolve(filePathParts);
    if (!absolutePath) {
        return new NextResponse('Invalid file path', { status: 403 });
    }

    try {
        let fileBuffer = await readFile(absolutePath);
        
        // Decrypt signatures if they were encrypted during upload
        if (fileType === 'signatures') {
            try {
                // Authenticated decryption: the GCM tag is verified before any
                // bytes are returned (see src/lib/encryption.ts).
                fileBuffer = decryptBuffer(fileBuffer);
            } catch (decryptError) {
                // Never fall back to serving bytes that failed authentication. The
                // one exception, while legacy reads are still enabled, is a
                // signature stored as a plain image before encryption existed —
                // recognised by its real image magic bytes, not by the failure.
                const legacyPlainImage = legacyCbcAllowed() && !isAuthenticatedFormat(fileBuffer) && detectFileType(fileBuffer)?.mime.startsWith('image/');
                if (!legacyPlainImage) {
                    await logSecurityEvent({
                        event: SecurityEvent.FILE_INTEGRITY_FAILURE,
                        severity: LogSeverity.CRITICAL,
                        actor: user,
                        details: `Encrypted file '${dbPath}' failed authentication and was not served: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`,
                    });
                    return new NextResponse('This file could not be verified and was not served.', { status: 422 });
                }
                console.warn(`[Encryption] Serving legacy unencrypted signature ${dbPath}; run scripts/migrate-signature-encryption.ts to encrypt it.`);
            }
        }

        // Documents / rules attachments are encrypted with DATA_ENCRYPTION_KEY
        // (v2 format). A file without that header is one stored before at-rest
        // encryption existed: serve it only if its bytes really are the type its
        // (content-derived) extension says — never raw ciphertext or junk.
        if (fileType === 'documents' || fileType === 'rules') {
            if (isEncryptedFile(fileBuffer)) {
                try {
                    fileBuffer = decryptFile(fileBuffer);
                } catch (decryptError) {
                    await logSecurityEvent({
                        event: SecurityEvent.FILE_INTEGRITY_FAILURE,
                        severity: LogSeverity.CRITICAL,
                        actor: user,
                        details: `Encrypted file '${dbPath}' failed authentication and was not served: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`,
                    });
                    return new NextResponse('This file could not be verified and was not served.', { status: 422 });
                }
            } else if (detectFileType(fileBuffer)?.mime !== mime.lookup(absolutePath)) {
                return new NextResponse('This file could not be verified and was not served.', { status: 422 });
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
        // Uploads are stored under a content-derived extension, so `contentType`
        // reflects the verified bytes — nosniff holds the browser to it, which
        // is what stops a permitted image with a markup-looking tail from ever
        // being rendered as HTML on this origin.
        headers.set('X-Content-Type-Options', 'nosniff');

        const disposition = 'inline';
        headers.set('Content-Disposition', `${disposition}; filename="${fileNameParts.join('')}"`);

        if (fileType === 'documents' || fileType === 'rules') {
            // Decrypted personal documents must not linger in shared/browser caches.
            headers.set('Cache-Control', 'private, no-store');
        }
        if (fileType === 'signatures') {
            headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            headers.set('Pragma', 'no-cache');
            headers.set('Expires', '0');
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

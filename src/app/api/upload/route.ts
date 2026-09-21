
import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join, sep } from 'path';
import { stat, mkdir, rm } from 'fs/promises';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { LogSeverity } from '@/lib/types';
import { encryptBuffer } from '@/lib/encryption';
import { randomUUID } from 'crypto';
import {
  API_UPLOAD_KINDS,
  UPLOAD_POLICIES,
  buildStoredFilename,
  isApiUploadKind,
  validateUpload,
} from '@/lib/file-validation';

// Set a body size limit for file uploads to 10MB
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

/** Largest cap across every API-reachable category — the pre-buffering guard. */
const MAX_FILE_SIZE = Math.max(...API_UPLOAD_KINDS.map((k) => UPLOAD_POLICIES[k].maxBytes));

// Main POST handler for file uploads
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const sessionUser = session.user as { id: string; name?: string | null };

  // CSRF defence-in-depth: the session cookie is already SameSite=strict, but
  // additionally verify a browser-supplied Origin matches the request Host so a
  // cross-site page cannot drive an authenticated upload.
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      // Behind a reverse proxy the internal Host header differs from the public
      // host, so accept a match against the proxy-forwarded host too.
      const forwardedHost = (req.headers.get('x-forwarded-host') || '').split(',')[0].trim();
      const allowedHosts = [req.headers.get('host'), forwardedHost].filter(Boolean);
      if (!allowedHosts.includes(originHost)) {
        return NextResponse.json({ success: false, error: 'Cross-origin request blocked.' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid origin.' }, { status: 400 });
    }
  }

  // Reject oversized payloads up-front (before buffering into memory) to mitigate
  // memory-exhaustion DoS. Allow ~1MB of multipart overhead above the file cap.
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_SIZE + 1024 * 1024) {
    return NextResponse.json({ success: false, error: 'Payload too large.' }, { status: 413 });
  }

  const data = await req.formData();
  const file: File | null = data.get('file') as unknown as File;
  const rawType = data.get('type');

  // Only allow profile, signature, member-document, rules-attachment, and logo uploads
  if (!isApiUploadKind(rawType)) {
    return NextResponse.json({ success: false, error: 'Invalid upload category' }, { status: 400 });
  }
  const type = rawType;

  // RBAC: branding (logos) is a staff-only operation. profile/signatures are
  // self-service (own account) and `documents` may be uploaded by members for
  // their own request attachments — for those, authentication is sufficient and
  // the download route enforces who may later VIEW the file.
  if (type === 'logos') {
    const u = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { role: { select: { permissions: true } } } });
    const perms = (u?.role?.permissions ?? '').split(',').map((p) => p.trim());
    if (!perms.includes('super_admin') && !perms.includes('manage_edir_settings')) {
      await logSecurityEvent({
        event: SecurityEvent.PERMISSION_DENIED,
        severity: LogSeverity.WARN,
        actor: { id: sessionUser.id, name: sessionUser.name ?? null },
        details: `Unauthorized branding (logo) upload attempt.`,
      });
      return NextResponse.json({ success: false, error: 'You do not have permission to upload branding.' }, { status: 403 });
    }
  }

  if (!file) {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
  }

  // --- File Validation ---
  // Reject on the declared size before buffering, so an oversized file is not
  // read into memory just to be thrown away.
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ success: false, error: 'File size exceeds the 10MB limit.' }, { status: 413 });
  }

  const bytes = await file.arrayBuffer();
  let buffer = Buffer.from(bytes);

  // Strict per-category allow list, decided on the file's actual magic bytes —
  // the extension and the client-sent Content-Type only narrow what is accepted.
  // See src/lib/file-validation.ts for the full rule set.
  const validation = validateUpload(type, {
    filename: file.name,
    declaredMime: file.type,
    buffer,
  });
  if (!validation.ok) {
    await logSecurityEvent({
      event: SecurityEvent.FILE_UPLOAD_REJECTED,
      severity: LogSeverity.WARN,
      actor: { id: sessionUser.id, name: sessionUser.name ?? null },
      details: `Rejected upload '${file.name}' (category=${type}, declared=${file.type || 'none'}, ${file.size} bytes): ${validation.reason}.`,
    });
    return NextResponse.json({ success: false, error: validation.error }, { status: validation.status });
  }
  // --- End File Validation ---

  // Advanced encryption for signatures to protect from direct file access
  if (type === 'signatures') {
    buffer = encryptBuffer(buffer);
  }

  // Define the upload directory path at the root level
  const uploadDir = join(process.cwd(), 'uploads', type);

  // Ensure the upload directory exists
  try {
    await stat(uploadDir);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      await mkdir(uploadDir, { recursive: true });
    } else {
      console.error('Error creating upload directory:', e);
      return NextResponse.json({ success: false, error: 'Could not create upload directory' }, { status: 500 });
    }
  }

  // Sanitize the filename and prefix it with a cryptographically-random token
  // (not Date.now()) so names are collision-free and do not leak upload timing.
  // The stored extension comes from the DETECTED content type, never from the
  // client, so the file is always served under a Content-Type its bytes match.
  const uniqueFilename = buildStoredFilename(randomUUID(), file.name, validation.type);
  const path = join(uploadDir, uniqueFilename);
  
  // Write the file to the server
  try {
    await writeFile(path, buffer);
  } catch (error) {
    console.error('Error writing file:', error);
    return NextResponse.json({ success: false, error: 'Failed to save file' }, { status: 500 });
  }
  
  // Return the public path relative to the root
  const publicPath = `/uploads/${type}/${uniqueFilename}`;
  
  await logSecurityEvent({
    event: SecurityEvent.FILE_UPLOAD_SUCCESS,
    severity: LogSeverity.INFO,
    actor: { id: sessionUser.id, name: sessionUser.name ?? null },
    details: `User uploaded file '${file.name}' (${file.size} bytes, verified ${validation.type.id}) of type '${type}'.`,
    targetId: publicPath
  });

  return NextResponse.json({
    success: true,
    path: publicPath,
    name: file.name,
    size: file.size,
    // Report the VERIFIED type, not the client's claim.
    type: validation.type.mime
  });
}


// DELETE handler for removing uploaded files
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  
  const data = await req.json();
  const relativePath = data.path as string;

  if (!relativePath) {
    return NextResponse.json({ success: false, error: 'No file path provided' }, { status: 400 });
  }

  // --- Ownership Check ---
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  // A user can only delete a file if it's their current avatar or signature.
  // This prevents deleting arbitrary files.
  if (relativePath !== user?.avatar && relativePath !== user?.signature) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  // --- End Ownership Check ---

  // Path received will be like "/uploads/profile/some-file.png"
  // We need to map it to the root "uploads" folder
  const basePath = process.cwd();
  const absolutePath = join(basePath, relativePath);

  // Security check: ensure the resolved path is strictly within the 'uploads'
  // directory (sep boundary defeats prefix tricks like `uploads-evil/…`).
  const uploadsDir = join(process.cwd(), 'uploads');
  if (absolutePath !== uploadsDir && !absolutePath.startsWith(uploadsDir + sep)) {
    return NextResponse.json({ success: false, error: 'Invalid file path' }, { status: 403 });
  }
  
  try {
    await rm(absolutePath);
    return NextResponse.json({ success: true, message: 'File deleted successfully.' });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File not found is not an error in this context.
      return NextResponse.json({ success: true, message: 'File not found, but operation is successful.' });
    }
    console.error('Error deleting file:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete file' }, { status: 500 });
  }
}

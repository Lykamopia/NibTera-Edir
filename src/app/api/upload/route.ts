
import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join, sep } from 'path';
import { stat, mkdir, rm } from 'fs/promises';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { LogSeverity } from '@/lib/types';
import mime from 'mime-types';
import { encryptBuffer } from '@/lib/encryption';
import { randomUUID } from 'crypto';

// Set a body size limit for file uploads to 10MB
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.sh', '.js', '.jsx', '.ts', '.tsx',
  '.vbs', '.ps1', '.jar', '.py', '.php', '.pl', '.rb', '.swf', '.html', '.htm'
];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB, matching config

/**
 * Server-side content inspection: confirm the raw bytes actually carry an allowed
 * image signature (magic number). Defeats a renamed executable/script that merely
 * spoofs its extension and Content-Type.
 */
function hasAllowedImageMagic(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const [b0, b1, b2, b3] = [buf[0], buf[1], buf[2], buf[3]];
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return true;                          // JPEG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return true;            // PNG
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return true;            // GIF8
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46                          // RIFF…
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true; // …WEBP
  return false;
}

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
      if (new URL(origin).host !== req.headers.get('host')) {
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
  const type = data.get('type') as string;

  // Only allow profile, signature, member-document, rules-attachment, and logo uploads
  if (type !== 'profile' && type !== 'signatures' && type !== 'documents' && type !== 'rules' && type !== 'logos') {
    return NextResponse.json({ success: false, error: 'Invalid file type' }, { status: 400 });
  }

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
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ success: false, error: 'File size exceeds the 10MB limit.' }, { status: 413 });
  }

  const filename = file.name.toLowerCase();
  const fileExtension = `.${filename.split('.').pop()}`;

  if (BLOCKED_EXTENSIONS.includes(fileExtension)) {
    return NextResponse.json({ success: false, error: `File type (${fileExtension}) is not allowed.` }, { status: 400 });
  }
  
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, error: 'Only image files (JPEG, PNG, GIF, WEBP) are allowed.' }, { status: 400 });
  }
  
  // Verify MIME type server-side, as client-sent type can be spoofed.
  const serverMimeType = mime.lookup(filename);
  if (serverMimeType && serverMimeType !== file.type) {
      if (!ALLOWED_IMAGE_TYPES.includes(serverMimeType)) {
          return NextResponse.json({ success: false, error: `Invalid image file type. Server detected: ${serverMimeType}.` }, { status: 400 });
      }
      if (BLOCKED_EXTENSIONS.includes(`.${mime.extension(serverMimeType) || ''}`)) {
          return NextResponse.json({ success: false, error: 'Disallowed file type detected on server.' }, { status: 400 });
      }
  }
  // --- End File Validation ---

  const bytes = await file.arrayBuffer();
  let buffer = Buffer.from(bytes);

  // Server-side content inspection: the declared MIME/extension can be spoofed,
  // so verify the actual bytes are a permitted image before persisting.
  if (!hasAllowedImageMagic(buffer)) {
    await logSecurityEvent({
      event: SecurityEvent.PERMISSION_DENIED,
      severity: LogSeverity.WARN,
      actor: { id: sessionUser.id, name: sessionUser.name ?? null },
      details: `Rejected upload '${file.name}' (type=${type}): byte signature is not an allowed image format.`,
    });
    return NextResponse.json({ success: false, error: 'File content does not match an allowed image format.' }, { status: 400 });
  }

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
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9-._]/g, '_');
  const uniqueFilename = `${randomUUID()}-${sanitizedFilename}`;
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
    details: `User uploaded file '${file.name}' (${file.size} bytes) of type '${type}'.`,
    targetId: publicPath
  });

  return NextResponse.json({ 
    success: true, 
    path: publicPath,
    name: file.name,
    size: file.size,
    type: file.type
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

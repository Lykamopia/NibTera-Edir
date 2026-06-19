
import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { stat, mkdir, rm } from 'fs/promises';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { logSecurityEvent, SecurityEvent } from '@/lib/security-logger';
import { LogSeverity } from '@/lib/types';
import mime from 'mime-types';
import { encryptBuffer } from '@/lib/encryption';

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

// Main POST handler for file uploads
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  
  const data = await req.formData();
  const file: File | null = data.get('file') as unknown as File;
  const type = data.get('type') as string;

  // Only allow profile, signature, member-document, and rules-attachment uploads
  if (type !== 'profile' && type !== 'signatures' && type !== 'documents' && type !== 'rules') {
    return NextResponse.json({ success: false, error: 'Invalid file type' }, { status: 400 });
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

  // Sanitize the filename to prevent security risks
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9-._]/g, '_');
  const uniqueFilename = `${Date.now()}-${sanitizedFilename}`;
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
    actor: session.user,
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

  // Security check: ensure the resolved path is within the root 'uploads' directory
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!absolutePath.startsWith(uploadsDir)) {
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

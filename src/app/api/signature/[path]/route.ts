
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, sep } from 'path';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { decryptBuffer } from '@/lib/encryption';

export async function GET(req: NextRequest, { params }: { params: { path: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Check if user has a signature with this path
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user?.signature || !user.signature.includes(params.path)) {
    // Also check if it's someone else's signature the user should have access to (e.g., delegated)
    return new NextResponse('Forbidden', { status: 403 });
  }

  const signaturesDir = join(process.cwd(), 'uploads', 'signatures');
  const absolutePath = join(signaturesDir, params.path);

  // Defence-in-depth: never let a crafted path escape the signatures directory.
  if (absolutePath !== signaturesDir && !absolutePath.startsWith(signaturesDir + sep)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const encryptedBuffer = await readFile(absolutePath);
    const decryptedBuffer = decryptBuffer(encryptedBuffer);

    // Return the image with appropriate content type
    const ext = params.path.split('.').pop()?.toLowerCase();
    let contentType = 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
    if (ext === 'gif') contentType = 'image/gif';
    if (ext === 'webp') contentType = 'image/webp';

    return new NextResponse(decryptedBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error serving signature:', error);
    return new NextResponse('Not Found', { status: 404 });
  }
}

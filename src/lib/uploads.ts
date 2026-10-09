import 'server-only';

import prisma from '@/lib/prisma';
import { ValidationError } from '@/lib/errors';
import type { FileTypeSpec, UploadKind } from '@/lib/file-validation';

/**
 * Upload registry — the server's own record of every file /api/upload accepted.
 *
 * Server Actions receive only a path (e.g. "/uploads/documents/<uuid>-x.pdf")
 * from the browser. Without this registry an action could not tell whether the
 * caller really uploaded that file, nor what it is — so a tampered request
 * could attach someone else's file, or label a PDF "invoice.exe". claimUploads
 * closes both: the path must be one THIS user uploaded, of an allowed kind, and
 * the display name / type always come from what the server detected.
 */

/** Upload kinds whose files are encrypted at rest with DATA_ENCRYPTION_KEY. */
export const ENCRYPTED_UPLOAD_KINDS: readonly UploadKind[] = ['documents', 'rules'];

/** Display name: the original stem (control chars / markup / path bits removed)
 *  plus the extension of the DETECTED content type. */
export function trustedDisplayName(originalName: string, type: FileTypeSpec): string {
  const base = (originalName.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '');
  const stem = base
    .replace(/[\u0000-\u001F\u007F<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'file';
  return `${stem}${type.extensions[0]}`;
}

export async function recordUpload(input: {
  path: string; kind: UploadKind; ownerId: string; originalName: string;
  type: FileTypeSpec; size: number; encrypted: boolean;
}): Promise<void> {
  await prisma.upload.create({
    data: {
      path: input.path,
      kind: input.kind,
      ownerId: input.ownerId,
      originalName: trustedDisplayName(input.originalName, input.type),
      mimeType: input.type.mime,
      size: input.size,
      encrypted: input.encrypted,
    },
  });
}

export type ClaimedUpload = {
  path: string;
  /** Server-derived name, safe to store/show; extension matches the content. */
  name: string;
  mimeType: string;
  /** Coarse type used by the document UIs. */
  fileType: 'image' | 'pdf' | 'file';
};

const coarseType = (mime: string): ClaimedUpload['fileType'] =>
  mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'file';

const REUPLOAD = 'This file reference is not valid. Please upload the file again.';

/**
 * Verify that every path was uploaded by `actorId` as one of `kinds`, and
 * return the server's trusted metadata for each (in input order).
 *
 * `keep` lists paths already stored on the record being edited — re-saving a
 * record with its existing file must not require re-uploading it.
 */
export async function claimUploads(
  actorId: string,
  paths: readonly string[],
  opts: { kinds: readonly UploadKind[]; keep?: readonly (string | null | undefined)[] },
): Promise<ClaimedUpload[]> {
  if (paths.length === 0) return [];
  const keep = new Set((opts.keep ?? []).filter(Boolean) as string[]);
  const rows = await prisma.upload.findMany({ where: { path: { in: [...new Set(paths)] } } });
  const byPath = new Map(rows.map(r => [r.path, r]));

  return paths.map((path) => {
    const row = byPath.get(path);
    if (row && (opts.kinds as readonly string[]).includes(row.kind) && (row.ownerId === actorId || keep.has(path))) {
      return { path, name: row.originalName, mimeType: row.mimeType, fileType: coarseType(row.mimeType) };
    }
    // Files that predate the registry are only acceptable when unchanged.
    if (!row && keep.has(path)) {
      const ext = (path.split('.').pop() ?? '').toLowerCase();
      const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return { path, name: path.split('/').pop() ?? 'file', mimeType, fileType: coarseType(mimeType) };
    }
    throw new ValidationError(REUPLOAD);
  });
}

/** Single-path convenience wrapper; null/undefined/'' passes through as null. */
export async function claimUpload(
  actorId: string,
  path: string | null | undefined,
  opts: { kinds: readonly UploadKind[]; keep?: readonly (string | null | undefined)[] },
): Promise<ClaimedUpload | null> {
  if (!path) return null;
  const [claimed] = await claimUploads(actorId, [path], opts);
  return claimed;
}

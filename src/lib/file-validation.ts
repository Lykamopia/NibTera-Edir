/**
 * Central upload policy: a strict **allow list** of permitted file types per
 * upload category, enforced against the file's actual bytes.
 *
 * Nothing here trusts the client. The filename extension and the multipart
 * `Content-Type` are both attacker-controlled, so they are only ever used to
 * *narrow* what is accepted — the authoritative check is `detectFileType`,
 * which reads the leading magic bytes. A file is stored only when:
 *
 *   1. its category is a known upload kind,
 *   2. its size is within that category's cap,
 *   3. its extension is on that category's allow list,
 *   4. its declared MIME type (when the browser sent a meaningful one) is on
 *      that category's allow list,
 *   5. its **magic bytes** decode to a type on that category's allow list, and
 *   6. the detected type agrees with the extension — so a file can never be
 *      served back under a Content-Type its bytes do not match.
 *
 * Executables, scripts, archives, Office documents and SVG (an XSS vector, as
 * it is script-bearing XML) are absent from every list and therefore rejected;
 * this is an allow list, so new formats must be added deliberately.
 */

export interface FileTypeSpec {
  /** Stable identifier used in logs. */
  id: 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf';
  /** Canonical MIME type. */
  mime: string;
  /** Permitted extensions, lower-case with the leading dot; canonical first. */
  extensions: readonly string[];
  /** Magic-number test against the head of the file. */
  matches: (buf: Buffer) => boolean;
}

const JPEG: FileTypeSpec = {
  id: 'jpeg',
  mime: 'image/jpeg',
  extensions: ['.jpg', '.jpeg'],
  // SOI marker followed by the start of any JPEG segment.
  matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

const PNG: FileTypeSpec = {
  id: 'png',
  mime: 'image/png',
  extensions: ['.png'],
  // Full 8-byte signature, including the CR/LF/EOF transfer-corruption guards.
  matches: (b) =>
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
};

const GIF: FileTypeSpec = {
  id: 'gif',
  mime: 'image/gif',
  extensions: ['.gif'],
  // "GIF87a" / "GIF89a" — the only two valid version blocks.
  matches: (b) => {
    if (b.length < 6) return false;
    const head = b.toString('latin1', 0, 6);
    return head === 'GIF87a' || head === 'GIF89a';
  },
};

const WEBP: FileTypeSpec = {
  id: 'webp',
  mime: 'image/webp',
  extensions: ['.webp'],
  // RIFF container whose form type is WEBP.
  matches: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

const PDF: FileTypeSpec = {
  id: 'pdf',
  mime: 'application/pdf',
  extensions: ['.pdf'],
  // "%PDF-" at offset 0. Leading junk is rejected on purpose: a file that only
  // becomes a PDF further in is exactly the polyglot this check exists to stop.
  matches: (b) => b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-',
};

/** Every format the application knows how to recognise. */
const KNOWN_TYPES: readonly FileTypeSpec[] = [JPEG, PNG, GIF, WEBP, PDF];

const IMAGES: readonly FileTypeSpec[] = [JPEG, PNG, GIF, WEBP];
const PHOTO_IMAGES: readonly FileTypeSpec[] = [JPEG, PNG, WEBP];

export type UploadKind = 'profile' | 'signatures' | 'documents' | 'rules' | 'logos' | 'bg';

interface UploadPolicy {
  types: readonly FileTypeSpec[];
  maxBytes: number;
  /** Human wording used in the rejection message. */
  label: string;
}

const MB = 1024 * 1024;

export const UPLOAD_POLICIES: Record<UploadKind, UploadPolicy> = {
  profile:    { types: IMAGES,           maxBytes: 10 * MB, label: 'an image (JPEG, PNG, GIF or WEBP)' },
  signatures: { types: IMAGES,           maxBytes: 10 * MB, label: 'an image (JPEG, PNG, GIF or WEBP)' },
  logos:      { types: IMAGES,           maxBytes: 10 * MB, label: 'an image (JPEG, PNG, GIF or WEBP)' },
  documents:  { types: [...IMAGES, PDF], maxBytes: 10 * MB, label: 'a PDF or image (JPEG, PNG, GIF or WEBP)' },
  rules:      { types: [...IMAGES, PDF], maxBytes: 10 * MB, label: 'a PDF or image (JPEG, PNG, GIF or WEBP)' },
  // Login/marketing background art — uploaded only by settings administrators.
  bg:         { types: PHOTO_IMAGES,     maxBytes: 5 * MB,  label: 'an image (JPEG, PNG or WEBP)' },
};

/** Categories reachable through the authenticated `/api/upload` endpoint. */
export const API_UPLOAD_KINDS: readonly UploadKind[] = ['profile', 'signatures', 'documents', 'rules', 'logos'];

export function isApiUploadKind(value: unknown): value is UploadKind {
  return typeof value === 'string' && (API_UPLOAD_KINDS as readonly string[]).includes(value);
}

/** Every extension permitted for a category, e.g. `['.jpg', '.jpeg', '.png']`. */
export function allowedExtensions(kind: UploadKind): string[] {
  return UPLOAD_POLICIES[kind].types.flatMap((t) => [...t.extensions]);
}

/** Value for an `<input type="file" accept=...>` attribute. */
export function acceptAttribute(kind: UploadKind): string {
  const policy = UPLOAD_POLICIES[kind];
  return [...allowedExtensions(kind), ...policy.types.map((t) => t.mime)].join(',');
}

/**
 * Identify a file purely from its leading bytes. Returns null when the content
 * matches no known format — which is itself a rejection.
 */
export function detectFileType(buffer: Buffer): FileTypeSpec | null {
  return KNOWN_TYPES.find((t) => t.matches(buffer)) ?? null;
}

/** Lower-cased final extension (with dot), or '' when the name has none. */
export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  // A leading dot (".htaccess") is a hidden file, not an extension.
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

export type UploadValidation =
  | { ok: true; type: FileTypeSpec; extension: string }
  /** `error` is safe to show the user; `reason` is for the security log only. */
  | { ok: false; error: string; reason: string; status: number };

/**
 * Run the full allow-list + content-inspection check for one upload.
 * `buffer` must be the complete, plaintext file content.
 */
export function validateUpload(
  kind: UploadKind,
  input: { filename: string; declaredMime?: string | null; buffer: Buffer },
): UploadValidation {
  const policy = UPLOAD_POLICIES[kind];
  const { filename, buffer } = input;
  const declaredMime = (input.declaredMime || '').toLowerCase().split(';')[0].trim();

  if (buffer.length === 0) {
    return { ok: false, error: 'The file is empty.', reason: 'zero-length upload', status: 400 };
  }
  if (buffer.length > policy.maxBytes) {
    const mb = Math.round(policy.maxBytes / MB);
    return {
      ok: false,
      error: `File size exceeds the ${mb}MB limit.`,
      reason: `size ${buffer.length} over cap ${policy.maxBytes}`,
      status: 413,
    };
  }

  // One message for every allow-list failure, so probing cannot map the rules.
  const rejected = (reason: string): UploadValidation => ({
    ok: false,
    error: `Only ${policy.label} is accepted here.`,
    reason,
    status: 400,
  });

  // 1. Extension allow list — anything not explicitly listed is refused,
  //    including files with no extension at all.
  const extension = fileExtension(filename);
  if (!extension || !allowedExtensions(kind).includes(extension)) {
    return rejected(`extension '${extension || '(none)'}' is not on the ${kind} allow list`);
  }

  // 2. Declared (client) MIME allow list. Browsers occasionally send nothing or
  //    a generic octet-stream for known-good files, which is tolerated — the
  //    byte inspection below is what actually decides.
  const genericMime = declaredMime === '' || declaredMime === 'application/octet-stream';
  if (!genericMime && !policy.types.some((t) => t.mime === declaredMime)) {
    return rejected(`declared MIME '${declaredMime}' is not on the ${kind} allow list`);
  }

  // 3. Content inspection — the authoritative check.
  const detected = detectFileType(buffer);
  if (!detected) {
    return rejected(`byte signature matches no permitted format (head=${buffer.subarray(0, 8).toString('hex')})`);
  }
  if (!policy.types.includes(detected)) {
    return rejected(`content is '${detected.id}', which is not on the ${kind} allow list`);
  }

  // 4. The real content must agree with the extension it will be stored under,
  //    so the file can never be served with a mismatched Content-Type.
  if (!detected.extensions.includes(extension)) {
    return rejected(`extension '${extension}' contradicts the actual content '${detected.id}'`);
  }

  return { ok: true, type: detected, extension };
}

/**
 * Build the on-disk name: a random prefix (collision-free, leaks no upload
 * timing), the sanitised original stem for human readability, and the
 * **content-derived** extension rather than whatever the client supplied.
 */
export function buildStoredFilename(uniquePrefix: string, originalName: string, type: FileTypeSpec): string {
  const base = (originalName.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '');
  const stem = base.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_{2,}/g, '_').slice(0, 60) || 'file';
  return `${uniquePrefix}-${stem}${type.extensions[0]}`;
}

import crypto from 'crypto';

/**
 * At-rest encryption for signature images (below) and, further down, for other
 * uploaded documents and sensitive database fields (DATA_ENCRYPTION_KEY).
 *
 * Current format (v1) — AES-256-GCM, authenticated encryption:
 *
 *   MAGIC "NTE\x01" (4) | IV (12, random per encryption) | TAG (16) | CIPHERTEXT
 *
 * - A fresh, unpredictable 96-bit IV comes from the CSPRNG for every call; with
 *   random 96-bit IVs a single key is safe for far more files than we will
 *   ever store (NIST SP 800-38D limit: 2^32 encryptions).
 * - The 128-bit authentication tag is verified BEFORE any plaintext is returned
 *   (`decipher.final()` throws on mismatch), so tampered, truncated or
 *   substituted ciphertext is rejected — never served.
 * - The header is bound as additional authenticated data (AAD), so the version
 *   byte cannot be swapped without failing verification.
 * - The GCM key is derived from SIGNATURE_ENCRYPTION_KEY with HKDF-SHA-256 over
 *   the FULL secret (the legacy scheme used only its first 32 characters).
 *
 * Legacy format — AES-256-CBC with no MAC (IV | ciphertext), written by earlier
 * releases. It is REFUSED by default. The only way to read it is the one-off
 * re-encryption `npx tsx scripts/migrate-signature-encryption.ts --apply`,
 * which enables legacy reads for its own process and rewrites every file as
 * GCM. (ENCRYPTION_ALLOW_LEGACY_CBC=true exists only as an emergency override.)
 */

const MAGIC = Buffer.from([0x4e, 0x54, 0x45, 0x01]); // "NTE" + format version 1
const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + GCM_IV_LENGTH + GCM_TAG_LENGTH;

const LEGACY_CBC_ALGORITHM = 'aes-256-cbc';
const LEGACY_CBC_IV_LENGTH = 16;

const HKDF_SALT = 'nibtera-edir/at-rest-encryption';
const HKDF_INFO = 'signature-files/aes-256-gcm/v1';

/** Thrown when ciphertext fails authentication or cannot be decrypted. */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * The configured secret. There is deliberately NO hard-coded fallback — a known
 * default key would mean signatures are effectively unencrypted.
 */
function getSecret(): string {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'SIGNATURE_ENCRYPTION_KEY is missing or too short (require >= 32 characters). ' +
      'Set a strong random value in the environment / secrets manager.',
    );
  }
  return key;
}

let cachedGcmKey: { secret: string; key: Buffer } | null = null;

/** 256-bit AES-GCM key: HKDF-SHA-256 over the whole configured secret. */
function getGcmKey(): Buffer {
  const secret = getSecret();
  if (cachedGcmKey?.secret !== secret) {
    const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), HKDF_SALT, HKDF_INFO, 32));
    cachedGcmKey = { secret, key };
  }
  return cachedGcmKey.key;
}

/** Key derivation used by the legacy CBC format (kept only to read old files). */
function getLegacyCbcKey(): Buffer {
  return Buffer.from(getSecret().slice(0, 32));
}

/**
 * Whether legacy (unauthenticated) CBC ciphertext may still be read.
 *
 * Secure by default: CBC without a MAC is REFUSED unless an operator explicitly
 * sets ENCRYPTION_ALLOW_LEGACY_CBC=true (only the migration script does so, for
 * its own process). Nothing in the app ever encrypts with CBC.
 */
export function legacyCbcAllowed(): boolean {
  return (process.env.ENCRYPTION_ALLOW_LEGACY_CBC ?? 'false').trim().toLowerCase() === 'true';
}

/** True when `buffer` is in the current authenticated (GCM v1) format. */
export function isAuthenticatedFormat(buffer: Buffer): boolean {
  return buffer.length >= HEADER_LENGTH && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

/** Encrypts with AES-256-GCM using a fresh random IV. Returns MAGIC|IV|TAG|CIPHERTEXT. */
export function encryptBuffer(plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, getGcmKey(), iv, { authTagLength: GCM_TAG_LENGTH });
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

function decryptGcm(buffer: Buffer): Buffer {
  const iv = buffer.subarray(MAGIC.length, MAGIC.length + GCM_IV_LENGTH);
  const tag = buffer.subarray(MAGIC.length + GCM_IV_LENGTH, HEADER_LENGTH);
  const ciphertext = buffer.subarray(HEADER_LENGTH);
  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, getGcmKey(), iv, { authTagLength: GCM_TAG_LENGTH });
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    // final() verifies the tag; on mismatch it throws and the partially
    // decrypted bytes from update() are discarded — never returned.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext;
  } catch {
    throw new DecryptionError('Authentication failed: the encrypted file was modified or the key is wrong.');
  }
}

function decryptLegacyCbc(buffer: Buffer): Buffer {
  if (buffer.length < LEGACY_CBC_IV_LENGTH * 2 || (buffer.length - LEGACY_CBC_IV_LENGTH) % 16 !== 0) {
    throw new DecryptionError('Not a valid encrypted file.');
  }
  const iv = buffer.subarray(0, LEGACY_CBC_IV_LENGTH);
  const decipher = crypto.createDecipheriv(LEGACY_CBC_ALGORITHM, getLegacyCbcKey(), iv);
  try {
    return Buffer.concat([decipher.update(buffer.subarray(LEGACY_CBC_IV_LENGTH)), decipher.final()]);
  } catch {
    throw new DecryptionError('Not a valid encrypted file.');
  }
}

export interface DecryptResult {
  data: Buffer;
  /** true when the data came from the unauthenticated legacy CBC format. */
  legacy: boolean;
}

/**
 * Decrypts and authenticates. GCM data is returned only after its tag verifies.
 * Legacy CBC data is accepted only while legacy reads are enabled.
 * Throws DecryptionError otherwise — callers must NOT fall back to serving the
 * raw bytes.
 */
export function decryptBufferDetailed(buffer: Buffer): DecryptResult {
  if (isAuthenticatedFormat(buffer)) return { data: decryptGcm(buffer), legacy: false };
  if (!legacyCbcAllowed()) {
    throw new DecryptionError('Unauthenticated (legacy CBC) ciphertext is not accepted.');
  }
  return { data: decryptLegacyCbc(buffer), legacy: true };
}

/** Decrypts and authenticates; see decryptBufferDetailed. */
export function decryptBuffer(buffer: Buffer): Buffer {
  return decryptBufferDetailed(buffer).data;
}

// ─── Application data encryption (uploaded documents + sensitive DB fields) ───
//
// Same primitive as above — AES-256-GCM, fresh random 96-bit IV per call,
// 128-bit tag verified before anything is returned — but under a SEPARATE
// master secret, DATA_ENCRYPTION_KEY, so a leak of one key never exposes the
// other's data. From that secret HKDF-SHA-256 derives one sub-key per purpose
// (files vs. fields), so a ciphertext can never be decrypted in the wrong role.
//
//   File  (v2):  "NTE\x02" (4) | IV (12) | TAG (16) | CIPHERTEXT      AAD = header
//   Field (v1):  "enc1:" + base64( IV | TAG | CIPHERTEXT )            AAD = field name
//
// Binding the field name as AAD means a value copied from one column into
// another (e.g. nationalId → occupation) fails authentication.

const FILE_MAGIC = Buffer.from([0x4e, 0x54, 0x45, 0x02]); // "NTE" + format version 2
const FILE_HEADER_LENGTH = FILE_MAGIC.length + GCM_IV_LENGTH + GCM_TAG_LENGTH;
const FIELD_PREFIX = 'enc1:';
const DATA_HKDF_SALT = 'nibtera-edir/application-data-encryption';

function getDataSecret(): string {
  const key = process.env.DATA_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'DATA_ENCRYPTION_KEY is missing or too short (require >= 32 characters). ' +
      'Set a strong random value (e.g. `openssl rand -hex 32`) in the environment / secrets manager.',
    );
  }
  return key;
}

const dataKeyCache = new Map<string, { secret: string; key: Buffer }>();
function getDataKey(purpose: 'files/aes-256-gcm/v2' | 'fields/aes-256-gcm/v1'): Buffer {
  const secret = getDataSecret();
  const cached = dataKeyCache.get(purpose);
  if (cached?.secret === secret) return cached.key;
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), DATA_HKDF_SALT, purpose, 32));
  dataKeyCache.set(purpose, { secret, key });
  return key;
}

function gcmSeal(key: Buffer, plaintext: Buffer, aad: Buffer): { iv: Buffer; tag: Buffer; ciphertext: Buffer } {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv, { authTagLength: GCM_TAG_LENGTH });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function gcmOpen(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: Buffer, what: string): Buffer {
  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv, { authTagLength: GCM_TAG_LENGTH });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptionError(`Authentication failed: the encrypted ${what} was modified or the key is wrong.`);
  }
}

/** True when `buffer` is an encrypted uploaded file (v2). */
export function isEncryptedFile(buffer: Buffer): boolean {
  return buffer.length >= FILE_HEADER_LENGTH && buffer.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);
}

/** Encrypts an uploaded file for storage at rest. */
export function encryptFile(plaintext: Buffer): Buffer {
  const { iv, tag, ciphertext } = gcmSeal(getDataKey('files/aes-256-gcm/v2'), plaintext, FILE_MAGIC);
  return Buffer.concat([FILE_MAGIC, iv, tag, ciphertext]);
}

/** Decrypts an uploaded file; throws DecryptionError unless the tag verifies. */
export function decryptFile(buffer: Buffer): Buffer {
  if (!isEncryptedFile(buffer)) throw new DecryptionError('Not an encrypted file.');
  const iv = buffer.subarray(FILE_MAGIC.length, FILE_MAGIC.length + GCM_IV_LENGTH);
  const tag = buffer.subarray(FILE_MAGIC.length + GCM_IV_LENGTH, FILE_HEADER_LENGTH);
  return gcmOpen(getDataKey('files/aes-256-gcm/v2'), iv, tag, buffer.subarray(FILE_HEADER_LENGTH), FILE_MAGIC, 'file');
}

/** True when a stored column value is field-encrypted. */
export function isEncryptedField(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(FIELD_PREFIX);
}

/**
 * Encrypt a sensitive text column. `field` names the column (e.g.
 * 'Member.nationalId') and is authenticated, so the ciphertext only decrypts
 * as that column. null / '' pass through unchanged.
 */
export function encryptField(field: string, value: string | null | undefined): string | null {
  if (value == null || value === '') return value ?? null;
  if (isEncryptedField(value)) return value; // never double-encrypt
  const { iv, tag, ciphertext } = gcmSeal(getDataKey('fields/aes-256-gcm/v1'), Buffer.from(value, 'utf8'), Buffer.from(field, 'utf8'));
  return FIELD_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypt a column written by encryptField. Plain (not-yet-migrated) values are
 * returned as-is so reads keep working while
 * `scripts/migrate-data-encryption.ts` backfills existing rows.
 */
export function decryptField(field: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!isEncryptedField(value)) return value;
  const raw = Buffer.from(value.slice(FIELD_PREFIX.length), 'base64');
  if (raw.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) throw new DecryptionError('Malformed encrypted field.');
  const iv = raw.subarray(0, GCM_IV_LENGTH);
  const tag = raw.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH);
  return gcmOpen(getDataKey('fields/aes-256-gcm/v1'), iv, tag, raw.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH), Buffer.from(field, 'utf8'), 'field').toString('utf8');
}

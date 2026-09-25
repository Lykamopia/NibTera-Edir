import crypto from 'crypto';

/**
 * At-rest encryption for sensitive uploads (signature images).
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
 * releases. It is readable only while ENCRYPTION_ALLOW_LEGACY_CBC is not
 * "false", purely so existing files keep working until they are re-encrypted
 * with `npx tsx scripts/migrate-signature-encryption.ts`. After migrating, set
 * ENCRYPTION_ALLOW_LEGACY_CBC=false so unauthenticated ciphertext is refused.
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

/** Whether legacy (unauthenticated) CBC ciphertext may still be read. */
export function legacyCbcAllowed(): boolean {
  return (process.env.ENCRYPTION_ALLOW_LEGACY_CBC ?? 'true').trim().toLowerCase() !== 'false';
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

import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Resolve the at-rest encryption key from the environment. There is deliberately
 * NO hard-coded fallback — a known default key would mean signatures are
 * effectively unencrypted. The key derivation (first 32 bytes) is preserved for
 * backward-compatibility with data already encrypted under a configured key.
 */
function getKey(): Buffer {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'SIGNATURE_ENCRYPTION_KEY is missing or too short (require >= 32 characters). ' +
      'Set a strong random value in the environment / secrets manager.',
    );
  }
  return Buffer.from(key.slice(0, 32));
}

/**
 * Encrypts a buffer using AES-256-CBC.
 * The IV is prepended to the encrypted data.
 */
export function encryptBuffer(buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

/**
 * Decrypts a buffer using AES-256-CBC.
 * Expects the IV to be prepended to the data.
 */
export function decryptBuffer(buffer: Buffer): Buffer {
  if (buffer.length < IV_LENGTH) {
    throw new Error('Buffer too short to be encrypted data');
  }
  const iv = buffer.slice(0, IV_LENGTH);
  const encryptedData = buffer.slice(IV_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted;
}

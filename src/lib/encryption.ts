import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const KEY = process.env.SIGNATURE_ENCRYPTION_KEY || 'default-secret-key-32-chars-long!!';
const IV_LENGTH = 16;

/**
 * Encrypts a buffer using AES-256-CBC.
 * The IV is prepended to the encrypted data.
 */
export function encryptBuffer(buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(KEY.slice(0, 32)), iv);
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
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(KEY.slice(0, 32)), iv);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted;
}

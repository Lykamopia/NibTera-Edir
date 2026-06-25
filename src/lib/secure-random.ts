import crypto from 'crypto';

// Unambiguous character classes (no 0/O/1/l/I) for human-distributable temp
// passwords. Every generated password contains at least one of each class so it
// satisfies the standard password policy on first login.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*';
const ALL = UPPER + LOWER + DIGITS + SPECIAL;

/** Pick one character from `set` using a cryptographically-secure, unbiased index. */
function pick(set: string): string {
  return set[crypto.randomInt(set.length)];
}

/**
 * Generate a cryptographically-secure temporary password.
 *
 * Uses Node's CSPRNG (`crypto.randomInt`) — never `Math.random`. Guarantees at
 * least one upper, lower, digit and special character, then fills the remainder
 * and shuffles with crypto entropy so class positions are not predictable.
 */
export function generateTempPassword(length = 16): string {
  const len = Math.max(12, length);
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  for (let i = chars.length; i < len; i++) chars.push(pick(ALL));
  // Fisher–Yates shuffle seeded by the CSPRNG.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Generate a cryptographically-secure, URL-safe opaque token (e.g. for
 * correlation/request IDs or one-time tokens). Default 32 bytes of entropy.
 */
export function secureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

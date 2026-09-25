import crypto from 'crypto';

// Unambiguous character classes (no 0/O/1/l/I) for human-distributable temp
// passwords. Every generated password contains at least one of each class so it
// satisfies the standard password policy on first login.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*';
const ALL = UPPER + LOWER + DIGITS + SPECIAL;

/**
 * Validate a caller-supplied size before it drives a generator loop or buffer
 * allocation. Rejects non-numbers, NaN, ±Infinity, fractions and anything
 * outside [min, max] — the inputs that make size-driven ID generators (e.g. the
 * nanoid size-coercion flaw) loop forever, allocate unbounded memory, or
 * silently return a far shorter secret than intended.
 */
export function assertSafeSize(value: unknown, min: number, max: number, name = 'size'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** Temp passwords: at least the policy minimum, at most bcrypt's 72-byte input limit. */
export const TEMP_PASSWORD_MIN_LENGTH = 12;
export const TEMP_PASSWORD_MAX_LENGTH = 72;
/** Opaque tokens: at least 128 bits of entropy, capped to keep allocations small. */
export const TOKEN_MIN_BYTES = 16;
export const TOKEN_MAX_BYTES = 256;

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
  const len = assertSafeSize(length, TEMP_PASSWORD_MIN_LENGTH, TEMP_PASSWORD_MAX_LENGTH, 'length');
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
  return crypto.randomBytes(assertSafeSize(bytes, TOKEN_MIN_BYTES, TOKEN_MAX_BYTES, 'bytes')).toString('base64url');
}

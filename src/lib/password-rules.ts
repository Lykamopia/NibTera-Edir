/**
 * Password requirements shared by the server policy (src/lib/password-policy.ts)
 * and the password forms. Client-safe: no Node APIs, no network.
 *
 * The forms use these only for live feedback; the server re-checks everything
 * (plus the common/compromised/guessable checks) and is the sole authority.
 */

/** Minimum length. Users authenticate with a password alone, so 12 rather than 8. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * bcrypt ignores everything after the 72nd byte, so a longer password would be
 * silently truncated. Reject instead of pretending the tail counts.
 */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordRequirement = { label: string; error: string; test: (password: string) => boolean };

export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    test: (p) => [...p].length >= PASSWORD_MIN_LENGTH,
  },
  {
    label: 'One uppercase letter',
    error: 'Password must contain at least one uppercase letter.',
    test: (p) => /[A-Z]/.test(p),
  },
  {
    label: 'One lowercase letter',
    error: 'Password must contain at least one lowercase letter.',
    test: (p) => /[a-z]/.test(p),
  },
  {
    label: 'One number',
    error: 'Password must contain at least one number.',
    test: (p) => /[0-9]/.test(p),
  },
  {
    label: 'One special character (e.g. ! @ # $ % _ -)',
    error: 'Password must contain at least one special character.',
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

/** Plain-language summary for the password forms. */
export const PASSWORD_GUIDANCE =
  `Use at least ${PASSWORD_MIN_LENGTH} characters with upper and lowercase letters, a number and a symbol. ` +
  'Avoid common words, your name, email or phone number, and patterns like "1234" or "qwerty".';

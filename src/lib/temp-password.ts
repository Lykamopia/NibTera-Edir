import crypto from 'crypto';

/**
 * Generate a secure, human-shareable temporary password. Guarantees at least one
 * lowercase, uppercase, digit, and symbol so it satisfies the password policy,
 * while staying easy to read aloud or copy onto a printed slip. The plaintext is
 * shown to the admin exactly once and only the bcrypt hash is persisted.
 */
export function generateTempPassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';   // no l/o
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O
  const digits = '23456789';                  // no 0/1
  const symbols = '@#$%&*';

  const pick = (set: string) => set[crypto.randomInt(0, set.length)];
  const all = lower + upper + digits + symbols;

  // 10 chars: one from each class + 6 random, then shuffle.
  const base = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  for (let i = 0; i < 6; i++) base.push(pick(all));
  for (let i = base.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}

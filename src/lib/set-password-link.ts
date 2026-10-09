/**
 * Credential delivery without plaintext passwords.
 *
 * Security policy: temporary passwords are never returned to the UI or put in
 * an email. Instead, accounts get a random hashed password they never see, and
 * the person receives a single-use set-password LINK by email. This helper is
 * the one place that issues those links — used by every create/reset flow.
 */

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { sendVerificationEmail, sendPasswordResetEmail } from '@/lib/email';

/** "abebe.kebede@gmail.com" → "ab****@gmail.com" — enough for the admin to
 *  confirm the destination without exposing the full address on screen. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '****';
  const head = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${head}****@${domain}`;
}

export type LinkDelivery =
  | { sent: true; emailMasked: string }
  | { sent: false; reason: 'NO_EMAIL' | 'SEND_FAILED' };

/**
 * Create (or refresh) a set-password token for `email` and send the link.
 * `mode: 'setup'` sends the welcome/onboarding email (48h token);
 * `mode: 'reset'` sends the password-reset email (3min token — TESTING).
 * Never throws — a failed send is reported so the caller can tell the admin.
 */
export async function issueSetPasswordLink(opts: {
  email: string | null | undefined;
  name?: string | null;
  mode: 'setup' | 'reset';
}): Promise<LinkDelivery> {
  const email = opts.email?.trim().toLowerCase();
  if (!email) return { sent: false, reason: 'NO_EMAIL' };

  const token = crypto.randomBytes(32).toString('hex');
  // TESTING: reset links are short-lived (3 min). Restore to 60 before release.
  const minutes = opts.mode === 'setup' ? 48 * 60 : 3;
  const expires = new Date(Date.now() + minutes * 60 * 1000);
  await prisma.passwordResetToken.upsert({
    where: { email },
    update: { token: hashResetToken(token), expires, createdAt: new Date() },
    create: { email, token: hashResetToken(token), expires },
  });

  try {
    const info = opts.mode === 'setup'
      ? await sendVerificationEmail({ to: email, name: opts.name ?? 'User', token })
      : await sendPasswordResetEmail({ to: email, name: opts.name ?? 'User', token });
    // sendVerificationEmail resolves null on failure instead of throwing.
    if (!info) return { sent: false, reason: 'SEND_FAILED' };
    return { sent: true, emailMasked: maskEmail(email) };
  } catch {
    return { sent: false, reason: 'SEND_FAILED' };
  }
}

/**
 * Set-password / reset tokens are stored only as a SHA-256 hash: the raw token
 * exists solely in the emailed link, so a database leak cannot be used to take
 * over accounts. A fast hash is appropriate — the token is 256 random bits,
 * not a guessable secret.
 */
export function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

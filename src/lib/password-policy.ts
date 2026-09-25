import { isPasswordPwned } from './pwned-password';
import { PASSWORD_MAX_BYTES, PASSWORD_REQUIREMENTS } from './password-rules';

/**
 * Server-side password policy — the single authority for every place a user
 * chooses a password: invitation/registration and reset (setPassword), the
 * mandatory first-login change, and the self-service change. Client-side checks
 * in the forms are convenience only.
 *
 * Checks, cheapest first:
 *  1. Length (min 12, max 72 bytes — bcrypt's limit) and composition.
 *  2. Easily guessable structure: runs of one character, sequences and keyboard
 *     walks ("abcd", "4321", "qwer"), a short block repeated, too few distinct
 *     characters.
 *  3. Common passwords: a built-in list of the most-guessed base words, matched
 *     after undoing the usual mangling (capitalisation, leetspeak, digits or
 *     symbols bolted on the ends) — so "P@ssw0rd2024!" counts as "password".
 *  4. Context: the user's own name, email or phone number, and the service's
 *     name, anywhere in the password.
 *  5. Compromised: the Have I Been Pwned range API (k-anonymity; only 5 hex
 *     characters of the SHA-1 ever leave the server). Checks 1–4 run offline,
 *     so the policy stays strong if that service is unreachable.
 */

export type PasswordContext = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type PasswordValidationResult = { ok: true } | { ok: false; error: string };

/** Base words attackers try first (lowercase, letters only). */
const COMMON_BASE_WORDS = new Set([
  'password', 'passw', 'passwd', 'pass', 'pwd', 'secret', 'letmein', 'welcome', 'admin', 'administrator',
  'root', 'user', 'login', 'guest', 'test', 'tester', 'testing', 'default', 'changeme', 'temp', 'temporary',
  'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'qazwsx', 'abc', 'abcd', 'abcdef',
  'iloveyou', 'love', 'lovely', 'loveme', 'mylove', 'baby', 'babygirl', 'sweet', 'sweety', 'honey', 'angel',
  'princess', 'prince', 'queen', 'king', 'master', 'monkey', 'dragon', 'shadow', 'sunshine', 'superman',
  'batman', 'spiderman', 'starwars', 'pokemon', 'naruto', 'freedom', 'whatever', 'trustno', 'hello', 'hi',
  'football', 'soccer', 'baseball', 'basketball', 'hockey', 'arsenal', 'chelsea', 'liverpool', 'manutd',
  'barcelona', 'realmadrid', 'jordan', 'michael', 'jesus', 'christ', 'god', 'godisgood', 'blessed', 'amen',
  'summer', 'winter', 'spring', 'autumn', 'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'monday', 'friday', 'sunday', 'computer', 'internet',
  'google', 'facebook', 'microsoft', 'apple', 'samsung', 'iphone', 'android', 'mobile', 'phone', 'office',
  'company', 'business', 'money', 'bank', 'banking', 'finance', 'account', 'security', 'secure', 'access',
  'system', 'server', 'network', 'office', 'work', 'job', 'family', 'mother', 'father', 'mom', 'dad',
  'flower', 'rainbow', 'purple', 'orange', 'yellow', 'silver', 'golden', 'diamond', 'tiger', 'lion',
  'eagle', 'cheese', 'chocolate', 'cookie', 'coffee', 'buna', 'pizza', 'hunter', 'killer', 'ninja',
  'matrix', 'mustang', 'ferrari', 'porsche', 'harley', 'yamaha', 'toyota', 'corolla', 'soccer', 'music',
  'ethiopia', 'ethiopian', 'addis', 'addisababa', 'abeba', 'habesha', 'selam', 'salam', 'amharic', 'birr',
  'ethio', 'ethiotelecom', 'telebirr', 'abyssinia', 'lalibela', 'gondar', 'axum', 'harar', 'bahirdar',
  'meskel', 'timket', 'genna', 'enkutatash', 'fasika', 'injera', 'yene', 'wude', 'fikir', 'konjo',
]);

/** The service's own names — never acceptable inside a password. */
const SERVICE_TERMS = ['nibtera', 'nibbank', 'nibinternational', 'edir', 'nibedir'];

/**
 * Sequences, with the run length that counts as "walking" them. Keyboard rows
 * need 5 keys: 4-key fragments like "erty" occur in ordinary words ("liberty").
 */
const SEQUENCES: { chars: string; run: number }[] = [
  { chars: 'abcdefghijklmnopqrstuvwxyz', run: 4 },
  { chars: '01234567890', run: 4 },
  { chars: 'qwertyuiop', run: 5 },
  { chars: 'asdfghjkl', run: 5 },
  { chars: 'zxcvbnm', run: 5 },
  { chars: '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p', run: 5 },
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'l', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's',
  '7': 't', '+': 't', '8': 'b', '9': 'g',
};

function deLeet(value: string, oneAs: 'i' | 'l' = 'i'): string {
  let out = '';
  for (const ch of value) out += ch === '1' ? oneAs : (LEET[ch] ?? ch);
  return out;
}

/** "P@ssw0rd2024!" → "password": drop the digits/symbols bolted on the ends, then undo leetspeak. */
function coreWords(password: string): string[] {
  const trimmed = password.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!trimmed) return [];
  return [...new Set([deLeet(trimmed, 'i'), deLeet(trimmed, 'l')].map((w) => w.replace(/[^a-z]/g, '')))];
}

function hasSequence(password: string): boolean {
  const lower = password.toLowerCase();
  return SEQUENCES.some(({ chars, run }) => {
    for (let i = 0; i + run <= lower.length; i++) {
      const chunk = lower.slice(i, i + run);
      if (chars.includes(chunk) || chars.includes([...chunk].reverse().join(''))) return true;
    }
    return false;
  });
}

function guessableReason(password: string): string | null {
  if (/(.)\1{3,}/u.test(password)) {
    return 'Password must not repeat the same character four or more times in a row.';
  }
  if (hasSequence(password)) {
    return 'Password must not contain sequences or keyboard patterns such as "1234", "abcd" or "qwerty".';
  }
  if (/^([\s\S]{1,6})\1+$/u.test(password)) {
    return 'Password must not be a short pattern repeated (e.g. "Ab1!Ab1!Ab1!").';
  }
  if (new Set(password.toLowerCase()).size < 6) {
    return 'Password is too easy to guess. Use a greater variety of characters.';
  }
  return null;
}

function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  const variants = [deLeet(lower, 'i'), deLeet(lower, 'l')];
  // The whole thing is a common word once the usual mangling is removed…
  if (coreWords(password).some((w) => COMMON_BASE_WORDS.has(w))) return true;
  // …or it is built around one of the most-guessed words.
  return variants.some((v) => ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou'].some((w) => v.includes(w)));
}

/** Tokens from the user's own details that must not appear in the password. */
function contextTokens(ctx: PasswordContext): string[] {
  const tokens = new Set<string>(SERVICE_TERMS);
  const addWords = (value?: string | null) => {
    for (const part of (value ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (part.length >= 4) tokens.add(part);
    }
  };
  addWords(ctx.name);
  const localPart = (ctx.email ?? '').split('@')[0];
  addWords(localPart);
  if (localPart.length >= 4) tokens.add(localPart.toLowerCase());
  const digits = (ctx.phone ?? '').replace(/\D/g, '');
  if (digits.length >= 9) {
    tokens.add(digits.slice(-9)); // national number, e.g. 911223344
    tokens.add(digits.slice(-6));
  }
  return [...tokens];
}

function containsPersonalInfo(password: string, ctx: PasswordContext): boolean {
  const lower = password.toLowerCase();
  const variants = [lower, deLeet(lower, 'i'), deLeet(lower, 'l')];
  return contextTokens(ctx).some((token) => variants.some((v) => v.includes(token)));
}

/**
 * Validate a user-chosen password. Returns the first failure as a user-safe
 * message (nothing about the password itself is logged or echoed).
 */
export async function validatePassword(password: unknown, ctx: PasswordContext = {}): Promise<PasswordValidationResult> {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Please enter a password.' };
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX_BYTES} characters long.` };
  }
  for (const rule of PASSWORD_REQUIREMENTS) {
    if (!rule.test(password)) return { ok: false, error: rule.error };
  }

  const guessable = guessableReason(password);
  if (guessable) return { ok: false, error: guessable };

  if (isCommonPassword(password)) {
    return { ok: false, error: 'This password is too common and easy to guess. Please choose something less predictable.' };
  }
  if (containsPersonalInfo(password, ctx)) {
    return { ok: false, error: 'Password must not contain your name, email, phone number or the service name.' };
  }

  if (await isPasswordPwned(password)) {
    return { ok: false, error: 'This password has appeared in a known data breach. Please choose a different password.' };
  }
  return { ok: true };
}

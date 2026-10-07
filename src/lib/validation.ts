import { z } from 'zod';
import { isValidEthiopianPhone } from '@/lib/utils';

/** Validate `data` against a zod schema, returning a discriminated result. */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown):
  | { success: true; data: T }
  | { success: false; message: string } {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, message: parsed.error.issues.map(i => i.message).join('; ') };
}

// NIB Step-5 callback payload. Fields tolerant of string/number from the gateway.
// Bank-defined reference formats aren't pinned down, so these are bounded and
// kept free of control characters / markup rather than strictly alphanumeric
// (rejecting a genuine callback would leave a real payment unsettled).
const bankField = (max: number) => z.string().max(max).regex(/^[^\u0000-\u001F\u007F<>"'`]*$/, 'Invalid characters.');
export const nibCallbackSchema = z.object({
  paidAmount: z.coerce.number().finite().min(0).max(1_000_000_000),
  paidByNumber: bankField(64).optional(),
  txnRef: bankField(128).optional(),
  transactionId: bankField(128).min(1),
  transactionTime: bankField(64).optional(),
  accountNo: bankField(64).optional(),
  token: bankField(8192).optional(),
  Signature: bankField(4096).optional(),
});

export type NibCallbackPayload = z.infer<typeof nibCallbackSchema>;

// ─── Shared server-side field validators ─────────────────────────────────────
// Every Server Action validates its input with these (never trusting the
// client form): type, length, format, allowed characters and numeric range.
// Messages are user-safe — src/lib/errors.ts surfaces the first one.
//
// Output side: React escapes text by default, CSV goes through src/lib/csv.ts,
// rich text through src/lib/sanitize-html.ts, and every query is a Prisma
// parameterized query (no raw SQL anywhere in the app).

/** C0 control characters except tab / LF / CR, plus DEL. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
/** Any line break or control char — for single-line fields. */
const LINE_BREAKS_OR_CONTROL = /[\u0000-\u001F\u007F]/;
const MARKUP = /[<>]/;

/** Treat '' / whitespace-only as "not provided" for optional fields. */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Database identifier (cuid / uuid): opaque, URL-safe, bounded. */
export const zId = z.string({ invalid_type_error: 'Invalid identifier.' })
  .trim()
  .min(1, 'An identifier is required.')
  .max(64, 'Invalid identifier.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid identifier.');

/** Optional identifier: '' / null / undefined → null. */
export const zOptionalId = z.preprocess(emptyToNull, zId.nullable().optional());

/**
 * Length-bounded array. ALWAYS use this instead of `z.array(...)` for input.
 *
 * zod (SNYK-JS-ZOD-20510278, no fixed version) validates EVERY element before
 * applying `.max()`, collecting one issue per bad element — a 2MB request of a
 * million bad items allocates ~300MB. Here the length is checked first and, if
 * it is over the limit, the element schema never runs.
 */
export function zArray<T extends z.ZodTypeAny>(
  item: T,
  { max, min = 0, maxMessage = `At most ${max} items are allowed.`, minMessage }: { max: number; min?: number; maxMessage?: string; minMessage?: string },
) {
  let inner = z.array(item).max(max, maxMessage);
  if (min > 0) inner = inner.min(min, minMessage ?? `At least ${min} item${min === 1 ? ' is' : 's are'} required.`);
  return z
    .custom<unknown>((v) => !Array.isArray(v) || v.length <= max, { message: maxMessage })
    .pipe(inner);
}

/** Bounded list of identifiers (bulk selections). */
export const zIdList = (max = 1000) => zArray(zId, { max, maxMessage: `Select at most ${max} items.` });

type TextOpts = { min?: number; max: number; multiline?: boolean; allowMarkup?: boolean };

/**
 * Plain text. Trimmed; rejects control characters (and line breaks unless
 * multiline) and — by default — `<` / `>`, since these fields are plain text
 * that is never meant to carry markup.
 */
export function zText(label: string, { min = 0, max, multiline = false, allowMarkup = false }: TextOpts) {
  let s = z.string({ invalid_type_error: `${label} must be text.` })
    .trim()
    .max(max, `${label} must be at most ${max} characters.`);
  if (min > 0) s = s.min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
  s = s.refine(v => !(multiline ? CONTROL_CHARS : LINE_BREAKS_OR_CONTROL).test(v), `${label} contains invalid characters.`) as any;
  if (!allowMarkup) s = s.refine(v => !MARKUP.test(v), `${label} must not contain < or > characters.`) as any;
  return s as unknown as z.ZodEffects<z.ZodString, string, string>;
}

/** Optional plain text: '' → null. */
export function zOptionalText(label: string, opts: Omit<TextOpts, 'min'>) {
  return z.preprocess(emptyToNull, zText(label, opts).nullable().optional());
}

/**
 * Person / organization name. Allowlist: letters in any script (incl. Ethiopic),
 * combining marks, digits, spaces and . , ' ’ & ( ) / -
 */
const NAME_CHARS = /^[\p{L}\p{M}\p{N} .,'’&()/-]+$/u;
export function zName(label = 'Name', max = 120) {
  return zText(label, { min: 2, max }).refine(v => NAME_CHARS.test(v), `${label} contains characters that are not allowed.`);
}
export function zOptionalName(label = 'Name', max = 120) {
  return z.preprocess(emptyToNull, zName(label, max).nullable().optional());
}

/** Short code / reference (branch code, section number…): letters, digits, - _ . / */
export function zCode(label = 'Code', max = 32) {
  return zText(label, { min: 1, max }).refine(v => /^[\p{L}\p{N}_./-]+$/u.test(v), `${label} may only contain letters, digits and - _ . /`);
}

export const zEmail = z.string({ invalid_type_error: 'Email must be text.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .email('A valid email is required.');
export const zOptionalEmail = z.preprocess(emptyToNull, zEmail.nullable().optional());

/** Bank account number: digits only, 6–20 long (no letters, spaces or symbols). */
export const zAccountNumber = z.string({ invalid_type_error: 'Account number must be text.' })
  .trim()
  .max(20, 'Account number must be at most 20 digits.')
  .regex(/^[0-9]+$/, 'Account number may contain digits only.')
  .min(6, 'Account number must be at least 6 digits.');
/** Optional account number: '' / null / undefined → null. */
export const zOptionalAccountNumber = z.preprocess(emptyToNull, zAccountNumber.nullable().optional());

/** Ethiopian mobile (09…, 07…, +2519…, 2517…) — stored/normalized by the caller. */
export const zEthiopianPhone = z.string({ invalid_type_error: 'Phone must be text.' })
  .trim()
  .max(20, 'Phone number is too long.')
  .refine(v => /^\+?[0-9 ()-]+$/.test(v), 'Phone number may only contain digits, spaces, + ( ) -')
  .refine(v => isValidEthiopianPhone(v), 'Enter a valid Ethiopian mobile number (e.g. 0911 234 567).');
export const zOptionalEthiopianPhone = z.preprocess(emptyToNull, zEthiopianPhone.nullable().optional());

/** Any phone (e.g. a relative abroad): 7–15 digits, formatting chars allowed. */
export const zPhone = z.string({ invalid_type_error: 'Phone must be text.' })
  .trim()
  .max(20, 'Phone number is too long.')
  .refine(v => /^\+?[0-9 ()-]+$/.test(v), 'Phone number may only contain digits, spaces, + ( ) -')
  .refine(v => { const n = v.replace(/\D/g, '').length; return n >= 7 && n <= 15; }, 'Enter a valid phone number.');
export const zOptionalPhone = z.preprocess(emptyToNull, zPhone.nullable().optional());

/** Money: finite, non-negative, ≤ 1 billion, at most 2 decimals. */
export function zMoney(label = 'Amount', max = 1_000_000_000) {
  return z.coerce.number({ invalid_type_error: `${label} must be a number.` })
    .finite(`${label} must be a number.`)
    .min(0, `${label} cannot be negative.`)
    .max(max, `${label} is too large.`)
    .refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, `${label} can have at most 2 decimal places.`)
    .transform(v => Math.round(v * 100) / 100);
}

/** Integer in [min, max]. */
export function zInt(label: string, min: number, max: number) {
  return z.coerce.number({ invalid_type_error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);
}

/** Percentage 0–100 (up to 2 decimals). */
export const zPercent = (label = 'Percentage') =>
  z.coerce.number({ invalid_type_error: `${label} must be a number.` }).finite().min(0, `${label} cannot be negative.`).max(100, `${label} cannot exceed 100.`);

/** ISO-ish date/datetime string that parses to a real date between 1900 and 2100. */
export function zDateString(label = 'Date') {
  return z.string({ invalid_type_error: `${label} must be a date.` })
    .trim()
    .max(40, `${label} is invalid.`)
    .refine(v => { const d = new Date(v); const y = d.getFullYear(); return !Number.isNaN(d.getTime()) && y >= 1900 && y <= 2100; }, `${label} is not a valid date.`);
}
export const zOptionalDateString = (label = 'Date') => z.preprocess(emptyToNull, zDateString(label).nullable().optional());

/** A date that must not be in the future (birth dates, join dates, incident dates). */
export function zPastDateString(label = 'Date') {
  return zDateString(label).refine(v => new Date(v).getTime() <= Date.now() + 24 * 3600 * 1000, `${label} cannot be in the future.`);
}
export const zOptionalPastDateString = (label = 'Date') => z.preprocess(emptyToNull, zPastDateString(label).nullable().optional());

/**
 * Reference to a file uploaded through /api/upload — which always returns
 * `/uploads/<category>/<name>`. Allowlisting that shape stops `javascript:`,
 * `data:` or off-site URLs from being stored and later rendered as a link,
 * <img> or <iframe> source.
 */
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;
export const zUploadPath = z.string({ invalid_type_error: 'Invalid file reference.' })
  .trim()
  .min(1, 'A file is required.')
  .max(300, 'Invalid file reference.')
  .refine(v => UPLOAD_PATH.test(v) && !v.includes('..'), 'Invalid file reference. Please upload the file again.');
export const zOptionalUploadPath = z.preprocess(emptyToNull, zUploadPath.nullable().optional());

/** Original file name as shown to users. */
export const zFileName = zOptionalText('File name', { max: 255 });

/** Free-text comment / reason / note. */
export const zComment = (label = 'Comment', max = 2000) => zOptionalText(label, { max, multiline: true });
export const zRequiredComment = (label = 'Reason', max = 2000) => zText(label, { min: 3, max, multiline: true });

/** Search box input. */
export const zSearch = z.preprocess(emptyToNull, zText('Search', { max: 100 }).nullable().optional());

/** Page / page size. */
export const zPage = zInt('Page', 1, 100_000).optional();
export const zPageSize = (max = 100) => zInt('Page size', 1, max).optional();

/** Status-style filter restricted to an allowlist ('all' always allowed). */
export function zFilter<T extends string>(values: readonly [T, ...T[]]) {
  return z.preprocess(emptyToNull, z.enum(['all', ...values] as [string, ...string[]]).nullable().optional());
}

/** Serializable date-range filter from the shared DateRangeFilter. */
export const zDateRange = z.object({
  preset: z.enum(['all', 'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year', 'last_30', 'custom']),
  from: zOptionalDateString('From date'),
  to: zOptionalDateString('To date'),
}).optional().nullable();

/**
 * Parse arguments with a schema, throwing the ZodError on failure (Server
 * Actions' `failure()` turns it into a user-safe message). Use for positional
 * arguments: `const [id, reason] = parseArgs([zId, zComment()], [id, reason]);`
 */
export function parseArgs<T extends readonly z.ZodTypeAny[]>(schemas: T, values: unknown[]): { [K in keyof T]: z.infer<T[K]> } {
  return z.tuple(schemas as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]]).parse(values) as any;
}

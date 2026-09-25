export class AccessDeniedError extends Error {
  constructor(message: string = "Access Denied: You do not have the required permissions.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor(message: string = "Not authenticated") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * A validation problem the user can fix (e.g. missing/invalid input). Carry a
 * user-safe message and it will be surfaced verbatim.
 */
export class ValidationError extends Error {
  constructor(message: string = "Required information is missing or invalid.") {
    super(message);
    this.name = "ValidationError";
  }
}

// ─── User-facing error framework ─────────────────────────────────────────────
// Maps any thrown value to a standardized, friendly message. Raw system,
// backend, Prisma, or stack-trace text is NEVER surfaced — those are logged
// internally and replaced with an understandable message + a stable code.

export type UserErrorCode =
  | 'AUTH'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NETWORK'
  | 'SERVER'
  | 'UNKNOWN';

export interface UserError {
  code: UserErrorCode;
  title: string;
  message: string;
}

const SESSION_PATTERNS = [
  'not authenticated', 'no session', 'unauthorized', 'unauthenticated',
  'jwt expired', 'invalid session', 'session expired', 'failed to find server action',
];

/** "emergencyContactPhone" → "Emergency contact phone". */
function humanizeField(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function getName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) return String((error as any).name ?? '');
  return '';
}
function getMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String((error as any).message ?? '');
  return '';
}

/** Convert any thrown value into a standardized, user-safe error descriptor. */
export function toUserError(error: unknown): UserError {
  const name = getName(error);
  const msg = getMessage(error);
  const lower = `${name} ${msg}`.toLowerCase();

  if (name === 'NotAuthenticatedError' || SESSION_PATTERNS.some(p => lower.includes(p))) {
    return { code: 'AUTH', title: 'Session ended', message: 'Your session has ended. Please sign in again to continue.' };
  }
  if (name === 'AccessDeniedError') {
    return { code: 'FORBIDDEN', title: 'Access denied', message: 'You do not have access to this resource or action. If you believe this is a mistake, contact your administrator.' };
  }
  if (name === 'NotFoundError') {
    return { code: 'NOT_FOUND', title: 'Not found', message: "We couldn't find what you were looking for. It may have been moved or removed." };
  }
  if (name === 'ValidationError') {
    // Author-written, user-safe — surface it (fall back to generic if empty).
    return { code: 'VALIDATION', title: 'Check your input', message: msg || 'Required information is missing or invalid. Please review and try again.' };
  }
  if (name === 'ZodError') {
    // Schema messages are author-written (see src/lib/validation.ts) and never
    // contain internal details, so the first one is safe — and far more useful
    // than a generic message now that fields have strict format/length rules.
    const issue = (error as any)?.issues?.[0];
    const field = Array.isArray(issue?.path) ? issue.path.filter((p: unknown) => typeof p === 'string').pop() : undefined;
    const detail = typeof issue?.message === 'string' && issue.message.length <= 200
      ? (issue.code === 'invalid_type' || /^(Required|Expected|Invalid input)/.test(issue.message)) && field
        ? `${humanizeField(field)}: ${issue.message}`
        : issue.message
      : null;
    return { code: 'VALIDATION', title: 'Check your input', message: detail || 'Required information is missing or invalid. Please complete the required fields and try again.' };
  }
  if (name.startsWith('PrismaClient') || lower.includes('unique constraint') || lower.includes('foreign key')) {
    if (lower.includes('unique constraint')) {
      return { code: 'CONFLICT', title: 'Already exists', message: 'A record with these details already exists. Please review your input and try again.' };
    }
    return { code: 'SERVER', title: 'Could not save changes', message: "We couldn't save your changes right now. Please try again in a moment." };
  }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('timeout') || lower.includes('econnrefused')) {
    return { code: 'NETWORK', title: 'Connection problem', message: "We couldn't reach the server. Check your connection and try again." };
  }
  return { code: 'UNKNOWN', title: 'Something went wrong', message: 'Something went wrong. Please try again, and contact your administrator if the problem continues.' };
}

/**
 * Log the real, detailed error internally (server console / future sink) while
 * the UI only ever sees the friendly message from {@link toUserError}.
 */
export function logError(error: unknown, context?: string): void {
  const prefix = context ? `[error:${context}]` : '[error]';
  try {
    if (error instanceof Error) {
      console.error(prefix, error.name, '-', error.message, '\n', error.stack);
    } else {
      console.error(prefix, error);
    }
  } catch {
    // Never let logging throw.
  }
}

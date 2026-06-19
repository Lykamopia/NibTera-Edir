/**
 * Server-safe helpers for server-action return values. Unlike error-handler.ts
 * (which is client-only — it shows toasts and calls signOut), these run on the
 * server and produce a plain serializable result the client can react to.
 *
 * `failure()` NEVER leaks a raw error message: it logs the real error internally
 * and returns a standardized, user-friendly message + stable code.
 */

import { toUserError, logError } from '@/lib/errors';

export type ActionFailure = { success: false; error: string; code?: string };

export function failure(error: unknown, context?: string): ActionFailure {
  logError(error, context);
  const ue = toUserError(error);
  return { success: false, error: ue.message, code: ue.code };
}

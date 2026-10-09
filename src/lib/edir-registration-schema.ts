import { z } from 'zod';
import {
  zId, zName, zEmail, zEthiopianPhone, zOptionalText, zText,
  zOptionalUploadPath, zOptionalAccountNumber,
} from '@/lib/validation';

/**
 * Edir registration rules — shared by the wizard (per-step, as the user types)
 * and submitEdirRegistration (authoritative). Keeping one schema means the
 * client can never let through what the server will reject, or vice versa.
 */
export const edirRegistrationFields = {
  name: zName('Edir name', 160),
  description: zOptionalText('Description', { max: 2000, multiline: true }),
  accountNumber: zOptionalAccountNumber,
  branchId: zId,
  contactPersonName: zName('Chairperson name'),
  contactMobile: zEthiopianPhone,
  contactEmail: zEmail,
  address: zText('Edir address', { min: 3, max: 300, multiline: true }),
  contactAddress: zOptionalText('Contact address', { max: 300, multiline: true }),
  agreementDocUrl: zOptionalUploadPath,
  adminName: zName('Managing administrator name'),
  adminEmail: zEmail,
  adminPhone: zEthiopianPhone,
} as const;

export type EdirRegistrationField = keyof typeof edirRegistrationFields;

export const edirRegistrationSchema = z.object(edirRegistrationFields);

/** Which fields each wizard step owns (the review step owns none). */
export const EDIR_REGISTRATION_STEP_FIELDS: Record<string, readonly EdirRegistrationField[]> = {
  details: ['name', 'description', 'accountNumber'],
  location: ['branchId'],
  contact: ['contactPersonName', 'contactMobile', 'contactEmail'],
  address: ['address', 'contactAddress'],
  documents: ['agreementDocUrl'],
  admin: ['adminName', 'adminEmail', 'adminPhone'],
  review: [],
};

/** First error message for one field, or null when the value is valid. */
export function edirRegistrationFieldError(field: EdirRegistrationField, value: unknown): string | null {
  const res = edirRegistrationFields[field].safeParse(value ?? '');
  if (res.success) return null;
  if (field === 'branchId') return 'Please select a branch.';
  return res.error.issues[0]?.message ?? 'Invalid value.';
}

/** Errors for the given fields, keyed by field (valid fields omitted). */
export function edirRegistrationErrors(
  values: Partial<Record<EdirRegistrationField, unknown>>,
  fields: readonly EdirRegistrationField[],
): Partial<Record<EdirRegistrationField, string>> {
  const out: Partial<Record<EdirRegistrationField, string>> = {};
  for (const f of fields) {
    const msg = edirRegistrationFieldError(f, values[f]);
    if (msg) out[f] = msg;
  }
  return out;
}

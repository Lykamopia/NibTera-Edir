import { z } from 'zod';

/** Validate `data` against a zod schema, returning a discriminated result. */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown):
  | { success: true; data: T }
  | { success: false; message: string } {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, message: parsed.error.issues.map(i => i.message).join('; ') };
}

// NIB Step-5 callback payload. Fields tolerant of string/number from the gateway.
export const nibCallbackSchema = z.object({
  paidAmount: z.coerce.number(),
  paidByNumber: z.string().optional(),
  txnRef: z.string().optional(),
  transactionId: z.string(),
  transactionTime: z.string().optional(),
  accountNo: z.string().optional(),
  token: z.string().optional(),
  Signature: z.string().optional(),
});

export type NibCallbackPayload = z.infer<typeof nibCallbackSchema>;

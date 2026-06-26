/**
 * Friendly, user-facing labels for the PaymentLog status enum, shared by the
 * payment-log table/receipt UI, the CSV export, and any other surface so the
 * vocabulary stays consistent. (The underlying enum is PENDING|SUCCESS|PARTIAL|
 * FAILED|VOID; "Overdue" is a contribution/member state, not a transaction
 * status, so it is shown via the membership/contribution row instead.)
 */

export const PAYMENT_LOG_STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'Paid',
  PARTIAL: 'Partially Paid',
  PENDING: 'Pending',
  FAILED: 'Failed',
  VOID: 'Reversed',
};

export function paymentLogStatusLabel(status: string): string {
  return PAYMENT_LOG_STATUS_LABEL[status] ?? status;
}

/** Tailwind tone classes for each friendly status (matches the brand token set). */
export const PAYMENT_LOG_STATUS_TONE: Record<string, string> = {
  SUCCESS: 'border-success/20 bg-success/10 text-success',
  PARTIAL: 'border-warning/20 bg-warning/10 text-warning',
  PENDING: 'border-info/20 bg-info/10 text-info',
  FAILED: 'border-destructive/20 bg-destructive/10 text-destructive',
  VOID: 'bg-muted text-muted-foreground',
};

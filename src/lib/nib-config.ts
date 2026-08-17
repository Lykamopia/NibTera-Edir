const sanitizeValue = (val: string | undefined) => {
  if (!val) return undefined;
  return val.replace(/['"`,]/g, '').trim();
};

export const NIB_CONFIG = {
  VALIDATE_TOKEN_URL: sanitizeValue(process.env.NIB_VALIDATE_TOKEN_URL) || 'http://172.24.47.138:8085/api/Authenticate/Validate',
  PAYMENT_URL: sanitizeValue(process.env.NIB_PAYMENT_URL) || 'http://172.24.47.138:8085/api/Authenticate/Payment',
  CHECK_STATUS_URL: sanitizeValue(process.env.NIB_CHECK_STATUS_URL) || 'http://172.24.47.138:8085/api/Check/status',
  ACCOUNT_NO: sanitizeValue(process.env.NIB_ACCOUNT_NO) || 'YOUR_ACCOUNT_NO',
  COMPANY_NAME: sanitizeValue(process.env.NIB_COMPANY_NAME) || 'Demo Edir',
  NIB_PAYMENT_KEY: sanitizeValue(process.env.NIB_PAYMENT_KEY) || 'YOUR_PAYMENT_KEY',
  CALLBACK_URL: sanitizeValue(process.env.NIB_CALLBACK_URL) || 'http://localhost:3008/api/nib-callback',
  MOCK_TOKEN: sanitizeValue(process.env.NIB_MOCK_TOKEN) || null,

  // ── Official bank receipt (see lib/nib-receipt.ts) ──
  // No defaults: when either URL is unset the feature reports "not configured"
  // rather than calling a wrong host.
  FT_DETAILS_URL: sanitizeValue(process.env.NIB_FT_DETAILS_URL) || null,
  FT_DETAILS_USERNAME: sanitizeValue(process.env.NIB_FT_DETAILS_USERNAME) || null,
  FT_DETAILS_PASSWORD: process.env.NIB_FT_DETAILS_PASSWORD?.trim() || null,
  INVOICE_URL: sanitizeValue(process.env.NIB_INVOICE_URL) || null,
  INVOICE_API_KEY: process.env.NIB_INVOICE_API_KEY?.trim() || null,
};

export interface NibValidateResponse {
  status: string;
  phone: string;
  message?: string;
}

export interface NibPaymentResponse {
  status: string;
  token: string;
  message?: string;
}

/**
 * Client-side payment-receipt PDF generator (jsPDF). Renders the SAME
 * document-style receipt the on-screen preview shows: header (Edir + receipt
 * no/date), Total Paid banner, "Transaction Information" (payer name/account,
 * member, Edir + Edir account), a bordered "Transaction Details" table with the
 * per-line breakdown, the amount in words, and the payment meta rows.
 * Import from a client component and call downloadPaymentReceiptPdf(...).
 */

import { jsPDF } from 'jspdf';

export interface PaymentReceiptData {
  receiptNo: string;
  edirName: string;
  memberName: string;
  memberCode?: string | null;
  amount: number;
  currency?: string;
  dateText: string;        // already-formatted payment date & time
  method: string;
  reference: string;       // transaction reference (our id)
  hashId?: string | null;  // bank reference / hash, when present
  status: string;          // friendly status (Paid / Pending / …)
  // ── Transaction information (mirrors the preview) ──
  payerName?: string | null;
  payerAccount?: string | null;  // payer's BANK ACCOUNT (never the phone)
  payerPhone?: string | null;
  edirAccount?: string | null;   // Edir's configured receiving account
  breakdown?: { label: string; amount: number }[];
  periodText?: string | null;    // contribution period covered
  channel?: string | null;       // payment channel / verification type
}

const INK: [number, number, number] = [23, 23, 23];
const MUTED: [number, number, number] = [120, 120, 120];
const BRAND: [number, number, number] = [180, 134, 11]; // NIB honey/gold
const LINE: [number, number, number] = [225, 225, 225];

// ── Amount in words (shared with the on-screen receipt) ──────────────────────
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', ' thousand', ' million', ' billion', ' trillion'];

function underThousand(n: number): string {
  let out = '';
  if (n >= 100) { out += `${ONES[Math.floor(n / 100)]} hundred`; n %= 100; if (n) out += ' '; }
  if (n >= 20) { out += TENS[Math.floor(n / 10)]; if (n % 10) out += `-${ONES[n % 10]}`; }
  else if (n > 0) { out += ONES[n]; }
  return out;
}

function intToWords(n: number): string {
  if (n === 0) return 'zero';
  const groups: number[] = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  let words = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    words += `${underThousand(groups[i])}${SCALES[i]}`;
    if (i > 0) words += ' ';
  }
  return words.trim();
}

export function amountInWords(amount: number, currency: string): string {
  const major = currency === 'ETB' ? 'Birr' : currency;
  const rounded = Math.round((Number(amount) || 0) * 100);
  const whole = Math.floor(rounded / 100);
  const cents = rounded % 100;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  let out = `${cap(intToWords(whole))} ${major}`;
  if (cents > 0) out += ` and ${intToWords(cents)} cent${cents === 1 ? '' : 's'}`;
  return `${out}.`;
}

const num = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build and trigger download of the document-style A4 PDF receipt. */
export function downloadPaymentReceiptPdf(d: PaymentReceiptData): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  const right = W - M;
  const cur = d.currency || 'ETB';
  const money = (n: number) => `${cur} ${num(n)}`;

  // ── Header: Edir name + receipt no / date, brand rule ─────────────────────
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(d.edirName || 'Edir', M, 60);
  doc.setTextColor(...BRAND);
  doc.setFontSize(9);
  doc.text('PAYMENT RECEIPT', M, 76);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('RECEIPT NO.', right, 52, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(d.receiptNo, right, 64, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('DATE', right, 78, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(d.dateText, right, 90, { align: 'right' });

  doc.setDrawColor(...BRAND);
  doc.setLineWidth(1.5);
  doc.line(M, 100, right, 100);

  // ── Total Paid banner + status ─────────────────────────────────────────────
  let y = 118;
  doc.setFillColor(248, 246, 240);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.roundedRect(M, y, right - M, 52, 6, 6, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('TOTAL PAID', M + 14, y + 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(money(d.amount), M + 14, y + 40);
  doc.setFontSize(10);
  doc.setTextColor(...BRAND);
  doc.text((d.status || '').toUpperCase(), right - 14, y + 30, { align: 'right' });
  y += 72;

  // ── Section helper ────────────────────────────────────────────────────────
  const sectionTitle = (title: string) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    doc.line(M, y, M + 130, y);
    doc.line(right - 130, y, right, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND);
    doc.text(title.toUpperCase(), W / 2, y + 3, { align: 'center' });
    y += 18;
  };

  const row = (label: string, value: string, mono = false) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label, M, y);
    doc.setFont(mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(mono ? 8.5 : 9.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(value || '—', right - (M + 170)) as string[];
    doc.text(lines, right, y, { align: 'right' });
    y += 16 + (lines.length - 1) * 11;
  };

  // ── Transaction Information ───────────────────────────────────────────────
  sectionTitle('Transaction Information');
  row('Payer Name', d.payerName || d.memberName || '—');
  row('Payer Account No.', d.payerAccount || '—', true);
  if (d.payerPhone) row('Payer Phone', d.payerPhone, true);
  row('Member (Beneficiary)', d.memberName || '—');
  if (d.memberCode) row('Member ID', d.memberCode, true);
  row('Received By (Edir)', d.edirName || '—');
  row('Edir Account No.', d.edirAccount || '—', true);
  y += 6;

  // ── Transaction Details table ─────────────────────────────────────────────
  sectionTitle('Transaction Details');
  const tableX = M;
  const tableW = right - M;
  const col2 = M + tableW * 0.48; // payment date column
  const headH = 18;
  doc.setFillColor(243, 243, 243);
  doc.setDrawColor(...LINE);
  doc.rect(tableX, y, tableW, headH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('TXN REFERENCE', tableX + 8, y + 12);
  doc.text('PAYMENT DATE', col2 + 8, y + 12);
  doc.text('AMOUNT', right - 8, y + 12, { align: 'right' });
  y += headH;

  const bodyRow = (c1: string, c2: string, c3: string, bold = false, fill = false) => {
    const h = 18;
    if (fill) { doc.setFillColor(248, 246, 240); doc.rect(tableX, y, tableW, h, 'FD'); }
    else doc.rect(tableX, y, tableW, h, 'D');
    doc.setFont(bold ? 'helvetica' : 'helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(c1, col2 - tableX - 14)[0] ?? '', tableX + 8, y + 12);
    doc.text(c2, col2 + 8, y + 12);
    doc.text(c3, right - 8, y + 12, { align: 'right' });
    y += h;
  };

  bodyRow(d.reference || '—', d.dateText, money(d.amount));
  for (const b of d.breakdown ?? []) {
    if (b.amount > 0) bodyRow(`  ${b.label}`, '', money(b.amount));
  }
  bodyRow('Total Paid Amount', '', money(d.amount), true, true);
  y += 12;

  // ── Meta rows ─────────────────────────────────────────────────────────────
  row('Total amount in words', amountInWords(d.amount, cur));
  row('Payment Mode', (d.method || '—').replace(/_/g, ' '));
  if (d.periodText) row('Contribution Period', d.periodText);
  row('Payment Channel', d.channel || (d.method || '—').replace(/_/g, ' '));
  row('Payment Status', d.status || '—');
  if (d.hashId) row('Bank Reference', d.hashId, true);

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setDrawColor(...LINE);
  doc.line(M, y + 6, right, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`Generated ${new Date().toLocaleString()}`, M, y + 22);
  doc.text(`Thank you for your payment · ${d.edirName || 'Edir'}`, W / 2, y + 22, { align: 'center' });
  doc.text('System-generated receipt.', right, y + 22, { align: 'right' });

  doc.save(`${d.receiptNo}.pdf`);
}

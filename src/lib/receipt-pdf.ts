/**
 * Client-side payment-receipt PDF generator (jsPDF). Produces a compact, branded,
 * downloadable receipt carrying the canonical fields: receipt number, member,
 * amount, date, method, transaction reference / hash, and payment status.
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
}

const INK: [number, number, number] = [23, 23, 23];
const MUTED: [number, number, number] = [120, 120, 120];
const BRAND: [number, number, number] = [180, 134, 11]; // NIB honey/gold
const LINE: [number, number, number] = [225, 225, 225];

/** Build and trigger download of a one-page A5 PDF receipt. */
export function downloadPaymentReceiptPdf(d: PaymentReceiptData): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a5' });
  const W = doc.internal.pageSize.getWidth();
  const M = 36;
  const right = W - M;

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(d.edirName || 'Edir', W / 2, 56, { align: 'center' });

  doc.setTextColor(...BRAND);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('PAYMENT RECEIPT', W / 2, 74, { align: 'center' });

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.line(M, 90, right, 90);

  // ── Receipt no + date ───────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text('RECEIPT NO.', M, 108);
  doc.text('DATE', right, 108, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(d.receiptNo, M, 122);
  doc.text(d.dateText, right, 122, { align: 'right' });

  // ── Amount hero ─────────────────────────────────────────────────────────
  const amountText = `${(d.currency || 'ETB')} ${Number(d.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text('AMOUNT PAID', W / 2, 154, { align: 'center' });
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(amountText, W / 2, 180, { align: 'center' });

  doc.setDrawColor(...LINE);
  doc.line(M, 200, right, 200);

  // ── Detail rows ─────────────────────────────────────────────────────────
  let y = 224;
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    // Wrap long values (references/hashes) so they never overflow the page.
    const maxValueWidth = right - (M + 130);
    const lines = doc.splitTextToSize(value || '—', maxValueWidth) as string[];
    doc.text(lines, right, y, { align: 'right' });
    y += 18 + (lines.length - 1) * 12;
  };

  row('Member Name', d.memberName || '—');
  if (d.memberCode) row('Member ID', d.memberCode);
  row('Payment Method', d.method || '—');
  row('Payment Status', d.status || '—');
  row('Transaction Reference', d.reference || '—');
  if (d.hashId) row('Hash / Bank Reference', d.hashId);

  // ── Footer ──────────────────────────────────────────────────────────────
  doc.setDrawColor(...LINE);
  doc.line(M, y + 6, right, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`Generated ${new Date().toLocaleString()}`, M, y + 22);
  doc.text('This is a system-generated receipt.', right, y + 22, { align: 'right' });

  doc.save(`${d.receiptNo}.pdf`);
}

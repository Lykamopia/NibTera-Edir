/**
 * Client-side payment-receipt PDF generator (jsPDF). Renders the SAME
 * document-style receipt the on-screen preview shows: header (Edir + receipt
 * no/date), a Total Paid banner with the amount in words, side-by-side
 * "Paid By" / "Paid To" panels, a bordered "Transaction Details" table with the
 * per-line breakdown, and a references grid.
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
const TINT: [number, number, number] = [250, 247, 240];  // light brand wash
const STRIP: [number, number, number] = [246, 240, 229]; // panel title strip

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
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const right = W - M;
  const cur = d.currency || 'ETB';
  const money = (n: number) => `${cur} ${num(n)}`;
  const methodText = (d.method || '—').replace(/_/g, ' ');

  // ── Header: Edir name + receipt no / date, brand rule ─────────────────────
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(d.edirName || 'Edir', M, 62);
  doc.setTextColor(...BRAND);
  doc.setFontSize(8.5);
  doc.text('OFFICIAL PAYMENT RECEIPT', M, 78);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('RECEIPT NO.', right, 50, { align: 'right' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(d.receiptNo, right, 62, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('DATE', right, 78, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(d.dateText, right, 90, { align: 'right' });

  doc.setDrawColor(...BRAND);
  doc.setLineWidth(1.5);
  doc.line(M, 100, right, 100);

  // ── Total Paid banner: amount, amount-in-words, status ────────────────────
  let y = 116;
  const bannerH = 66;
  doc.setFillColor(...TINT);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.roundedRect(M, y, right - M, bannerH, 6, 6, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('TOTAL PAID', M + 16, y + 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(money(d.amount), M + 16, y + 38);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const wordsLine = doc.splitTextToSize(amountInWords(d.amount, cur), right - M - 160)[0] ?? '';
  doc.text(wordsLine, M + 16, y + 54);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND);
  doc.text((d.status || '').toUpperCase(), right - 16, y + 36, { align: 'right' });
  y += bannerH + 20;

  // ── Paid By / Paid To panels ───────────────────────────────────────────────
  type PanelRow = { label: string; value: string; mono?: boolean };
  const panelGap = 14;
  const panelW = (right - M - panelGap) / 2;
  const stripH = 20;
  const valueWidth = panelW - 24;

  const measureRow = (r: PanelRow): { lines: string[]; h: number } => {
    doc.setFont(r.mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(r.mono ? 8.5 : 9);
    const lines = doc.splitTextToSize(r.value || '—', valueWidth) as string[];
    return { lines, h: 26 + (lines.length - 1) * 10 };
  };

  const drawPanel = (x: number, top: number, title: string, rows: PanelRow[], height: number) => {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, top, panelW, height, 5, 5, 'D');
    doc.setFillColor(...STRIP);
    doc.rect(x + 0.5, top + 0.5, panelW - 1, stripH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND);
    doc.text(title.toUpperCase(), x + 12, top + 13);
    let yy = top + stripH + 16;
    for (const r of rows) {
      const { lines } = measureRow(r);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUTED);
      doc.text(r.label.toUpperCase(), x + 12, yy - 8);
      doc.setFont(r.mono ? 'courier' : 'helvetica', 'bold');
      doc.setFontSize(r.mono ? 8.5 : 9);
      doc.setTextColor(...INK);
      doc.text(lines, x + 12, yy + 2);
      yy += measureRow(r).h;
    }
  };

  const paidByRows: PanelRow[] = [
    { label: 'Payer Name', value: d.payerName || d.memberName || '—' },
    { label: 'Payer Account No.', value: d.payerAccount || '—', mono: true },
    ...(d.payerPhone ? [{ label: 'Payer Phone', value: d.payerPhone, mono: true }] : []),
    { label: 'Member (Beneficiary)', value: d.memberName || '—' },
    { label: 'Member ID', value: d.memberCode || '—', mono: true },
  ];
  const paidToRows: PanelRow[] = [
    { label: 'Received By (Edir)', value: d.edirName || '—' },
    { label: 'Edir Account No.', value: d.edirAccount || '—', mono: true },
    { label: 'Payment Mode', value: methodText },
    { label: 'Payment Channel', value: d.channel || methodText },
  ];

  const panelBodyH = (rows: PanelRow[]) => rows.reduce((acc, r) => acc + measureRow(r).h, 0);
  const panelH = Math.max(panelBodyH(paidByRows), panelBodyH(paidToRows)) + stripH + 14;
  drawPanel(M, y, 'Paid By', paidByRows, panelH);
  drawPanel(M + panelW + panelGap, y, 'Paid To', paidToRows, panelH);
  y += panelH + 22;

  // ── Transaction Details table ─────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text('TRANSACTION DETAILS', M, y);
  y += 8;

  const tableX = M;
  const tableW = right - M;
  const colRef = tableX + tableW * 0.34;  // reference column
  const colDate = tableX + tableW * 0.62; // date column
  const headH = 20;
  doc.setFillColor(243, 243, 243);
  doc.setDrawColor(...LINE);
  doc.rect(tableX, y, tableW, headH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('DESCRIPTION', tableX + 10, y + 13);
  doc.text('REFERENCE', colRef + 10, y + 13);
  doc.text('DATE', colDate + 10, y + 13);
  doc.text('AMOUNT', right - 10, y + 13, { align: 'right' });
  y += headH;

  // Main line: description, mono reference, date, amount.
  const mainH = 24;
  doc.rect(tableX, y, tableW, mainH, 'D');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(`Payment — ${methodText}`, colRef - tableX - 20)[0] ?? '', tableX + 10, y + 15);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.text(doc.splitTextToSize(d.reference || '—', colDate - colRef - 20)[0] ?? '', colRef + 10, y + 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(doc.splitTextToSize(d.dateText, right - colDate - 90)[0] ?? '', colDate + 10, y + 15);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(money(d.amount), right - 10, y + 15, { align: 'right' });
  y += mainH;

  // Breakdown lines.
  for (const b of d.breakdown ?? []) {
    if (b.amount <= 0) continue;
    const h = 19;
    doc.rect(tableX, y, tableW, h, 'D');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(b.label, tableX + 22, y + 13);
    doc.text(money(b.amount), right - 10, y + 13, { align: 'right' });
    y += h;
  }

  // Total line.
  const totalH = 26;
  doc.setFillColor(...TINT);
  doc.rect(tableX, y, tableW, totalH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text('Total Paid Amount', tableX + 10, y + 17);
  doc.setFontSize(10.5);
  doc.text(money(d.amount), right - 10, y + 17, { align: 'right' });
  y += totalH + 22;

  // ── References grid (2 columns of stacked label/value cells) ──────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text('REFERENCES', M, y);
  y += 8;

  const refItems: PanelRow[] = [
    { label: 'Contribution Period', value: d.periodText || '—' },
    { label: 'Payment Status', value: d.status || '—' },
    { label: 'Customer Note', value: d.memberCode || d.reference || '—', mono: true },
    { label: 'Bank Reference', value: d.hashId || '—', mono: true },
  ];
  const cellH = 30;
  const refRows = Math.ceil(refItems.length / 2);
  const gridH = refRows * cellH;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.roundedRect(M, y, tableW, gridH, 5, 5, 'D');
  doc.line(M + tableW / 2, y, M + tableW / 2, y + gridH); // column divider
  for (let r = 1; r < refRows; r++) doc.line(M, y + r * cellH, right, y + r * cellH);
  refItems.forEach((item, i) => {
    const cx = M + (i % 2) * (tableW / 2) + 12;
    const cy = y + Math.floor(i / 2) * cellH;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(item.label.toUpperCase(), cx, cy + 12);
    doc.setFont(item.mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(item.mono ? 8.5 : 9);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(item.value || '—', tableW / 2 - 24)[0] ?? '', cx, cy + 23);
  });
  y += gridH;

  // ── Footer (pinned toward the bottom of the page) ─────────────────────────
  const fy = Math.max(y + 30, H - 80);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.8);
  doc.line(M, fy, right, fy);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('This is a system-generated receipt and requires no signature.', W / 2, fy + 14, { align: 'center' });
  doc.text(`Generated ${new Date().toLocaleString()}`, M, fy + 28);
  doc.text(`Thank you for your payment · ${d.edirName || 'Edir'}`, right, fy + 28, { align: 'right' });

  doc.save(`${d.receiptNo}.pdf`);
}

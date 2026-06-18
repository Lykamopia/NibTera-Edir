// Professional, branded RM Report PDF. Pagination is fully content-driven: the
// report flows section after section and only breaks to a new page when the
// content actually overflows — a small report yields a single page, a large one
// spills across as many pages as needed. Every page carries the same chrome
// (rounded border, masthead with logo + "Nib International Bank", footer, and the
// bee branding mark with the "Committed To Service Excellence!" slogan), applied
// in a single final pass so it stays identical regardless of how many pages the
// content produced. Built with jsPDF + jspdf-autotable, imported dynamically so
// they only load in the browser.

import type { jsPDF } from 'jspdf';
import type { RMPrintReport, RMPrintStatus } from '@/app/actions/rm-report';

// ── Brand palette ─────────────────────────────────────────────────────────────
const BROWN: [number, number, number] = [122, 78, 38];
const BROWN_DARK: [number, number, number] = [80, 52, 28];
const HONEY: [number, number, number] = [214, 158, 46];
const HONEY_LIGHT: [number, number, number] = [250, 244, 228];
const INK: [number, number, number] = [45, 38, 32];
const MUTE: [number, number, number] = [125, 115, 104];
const WHITE: [number, number, number] = [255, 255, 255];
const PINK: [number, number, number] = [250, 224, 221];

const STATUS_TEXT: Record<RMPrintStatus, [number, number, number]> = {
  'Progressive': [21, 115, 71],
  'Best Performing': [13, 92, 55],
  'Decrement': [176, 52, 40],
  'Poor Performing': [150, 28, 28],
  'Appreciated': [150, 100, 14],
  'No Change': [120, 110, 100],
  '': [120, 110, 100],
};

// ── Geometry (mm, A4 portrait) ───────────────────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const BORDER = 6;
const MARGIN_X = 12;
const HEADER_H = 36;                 // reserved for the repeating masthead
const CONTENT_TOP = HEADER_H + 4;    // first usable y for flowing content

const FOOTER_Y = PAGE_H - 9;         // footer text baseline
const FOOTER_LINE_Y = FOOTER_Y - 2.5;
const SLOGAN_BASELINE_Y = 281.5;     // slogan sits just above the footer line
const BEE_BOTTOM_Y = 277;            // bee mark sits directly above the slogan
const BEE_MAX_H = 12;
const BEE_MAX_W = 26;
// Content must never reach the bottom branding cluster, so it stops above it.
const CONTENT_BOTTOM = BEE_BOTTOM_Y - BEE_MAX_H - 3; // ≈ 262

// Brand constants (template boilerplate, not report data)
const BANK_NAME = 'Nib International Bank';
const SLOGAN = 'Committed To Service Excellence!';
const VISION = 'To be a Trusted Partner for Economic Empowerment';
const MISSION = "To provide Customer Centric and Adaptive Banking Services through Enhanced Employee Engagement and Appropriate Technology to Maximize Stakeholders' Value";
const VALUE = 'Customer Centricity, Professionalism, Value for Money, Integrity, Collaboration, Diversity';

type Img = { dataUrl: string; w: number; h: number };

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMoney(n: number): string {
  const r = Math.round(n);
  return r < 0 ? `(${Math.abs(r).toLocaleString('en-US')})` : r.toLocaleString('en-US');
}

async function loadImage(path: string): Promise<Img | null> {
  try {
    const res = await fetch(encodeURI(path));
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const dims: { width: number; height: number } = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => resolve({ width: 1, height: 1 });
      img.src = dataUrl;
    });
    return { dataUrl, w: dims.width, h: dims.height };
  } catch {
    return null;
  }
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Main entry ─────────────────────────────────────────────────────────────────
let doc: jsPDF; // module-scoped within a single generation call

export async function generateRMReportPdf(data: RMPrintReport, opts?: { generatedBy?: string | null }) {
  const { jsPDF: JsPDFCtor } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const [logo, bee] = await Promise.all([loadImage('/Logo.png'), loadImage('/bee flying.png')]);

  doc = new JsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const monthName = data.monthName;

  // ── Flowing content cursor ──────────────────────────────────────────────────
  // Everything is laid out top-to-bottom from CONTENT_TOP; sections continue on
  // the current page when there is room and break to a new page only when needed.
  let y = CONTENT_TOP;

  // ── Section: KPI listing (left) + Vision / Mission / Value (right) ──────────
  y = drawIntro(data, y);

  // ── Section: branch variation — deviations & reasons ────────────────────────
  y = sectionTitle(y + 5, 'BRANCH VARIATION — DEVIATION & REASONS');
  const devBody = data.deviations.map((d, i) => [String(i + 1), d.branchName, fmtMoney(d.deviation), d.reason || '—']);
  autoTable(doc, {
    ...tableOpts(y),
    head: [['Sr. No.', 'Branches', 'Deviation', 'Reason for Variation']],
    body: devBody.length > 0 ? devBody : [['', '', '', 'No net deposit outflows recorded for the reporting date.']],
    columnStyles: {
      0: { halign: 'center', cellWidth: 14 },
      1: { cellWidth: 36, fontStyle: 'bold' },
      2: { halign: 'right', cellWidth: 26 },
      3: { cellWidth: 'auto' },
    },
    didParseCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 2 && String(d.cell.raw).includes('(')) {
        d.cell.styles.textColor = STATUS_TEXT.Decrement; d.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY;

  // ── Section: daily deposit mobilized + management summary ────────────────────
  y = sectionTitle(y + 8, 'DAILY DEPOSIT MOBILIZED');
  autoTable(doc, {
    ...tableOpts(y),
    head: [['Sr. No.', 'Branches', 'Daily Deposit Mobilized', 'Reason for Variation']],
    body: data.branchDaily.map((b, i) => [String(i + 1), b.branchName, fmtMoney(b.dailyDeposit), b.reason || '']),
    foot: [['', data.scopeLabel, fmtMoney(data.districtDailyTotal), '']],
    columnStyles: {
      0: { halign: 'center', cellWidth: 14 },
      1: { cellWidth: 40, fontStyle: 'bold' },
      2: { halign: 'right', cellWidth: 34 },
      3: { cellWidth: 'auto' },
    },
    didParseCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 2 && String(d.cell.raw).includes('(')) {
        d.cell.styles.textColor = STATUS_TEXT.Decrement;
      }
      if (d.section === 'foot' && d.column.index === 2) d.cell.styles.halign = 'right';
    },
  });
  y = (doc as any).lastAutoTable.finalY;

  // Management summary
  let sy = ensureSpace(y + 8, 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...HONEY);
  doc.text('Good Evening All', PAGE_W / 2, sy, { align: 'center' });
  sy += 7;

  const n = data.branchDaily.length;
  const bestEnd = data.bestCount;
  const goodEnd = data.bestCount + data.goodCount;
  const summary = [
    `After analysing today's deposit performance, branches ranked 1 to ${bestEnd} are recognised as Best Performers of the Day.`,
    `Branches ranked ${bestEnd + 1} to ${goodEnd} are recognised as Good Performers of the Day.`,
    `The remaining branches [${goodEnd + 1} to ${n}] are identified as low performers and require focused support and development.`,
    `All branch staff and managers are encouraged to learn from the best-performing branches and adopt similar strategies to lift performance across the board.`,
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
  for (const para of summary) {
    const lines = doc.splitTextToSize(para, PAGE_W - 2 * MARGIN_X - 10);
    sy = ensureSpace(sy, lines.length * 4.6 + 3);
    doc.text(lines, PAGE_W / 2, sy, { align: 'center' });
    sy += lines.length * 4.6 + 2.5;
  }
  sy = ensureSpace(sy, 8);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...HONEY);
  doc.text('Thank you, and have a productive and blessed day.', PAGE_W / 2, sy + 2, { align: 'center' });
  y = sy + 2;

  // ── Section: day-to-day variation status ─────────────────────────────────────
  y = sectionTitle(y + 8, `Day to Day ${monthName} Variation Status`);
  autoTable(doc, {
    ...tableOpts(y),
    head: [['Sr. No.', 'Branches', `Previous ${monthName}\nVariation`, 'Reporting Date\nDeposit Progress', `Reporting Date\n${monthName} Variation`, 'Status']],
    body: data.dayToDay.map((r, i) => [String(i + 1), r.branchName, fmtMoney(r.previousVariation), fmtMoney(r.depositProgress), fmtMoney(r.currentVariation), r.status]),
    foot: [['', data.scopeLabel, fmtMoney(data.districtPrev), fmtMoney(data.districtProgress), fmtMoney(data.districtCurrent), data.districtStatus]],
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { cellWidth: 38, fontStyle: 'bold' },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'center', cellWidth: 26, fontStyle: 'bold' },
    },
    didParseCell: (d: any) => {
      if (d.section === 'body') {
        if ([2, 3, 4].includes(d.column.index) && String(d.cell.raw).includes('(')) {
          d.cell.styles.fillColor = PINK;
          d.cell.styles.textColor = STATUS_TEXT.Decrement;
        }
        if (d.column.index === 5) {
          const s = String(d.cell.raw) as RMPrintStatus;
          d.cell.styles.textColor = STATUS_TEXT[s] ?? STATUS_TEXT[''];
        }
      }
    },
  });

  // ── Final pass: identical chrome on every page (header, footer, branding) ────
  const total = doc.getNumberOfPages();
  const ts = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawPageBorder();
    drawMasthead(logo, data);
    drawFooterAndBranding(bee, data, p, total, ts, opts?.generatedBy ?? null);
  }

  const scopeFile = data.scopeLabel.replace(/[^a-z0-9]+/gi, '_');
  doc.save(`RM_Report_${scopeFile}_${new Date(data.reportDate).toISOString().slice(0, 10)}.pdf`);
}

// ── Flow helpers ────────────────────────────────────────────────────────────────

/** Reserve `needed` mm at the cursor; break to a fresh page if it won't fit. */
function ensureSpace(yCursor: number, needed: number): number {
  if (yCursor + needed > CONTENT_BOTTOM) {
    doc.addPage();
    return CONTENT_TOP;
  }
  return yCursor;
}

/** Shared autoTable options. Top/bottom margins keep the masthead and the bottom
 *  branding cluster clear; chrome itself is drawn in the final pass. */
function tableOpts(startY: number): any {
  return {
    startY,
    theme: 'grid',
    showHead: 'everyPage',
    margin: { top: HEADER_H, bottom: PAGE_H - CONTENT_BOTTOM, left: MARGIN_X, right: MARGIN_X },
    styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 1.6, textColor: INK, lineColor: [225, 219, 210], lineWidth: 0.1, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: HONEY, textColor: BROWN_DARK, fontStyle: 'bold', fontSize: 7.8, lineColor: HONEY, halign: 'left', valign: 'middle' },
    alternateRowStyles: { fillColor: HONEY_LIGHT },
    footStyles: { fillColor: BROWN, textColor: WHITE, fontStyle: 'bold', fontSize: 8, lineColor: BROWN },
  };
}

/** A honey accent bar + bold section heading; breaks to a new page if needed. */
function sectionTitle(yCursor: number, text: string): number {
  const y = ensureSpace(yCursor, 14);
  doc.setFillColor(...HONEY); doc.rect(MARGIN_X, y, 3, 6, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...BROWN_DARK);
  doc.text(text, MARGIN_X + 5, y + 4.5);
  return y + 8;
}

/** Page-1 style intro: grouped KPI label/value listing on the left (paginates if
 *  long) and the Vision / Mission / Value block on the right (drawn once). */
function drawIntro(data: RMPrintReport, startY: number): number {
  const leftX = MARGIN_X, leftW = 92;
  const rightX = MARGIN_X + leftW + 8, rightW = PAGE_W - rightX - MARGIN_X;
  const startPage = doc.getNumberOfPages();

  // Right column — Vision / Mission / Value (fits comfortably; drawn once).
  let ry = startY + 4;
  ry = brandBlock('VISION', VISION, rightX, ry, rightW); ry += 6;
  ry = brandBlock('MISSION', MISSION, rightX, ry, rightW); ry += 6;
  ry = brandBlock('VALUE', VALUE, rightX, ry, rightW);

  // Left column — grouped KPI listing, flowing with pagination.
  let ly = startY;
  doc.setDrawColor(228, 222, 213);
  data.kpiSections.forEach((section, si) => {
    if (si > 0) {
      ly = ensureSpace(ly, 10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...BROWN);
      doc.text(section.title, leftX + leftW / 2, ly + 3.5, { align: 'center' });
      doc.setDrawColor(...HONEY); doc.setLineWidth(0.3);
      doc.line(leftX, ly + 5, leftX + leftW, ly + 5);
      doc.setDrawColor(228, 222, 213);
      ly += 8;
    }
    for (const item of section.items) {
      ly = ensureSpace(ly, 5.2);
      const highlight = /pending|fayda|integrated/i.test(item.label);
      if (highlight) { doc.setFillColor(...HONEY_LIGHT); doc.rect(leftX, ly - 0.6, leftW, 5, 'F'); }
      doc.setFont('helvetica', highlight ? 'bold' : 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(...(highlight ? BROWN_DARK : INK));
      const label = doc.splitTextToSize(item.label, leftW - 28)[0];
      doc.text(label, leftX + 1, ly + 2.7);
      doc.setFont('helvetica', 'bold');
      doc.text(fmtMoney(item.value), leftX + leftW - 1, ly + 2.7, { align: 'right' });
      doc.setLineWidth(0.1); doc.setDrawColor(230, 224, 215);
      doc.line(leftX, ly + 4.4, leftX + leftW, ly + 4.4);
      ly += 5;
    }
  });
  if (data.kpiSections.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTE);
    doc.text('No KPI achievement data for this period.', leftX, ly + 5);
    ly += 10;
  }

  // If the KPI list spilled onto new pages, the next section continues after it;
  // otherwise both columns are on the same page, so continue below the taller one.
  return doc.getNumberOfPages() > startPage ? ly : Math.max(ly, ry);
}

function brandBlock(heading: string, body: string, x: number, y: number, w: number): number {
  doc.setFont('times', 'bold'); doc.setFontSize(19); doc.setTextColor(...BROWN);
  doc.text(heading, x + w / 2, y + 6, { align: 'center' });
  doc.setFont('times', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(body, w - 4);
  doc.text(lines, x + w / 2, y + 13, { align: 'center' });
  return y + 13 + lines.length * 4.6;
}

// ── Per-page chrome (final pass) ────────────────────────────────────────────────

function drawPageBorder() {
  doc.setDrawColor(...HONEY); doc.setLineWidth(1.1);
  doc.roundedRect(BORDER, BORDER, PAGE_W - 2 * BORDER, PAGE_H - 2 * BORDER, 2.5, 2.5);
}

/** Masthead: logo with "Nib International Bank" beside it, then scope, title and
 *  date — centered as a group and identical on every page. */
function drawMasthead(logo: Img | null, data: RMPrintReport) {
  const topY = BORDER + 3;
  const logoH = 11;
  const logoW = logo ? Math.min(34, logoH * (logo.w / logo.h)) : 0;
  const gap = logo ? 3 : 0;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  const nameW = doc.getTextWidth(BANK_NAME);
  const groupW = logoW + gap + nameW;
  const gx = (PAGE_W - groupW) / 2;

  if (logo) {
    try { doc.addImage(logo.dataUrl, 'PNG', gx, topY, logoW, logoH); } catch { /* ignore */ }
  }
  doc.setTextColor(...BROWN);
  doc.text(BANK_NAME, gx + logoW + gap, topY + logoH / 2 + 2);

  const lineY = topY + logoH;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...BROWN);
  doc.text(data.scopeLabel, PAGE_W / 2, lineY + 4.5, { align: 'center' });
  doc.setFontSize(9);
  doc.text('RM Report', PAGE_W / 2, lineY + 9, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTE);
  doc.text(fullDate(data.reportDate), PAGE_W / 2, lineY + 13, { align: 'center' });
}

/** Footer line + metadata, plus the bee branding mark and slogan in the
 *  bottom-right corner — consistent on every page, clear of all content. */
function drawFooterAndBranding(
  bee: Img | null, data: RMPrintReport, p: number, total: number, ts: string, generatedBy: string | null,
) {
  // Bee branding mark (bottom-right), drawn as a subtle watermark element.
  if (bee) {
    let beeW = BEE_MAX_H * (bee.w / bee.h);
    let beeH = BEE_MAX_H;
    if (beeW > BEE_MAX_W) { beeW = BEE_MAX_W; beeH = BEE_MAX_W * (bee.h / bee.w); }
    const beeX = PAGE_W - MARGIN_X - beeW;
    const beeY = BEE_BOTTOM_Y - beeH;
    const anyDoc = doc as any;
    let gsApplied = false;
    try {
      if (anyDoc.GState && anyDoc.setGState) { anyDoc.setGState(new anyDoc.GState({ opacity: 0.9 })); gsApplied = true; }
      doc.addImage(bee.dataUrl, 'PNG', beeX, beeY, beeW, beeH);
    } catch { /* ignore */ }
    finally { if (gsApplied) { try { anyDoc.setGState(new anyDoc.GState({ opacity: 1 })); } catch { /* ignore */ } } }
  }

  // Slogan directly beneath the bee, in an elegant italic serif.
  doc.setFont('times', 'italic'); doc.setFontSize(10.5); doc.setTextColor(...HONEY);
  doc.text(SLOGAN, PAGE_W - MARGIN_X, SLOGAN_BASELINE_Y, { align: 'right' });

  // Footer separator + metadata.
  doc.setDrawColor(...HONEY); doc.setLineWidth(0.3);
  doc.line(MARGIN_X, FOOTER_LINE_Y, PAGE_W - MARGIN_X, FOOTER_LINE_Y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE);
  doc.text(`Generated ${ts}${generatedBy ? ` by ${generatedBy}` : ''}`, MARGIN_X, FOOTER_Y + 1.5);
  doc.text('Confidential — Management Use Only', PAGE_W / 2, FOOTER_Y + 1.5, { align: 'center' });
  doc.text(`Page ${p} of ${total}`, PAGE_W - MARGIN_X, FOOTER_Y + 1.5, { align: 'right' });
}

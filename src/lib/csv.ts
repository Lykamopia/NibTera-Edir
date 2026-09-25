/**
 * Context-correct CSV output encoding (pure; safe on client and server).
 *
 * - Every cell is quoted and embedded quotes are doubled (RFC 4180).
 * - Formula-injection neutralization: a cell that a spreadsheet would treat as a
 *   formula (leading = + - @, tab or carriage return) is prefixed with a single
 *   quote so Excel/LibreOffice/Sheets display it as text instead of executing
 *   it (e.g. a member named `=HYPERLINK("http://evil",...)`). Plain numbers —
 *   including negative amounts like -150.00 — are left intact.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (FORMULA_TRIGGER.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvLine(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvLine).join('\n');
}

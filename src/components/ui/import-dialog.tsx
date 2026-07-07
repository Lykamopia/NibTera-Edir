'use client';

/**
 * Reusable bulk-import dialog: download a CSV template, upload or paste rows,
 * preview the parsed data, then import with per-row error reporting. The caller
 * supplies the column spec and an `onImport` that performs the server-side
 * validation + bulk create/update.
 */

import * as React from 'react';
import { downloadCsv } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Download, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';

export interface ImportColumn { key: string; label: string; required?: boolean; example?: string }
export interface ImportSummary { created: number; updated: number; errors: { row: number; message: string }[] }

const csvCell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** Minimal RFC-4180-ish CSV parser (handles quotes, commas, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

export function ImportDialog({
  title, description, columns, templateName, sampleRows = [], onImport, onClose, onDone,
}: {
  title: string;
  description?: string;
  columns: ImportColumn[];
  templateName: string;
  sampleRows?: Record<string, string>[];
  onImport: (rows: Record<string, string>[]) => Promise<ImportSummary | { error: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [raw, setRaw] = React.useState('');
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);

  const downloadTemplate = () => {
    const header = columns.map(c => csvCell(c.label)).join(',');
    const example = (sampleRows.length ? sampleRows : [Object.fromEntries(columns.map(c => [c.key, c.example ?? '']))])
      .map(r => columns.map(c => csvCell(r[c.key] ?? '')).join(','));
    const csv = [header, ...example].join('\n');
    downloadCsv(csv, templateName);
  };

  const parse = (text: string) => {
    setSummary(null);
    setParseError(null);
    const trimmed = text.trim();
    if (!trimmed) { setRows([]); return; }
    const grid = parseCsv(trimmed);
    if (grid.length < 2) { setParseError('Add a header row plus at least one data row.'); setRows([]); return; }
    const header = grid[0].map(h => h.trim().toLowerCase());
    // Map each column to a header index by label or key (case-insensitive).
    const idx = columns.map(c => {
      const want = [c.label.toLowerCase(), c.key.toLowerCase()];
      return header.findIndex(h => want.includes(h));
    });
    const missing = columns.filter((c, i) => c.required && idx[i] === -1).map(c => c.label);
    if (missing.length) { setParseError(`Missing required column(s): ${missing.join(', ')}.`); setRows([]); return; }
    const mapped = grid.slice(1).map(cells => {
      const obj: Record<string, string> = {};
      columns.forEach((c, i) => { obj[c.key] = idx[i] >= 0 ? (cells[idx[i]] ?? '').trim() : ''; });
      return obj;
    });
    setRows(mapped);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    parse(text);
  };

  const doImport = async () => {
    if (rows.length === 0) { toast.error('Nothing to import — add some rows.'); return; }
    setImporting(true);
    const res = await onImport(rows);
    setImporting(false);
    if ('error' in res) { toast.error(res.error); return; }
    setSummary(res);
    if (res.created + res.updated > 0) onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" /> {title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {summary ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-success/5 p-3 text-center"><div className="text-2xl font-bold text-success">{summary.created}</div><div className="text-xs text-muted-foreground">Created</div></div>
              <div className="rounded-lg border bg-info/5 p-3 text-center"><div className="text-2xl font-bold text-info">{summary.updated}</div><div className="text-xs text-muted-foreground">Updated</div></div>
              <div className="rounded-lg border bg-destructive/5 p-3 text-center"><div className="text-2xl font-bold text-destructive">{summary.errors.length}</div><div className="text-xs text-muted-foreground">Errors</div></div>
            </div>
            {summary.errors.length === 0 ? (
              <p className="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> All rows imported successfully.</p>
            ) : (
              <div className="rounded-lg border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">Rows that need attention</div>
                <div className="max-h-56 overflow-y-auto divide-y">
                  {summary.errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-1.5 text-sm"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /><span><span className="font-medium">Row {e.row}:</span> {e.message}</span></div>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setSummary(null); setRows([]); setRaw(''); }}>Import more</Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="mr-1.5 h-4 w-4" /> Download template</Button>
              <label className="inline-flex">
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                <span className="inline-flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"><Upload className="mr-1.5 h-4 w-4" /> Upload CSV</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><ClipboardPaste className="h-3.5 w-3.5" /> …or paste CSV rows</Label>
              <Textarea
                rows={5}
                className="font-mono text-xs"
                placeholder={`${columns.map(c => c.label).join(',')}\n${columns.map(c => c.example ?? '').join(',')}`}
                value={raw}
                onChange={e => { setRaw(e.target.value); parse(e.target.value); }}
              />
              <p className="text-[11px] text-muted-foreground">
                Required: {columns.filter(c => c.required).map(c => c.label).join(', ') || 'none'}. Existing rows are updated; new ones are created.
              </p>
            </div>

            {parseError && <p className="flex items-center gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" /> {parseError}</p>}

            {rows.length > 0 && (
              <div className="rounded-lg border">
                <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">{rows.length} row(s) ready · showing first {Math.min(rows.length, 5)}</div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>{columns.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      {rows.slice(0, 5).map((r, i) => (
                        <TableRow key={i}>{columns.map(c => <TableCell key={c.key} className="text-xs">{r[c.key] || <span className="text-muted-foreground">—</span>}</TableCell>)}</TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={importing}>Cancel</Button>
              <Button onClick={doImport} disabled={importing || rows.length === 0}>{importing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Import {rows.length > 0 ? `(${rows.length})` : ''}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

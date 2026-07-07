'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Download, ScrollText, Archive } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { getAuditLogs, exportAuditCsv, archiveAuditLog } from '@/app/actions/admin';
import { downloadCsv } from '@/lib/download';

export default function AuditClient() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [archived, setArchived] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const rangeKey = `${dateRange.preset}:${dateRange.from?.toISOString() ?? ''}:${dateRange.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getAuditLogs({ query, action, archived, page, range: toParam(dateRange) })
      .then(r => { setItems(r.items); setPages(r.pages); setTotal(r.total); })
      .catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, action, archived, page, rangeKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, action, archived, rangeKey]);

  const onExport = async () => {
    try { downloadCsv(await exportAuditCsv({ query, action, archived, range: toParam(dateRange) }), 'audit-log.csv'); }
    catch { toast.error('Export failed.'); }
  };
  const onArchive = async (id: string) => {
    const res = await archiveAuditLog(id);
    if (res?.success) { toast.success('Entry archived.'); load(); }
    else toast.error(res?.error || 'Failed to archive.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground text-sm">Every mutation across the platform, attributable and tenant-scoped.</p>
        </div>
        <Button variant="outline" onClick={onExport}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search details…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Input className="w-48" placeholder="Filter by action…" value={action} onChange={e => setAction(e.target.value)} />
        <DateRangeFilter value={dateRange} onChange={setDateRange} className="w-44" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Archived</label>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <p className="text-sm text-muted-foreground">Failed to load audit log.</p>
              <Button variant="outline" size="sm" onClick={load}>Retry</Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <ScrollText className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No audit entries found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Target</TableHead><TableHead>Details</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                    <TableCell><span className="font-mono text-xs">{a.action}</span></TableCell>
                    <TableCell>{a.userName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.targetType ?? '—'}</TableCell>
                    <TableCell className="max-w-md truncate text-sm">{a.details ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {!archived && <Button size="sm" variant="ghost" onClick={() => onArchive(a.id)} title="Archive"><Archive className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageCount={pages} total={total} pageSize={25} itemLabel="entry" itemLabelPlural="entries" onPageChange={setPage} />
    </div>
  );
}

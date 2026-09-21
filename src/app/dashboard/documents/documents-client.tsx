'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, Search, FolderArchive, FileText, FileImage, FileType2, Upload, Eye, Folder, Files,
  CheckCircle2, XCircle, Clock, Archive, Trash2, Share2, Tag, Shield, Download, History, FolderOpen, X,
  FileSpreadsheet, FileArchive, FileCode, Users, User, ExternalLink, Check, Ban,
} from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState, StatCard } from '@/components/ui/states';
import { DateRangeFilter, ALL_TIME, toParam, type DateRangeValue } from '@/components/ui/date-range-filter';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import { uploadFile } from '@/lib/upload';
import { listRepositoryDocuments, reviewRepositoryDocument } from '@/app/actions/documents';
import {
  getDmsDocumentDetail, createDmsDocument, submitDocumentAction,
  approveDmsDocument, rejectDmsDocument,
} from '@/app/actions/dms-documents';

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  DRAFT: { label: 'Draft', cls: 'bg-muted text-muted-foreground border-border', icon: FileText },
  PENDING: { label: 'Pending Approval', cls: 'border-warning/30 bg-warning/10 text-warning', icon: Clock },
  APPROVED: { label: 'Approved', cls: 'border-success/30 bg-success/10 text-success', icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', cls: 'border-destructive/30 bg-destructive/10 text-destructive', icon: XCircle },
  ARCHIVED: { label: 'Archived', cls: 'border-slate-300 bg-slate-100 text-slate-600', icon: Archive },
};
const VIS_LABEL: Record<string, string> = { staff: 'Staff only', committee: 'Committee', all: 'All members' };

// Where a document originates. Drives the source chip and how it is reviewed.
const SOURCE: Record<string, { label: string; cls: string; icon: any }> = {
  DMS: { label: 'Repository', cls: 'border-primary/30 bg-primary/10 text-primary', icon: FolderArchive },
  MEMBER: { label: 'Member', cls: 'border-blue-300 bg-blue-50 text-blue-700', icon: User },
  RELATIVE: { label: 'Dependent', cls: 'border-violet-300 bg-violet-50 text-violet-700', icon: Users },
  REQUEST: { label: 'Request', cls: 'border-amber-300 bg-amber-50 text-amber-700', icon: FileText },
};
const SOURCE_FILTERS = [
  { value: 'all', label: 'All sources' },
  { value: 'DMS', label: 'Repository' },
  { value: 'MEMBER', label: 'Member documents' },
  { value: 'RELATIVE', label: 'Dependent documents' },
  { value: 'REQUEST', label: 'Request attachments' },
];

/** Resolve a file's extension into a label, icon, and accent for non-image previews. */
function fileFormat(fileName?: string, fileType?: string) {
  const ext = (fileName?.split('.').pop() || '').toLowerCase();
  const map: Record<string, { label: string; Icon: any; cls: string }> = {
    pdf: { label: 'PDF', Icon: FileType2, cls: 'text-red-500' },
    doc: { label: 'DOC', Icon: FileText, cls: 'text-blue-600' },
    docx: { label: 'DOCX', Icon: FileText, cls: 'text-blue-600' },
    xls: { label: 'XLS', Icon: FileSpreadsheet, cls: 'text-emerald-600' },
    xlsx: { label: 'XLSX', Icon: FileSpreadsheet, cls: 'text-emerald-600' },
    csv: { label: 'CSV', Icon: FileSpreadsheet, cls: 'text-emerald-600' },
    ppt: { label: 'PPT', Icon: FileText, cls: 'text-orange-500' },
    pptx: { label: 'PPTX', Icon: FileText, cls: 'text-orange-500' },
    zip: { label: 'ZIP', Icon: FileArchive, cls: 'text-amber-600' },
    rar: { label: 'RAR', Icon: FileArchive, cls: 'text-amber-600' },
    txt: { label: 'TXT', Icon: FileText, cls: 'text-slate-500' },
    json: { label: 'JSON', Icon: FileCode, cls: 'text-slate-500' },
  };
  if (map[ext]) return map[ext];
  if (fileType === 'pdf') return map.pdf;
  return { label: ext ? ext.toUpperCase() : 'FILE', Icon: FileText, cls: 'text-muted-foreground' };
}

const TypeIcon = ({ t, className }: { t: string; className?: string }) =>
  t === 'image' ? <FileImage className={className} /> : t === 'pdf' ? <FileType2 className={className} /> : <FileText className={className} />;
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const fmtTime = (d: any) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function StatusBadge({ status, pending }: { status: string; pending?: string | null }) {
  const s = STATUS[status] ?? STATUS.DRAFT;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant="outline" className={cn('gap-1', s.cls)}><s.icon className="h-3 w-3" /> {s.label}</Badge>
      {pending && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning text-[10px]">{pending} pending</Badge>}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const s = SOURCE[source] ?? SOURCE.DMS;
  return <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', s.cls)}><s.icon className="h-3 w-3" /> {s.label}</Badge>;
}

export default function DocumentsClient() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [tag, setTag] = useState('all');
  const [visibility, setVisibility] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sourceDetail, setSourceDetail] = useState<any | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const rangeKey = `${range.preset}:${range.from?.toISOString() ?? ''}:${range.to?.toISOString() ?? ''}`;

  const load = useCallback(() => {
    setLoading(true); setError(false);
    listRepositoryDocuments({ query, source, category, status, tag: tag === 'all' ? undefined : tag, visibility, range: toParam(range) })
      .then((r: any) => { if (r?.success) setData(r); else setError(true); })
      .catch(() => setError(true)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, category, status, tag, visibility, rangeKey]);
  useEffect(() => { load(); }, [load]);

  const items: any[] = data?.items ?? [];
  const isStaff = data?.isStaff ?? false;
  const canUpload = data?.canUpload ?? false;

  // Bulk archive/delete only applies to repository (DMS) documents.
  const dmsItems = items.filter(i => i.source === 'DMS');
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = dmsItems.length > 0 && dmsItems.every(i => selected.has(i.id));

  const openDetail = (d: any) => { if (d.source === 'DMS') setDetailId(d.id); else setSourceDetail(d); };

  // Approve/reject a member or dependent document in place — dispatched to that
  // module's own workflow, so the decision shows everywhere the record appears.
  const review = async (item: any, decision: 'APPROVED' | 'REJECTED') => {
    let reason: string | undefined;
    if (decision === 'REJECTED') {
      const r = await prompt({ title: 'Reject document', label: 'Reason (shared with the uploader)', multiline: true, required: true, confirmText: 'Reject' });
      if (!r) return; reason = r;
    } else if (!(await confirm({ title: 'Approve this document?', description: 'It is marked approved and the status updates everywhere it appears.', confirmText: 'Approve' }))) {
      return;
    }
    setBusyKey(item.key);
    const res = await reviewRepositoryDocument({ source: item.source, id: item.id, decision, reason });
    setBusyKey(null);
    if (res?.success) { toast.success(decision === 'APPROVED' ? 'Document approved.' : 'Document rejected.'); load(); }
    else toast.error(res?.error || 'Action failed.');
  };

  const bulk = async (action: 'archive' | 'delete') => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!(await confirm({ title: `${action === 'archive' ? 'Archive' : 'Delete'} ${ids.length} document(s)?`, description: `Each ${action} is submitted for checker approval before taking effect.`, destructive: action === 'delete', confirmText: action === 'archive' ? 'Archive' : 'Delete' }))) return;
    let ok = 0;
    for (const id of ids) { const r = await submitDocumentAction({ documentId: id, action }); if (r?.success) ok++; }
    toast.success(`${ok} ${action} request(s) submitted for approval.`);
    setSelected(new Set()); load();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FolderArchive}
        title="Documents"
        description="Central repository for every uploaded document — repository files, member documents, dependent documents and request attachments — with in-place approval."
        actions={canUpload ? <Button onClick={() => setUploadOpen(true)} className="gap-2"><Upload className="h-4 w-4" /> Upload Document</Button> : undefined}
      />

      {/* Stats */}
      {data?.stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard title="Total" value={data.stats.total} icon={Files} accent="primary" />
          <StatCard title="Pending" value={data.stats.pending} icon={Clock} accent="warning" />
          <StatCard title="Approved" value={data.stats.approved} icon={CheckCircle2} accent="success" />
          <StatCard title="Rejected" value={data.stats.rejected} icon={XCircle} accent="destructive" />
          <StatCard title="Archived" value={data.stats.archived} icon={Archive} accent="info" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Folders / categories */}
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardContent className="p-2">
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Folders</div>
            <button onClick={() => setCategory('all')} className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors', category === 'all' ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}>
              <span className="inline-flex items-center gap-2"><FolderOpen className="h-4 w-4" /> All Documents</span>
              <span className="text-xs text-muted-foreground">{data?.stats?.total ?? 0}</span>
            </button>
            <div className="mt-0.5 max-h-[50vh] space-y-0.5 overflow-y-auto">
              {(data?.categoryCounts ?? []).map((c: any) => (
                <button key={c.name} onClick={() => setCategory(c.name)} className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors', category === c.name ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}>
                  <span className="inline-flex min-w-0 items-center gap-2"><Folder className="h-4 w-4 shrink-0" /> <span className="truncate">{c.name}</span></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.count}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Main */}
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search title, file, owner, tag…" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                {SOURCE_FILTERS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <DateRangeFilter value={range} onChange={setRange} className="w-44" />
            {(data?.tags?.length ?? 0) > 0 && (
              <Select value={tag} onValueChange={setTag}>
                <SelectTrigger className="w-36"><Tag className="mr-1 h-3.5 w-3.5 text-muted-foreground" /><SelectValue placeholder="Tag" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {data.tags.map((t: string) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {isStaff && (
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="w-36"><Shield className="mr-1 h-3.5 w-3.5 text-muted-foreground" /><SelectValue placeholder="Visibility" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All visibility</SelectItem>
                  <SelectItem value="staff">Staff only</SelectItem>
                  <SelectItem value="committee">Committee</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Bulk bar */}
          {isStaff && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <span className="text-muted-foreground">— repository documents · bulk actions are submitted for approval</span>
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => bulk('archive')}><Archive className="mr-1 h-4 w-4" /> Archive</Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => bulk('delete')}><Trash2 className="mr-1 h-4 w-4" /> Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </div>
          )}

          {/* List */}
          <Card>
            <CardContent className="p-0">
              {loading ? <LoadingState label="Loading documents…" rows={6} />
                : error ? <ErrorState onRetry={load} />
                : items.length === 0 ? (
                  <EmptyState icon={FolderArchive} title="No documents found"
                    description={canUpload ? 'Upload a document, or documents from member/dependent pages will appear here as they are added.' : 'Approved documents shared with members will appear here.'}
                    action={canUpload ? <Button variant="outline" className="gap-2" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> Upload</Button> : undefined} />
                ) : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {isStaff && <TableHead className="w-8"><Checkbox checked={allSel} onCheckedChange={(c) => setSelected(c === true ? new Set(dmsItems.map(i => i.id)) : new Set())} /></TableHead>}
                        <TableHead>Document</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Owner / Related</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Updated</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(d => {
                        const canReviewInline = d.canReview && (d.source === 'MEMBER' || d.source === 'RELATIVE');
                        return (
                        <TableRow key={d.key} className={cn('cursor-pointer', d.source === 'DMS' && selected.has(d.id) && 'bg-primary/5')} onClick={() => openDetail(d)}>
                          {isStaff && (
                            <TableCell onClick={e => e.stopPropagation()}>
                              {d.source === 'DMS'
                                ? <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggleSel(d.id)} />
                                : null}
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><TypeIcon t={d.fileType} className="h-4 w-4" /></span>
                              <div className="min-w-0">
                                <div className="truncate font-medium">{d.title}</div>
                                <div className="truncate text-xs text-muted-foreground">{d.category}{d.tags.length > 0 ? ` · ${d.tags.slice(0, 3).join(', ')}` : ''}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><SourceBadge source={d.source} /></TableCell>
                          <TableCell className="text-sm">
                            {d.owner ? (
                              <Link href={d.relatedHref} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-foreground hover:text-primary hover:underline">
                                <span className="truncate">{d.owner.name}</span>
                                <span className="text-xs text-muted-foreground">{d.owner.code}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                              </Link>
                            ) : <span className="text-muted-foreground">{d.relatedLabel}</span>}
                          </TableCell>
                          <TableCell><StatusBadge status={d.status} pending={d.pendingAction && d.pendingAction !== 'upload' ? d.pendingAction : null} /></TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">{fmt(d.approvedAt ?? d.createdAt)}</TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            {canReviewInline ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-success" disabled={busyKey === d.key} onClick={() => review(d, 'APPROVED')}>{busyKey === d.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve</Button>
                                <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-destructive" disabled={busyKey === d.key} onClick={() => review(d, 'REJECTED')}><Ban className="h-3.5 w-3.5" /> Reject</Button>
                              </div>
                            ) : (
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDetail(d)}><Eye className="h-4 w-4" /></Button>
                            )}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                )}
            </CardContent>
          </Card>
        </div>
      </div>

      {uploadOpen && <UploadDialog categories={data?.categories ?? []} onClose={() => setUploadOpen(false)} onDone={() => { setUploadOpen(false); load(); }} />}
      {detailId && <DetailDialog id={detailId} isStaff={isStaff} onClose={() => setDetailId(null)} onChanged={load} />}
      {sourceDetail && <SourceDetailDialog item={sourceDetail} onReview={review} busyKey={busyKey} onClose={() => setSourceDetail(null)} />}
    </div>
  );
}

// ─── Non-DMS detail (member / dependent / request) ───────────────────────────

function SourceDetailDialog({ item, onReview, busyKey, onClose }: { item: any; onReview: (item: any, decision: 'APPROVED' | 'REJECTED') => void; busyKey: string | null; onClose: () => void }) {
  const isImage = item.fileType === 'image';
  const isPdf = item.fileType === 'pdf' || (item.fileName || '').toLowerCase().endsWith('.pdf');
  const canReviewInline = item.canReview && (item.source === 'MEMBER' || item.source === 'RELATIVE');

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">{item.title} <SourceBadge source={item.source} /> <StatusBadge status={item.status} pending={item.pendingAction && item.pendingAction !== 'upload' ? item.pendingAction : null} /></DialogTitle>
          <DialogDescription>{item.sourceLabel}{item.category ? ` · ${item.category}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
            {isImage ? (
              <img src={item.fileUrl} alt={item.fileName} className="max-h-72 w-full object-contain" />
            ) : isPdf ? (
              <iframe src={item.fileUrl} title={item.title || item.fileName} className="h-[60vh] w-full" />
            ) : (() => {
              const f = fileFormat(item.fileName, item.fileType);
              return (
                <div className="flex flex-col items-center gap-2 p-8 text-center">
                  <f.Icon className={cn('h-16 w-16', f.cls)} />
                  <span className={cn('rounded-md border bg-background px-2 py-0.5 text-xs font-semibold', f.cls)}>{f.label}</span>
                  <span className="max-w-[16rem] truncate text-sm text-muted-foreground">{item.fileName}</span>
                </div>
              );
            })()}
          </div>

          <div className="flex flex-wrap gap-2">
            <a href={item.fileUrl} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><Download className="mr-1 h-4 w-4" /> Open file</Button></a>
            <Link href={item.relatedHref}><Button variant="outline" size="sm"><ExternalLink className="mr-1 h-4 w-4" /> Go to source</Button></Link>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-3 text-sm">
            {item.owner && <Meta label="Owner" value={`${item.owner.name} · ${item.owner.code}`} />}
            <Meta label="Related" value={item.relatedLabel} />
            <Meta label="Uploaded" value={`${item.uploadedBy ? `${item.uploadedBy} · ` : ''}${fmt(item.createdAt)}`} />
            {item.approvedAt && <Meta label="Approved" value={fmt(item.approvedAt)} />}
            {item.notes && <div className="col-span-2"><Meta label="Notes" value={item.notes} /></div>}
            {item.rejectionReason && <div className="col-span-2"><Meta label="Rejection reason" value={item.rejectionReason} /></div>}
          </div>
        </div>

        {canReviewInline && (
          <DialogFooter className="border-t pt-3">
            <Button size="sm" variant="destructive" disabled={busyKey === item.key} onClick={() => onReview(item, 'REJECTED')}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
            <Button size="sm" className="bg-success hover:bg-success/90" disabled={busyKey === item.key} onClick={() => onReview(item, 'APPROVED')}>{busyKey === item.key ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Approve</Button>
          </DialogFooter>
        )}
        {item.source === 'REQUEST' && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">This attachment belongs to a member request — it is approved from the <Link href="/dashboard/requests" className="font-medium text-primary hover:underline">Requests</Link> workflow.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Upload (maker) ──────────────────────────────────────────────────────────

function UploadDialog({ categories, onClose, onDone }: { categories: string[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ title: '', category: categories[0] ?? 'General', newCategory: '', tags: '', purpose: '', visibility: 'staff' });
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const onFile = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    const res = await uploadFile(f, 'documents');
    setUploading(false);
    if (res) setFile(res); else toast.error('Upload failed. Use a PDF/image/doc under 10MB.');
  };

  const submit = async () => {
    if (form.title.trim().length < 2) { toast.error('A title is required.'); return; }
    if (!file) { toast.error('Attach a file.'); return; }
    const category = (form.category === '__new__' ? form.newCategory.trim() : form.category) || 'General';
    setSaving(true);
    const res = await createDmsDocument({ title: form.title.trim(), category, tags: form.tags.trim() || null, purpose: form.purpose.trim() || null, fileUrl: file.path, fileName: file.name, visibility: form.visibility as any });
    setSaving(false);
    if (res?.success) { toast.success('Document submitted — pending checker approval.'); onDone(); }
    else toast.error(res?.error || 'Failed to upload.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>The document is created in a <span className="font-medium text-warning">Pending Approval</span> state and only becomes active once a Checker approves it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. 2026 Annual Bylaws" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Folder / Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!categories.includes('General') && <SelectItem value="General">General</SelectItem>}
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectItem value="__new__">+ New folder…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Visibility</Label>
              <Select value={form.visibility} onValueChange={v => setForm(f => ({ ...f, visibility: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="staff">Staff only</SelectItem><SelectItem value="committee">Committee</SelectItem><SelectItem value="all">All members</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          {form.category === '__new__' && <div className="space-y-1.5"><Label className="text-xs">New folder name</Label><Input value={form.newCategory} onChange={e => setForm(f => ({ ...f, newCategory: e.target.value }))} placeholder="e.g. Legal" /></div>}
          <div className="space-y-1.5"><Label className="text-xs">Tags <span className="font-normal text-muted-foreground">(comma-separated)</span></Label><Input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="bylaws, 2026, legal" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Purpose</Label><Textarea rows={2} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Why is this document being uploaded?" /></div>
          <div className="space-y-1.5"><Label className="text-xs">File</Label>
            {file ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
                <span className="inline-flex min-w-0 items-center gap-1.5"><FileText className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{file.name}</span></span>
                <button type="button" onClick={() => setFile(null)} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5">
                {/* Must mirror the server allow list in src/lib/file-validation.ts
                    ('documents': PDF + JPEG/PNG/GIF/WEBP) — anything else is rejected. */}
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {uploading ? 'Uploading…' : 'Attach a file'}
              </label>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || uploading}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DMS detail / preview / timeline ─────────────────────────────────────────

function DetailDialog({ id, isStaff, onClose, onChanged }: { id: string; isStaff: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(() => {
    setLoading(true);
    getDmsDocumentDetail(id).then((r: any) => { if (r?.success) setD(r); else { toast.error(r?.error || 'Failed to load.'); onClose(); } }).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); const res = await fn(); setBusy(false);
    if (res?.success) { toast.success(ok); onChanged(); load(); } else toast.error(res?.error || 'Action failed.');
  };
  const onSubmitAction = async (action: 'archive' | 'delete' | 'share' | 'classify' | 'edit', changes?: any) => {
    const labels: any = { archive: 'Archive request submitted', delete: 'Delete request submitted', share: 'Visibility change submitted', classify: 'Re-classification submitted', edit: 'Edit submitted' };
    await act(() => submitDocumentAction({ documentId: id, action, changes }), `${labels[action]} for approval.`);
  };

  if (loading || !d) {
    return <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}><DialogContent className="max-w-3xl"><div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></DialogContent></Dialog>;
  }

  const doc = d.document;
  const isImage = doc.fileType === 'image';
  const isPdf = doc.fileType === 'pdf' || (doc.fileName || '').toLowerCase().endsWith('.pdf');

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">{doc.title} <StatusBadge status={doc.status} pending={doc.pendingAction && doc.pendingAction !== 'upload' ? doc.pendingAction : null} /></DialogTitle>
          <DialogDescription>{doc.category}{doc.purpose ? ` · ${doc.purpose}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          {/* Preview + metadata */}
          <div className="space-y-3">
            <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
              {isImage ? (
                <img src={doc.fileUrl} alt={doc.fileName} className="max-h-72 w-full object-contain" />
              ) : isPdf ? (
                <iframe src={doc.fileUrl} title={doc.title || doc.fileName} className="h-[60vh] w-full" />
              ) : (() => {
                const f = fileFormat(doc.fileName, doc.fileType);
                return (
                  <div className="flex flex-col items-center gap-2 p-8 text-center">
                    <f.Icon className={cn('h-16 w-16', f.cls)} />
                    <span className={cn('rounded-md border bg-background px-2 py-0.5 text-xs font-semibold', f.cls)}>{f.label}</span>
                    <span className="max-w-[16rem] truncate text-sm text-muted-foreground">{doc.fileName}</span>
                  </div>
                );
              })()}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><Download className="mr-1 h-4 w-4" /> Open file</Button></a>
              {doc.tags.map((t: string) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"><Tag className="h-3 w-3" /> {t}</span>)}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-3 text-sm">
              <Meta label="Visibility" value={VIS_LABEL[doc.visibility] ?? doc.visibility} />
              <Meta label="Uploaded" value={`${doc.uploadedBy ?? '—'} · ${fmt(doc.createdAt)}`} />
              <Meta label="Reviewed by" value={doc.reviewedBy ?? '—'} />
              <Meta label="Approved by" value={doc.approvedBy ? `${doc.approvedBy} · ${fmt(doc.approvedAt)}` : '—'} />
              {doc.rejectionReason && <div className="col-span-2"><Meta label="Rejection reason" value={doc.rejectionReason} /></div>}
            </div>
          </div>

          {/* Approval timeline */}
          <div className="rounded-lg border">
            <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground"><History className="h-3.5 w-3.5" /> Approval Timeline</div>
            <div className="max-h-72 space-y-0 overflow-y-auto p-3">
              {d.timeline.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No workflow events yet.</p> : d.timeline.map((e: any, i: number) => (
                <div key={e.id} className="flex gap-3 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    {i < d.timeline.length - 1 && <span className="my-0.5 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{e.module} · {e.action}</div>
                    <div className="text-[11px] text-muted-foreground">{e.by} · {fmtTime(e.at)}</div>
                    {e.comment && <div className="mt-0.5 rounded bg-muted/50 px-1.5 py-1 text-[11px]">“{e.comment}”</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        {isStaff && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {d.canApprove && (
              <>
                <Button size="sm" className="bg-success hover:bg-success/90" disabled={busy} onClick={async () => { const c = await prompt({ title: 'Approve document', label: 'Comment (optional)', multiline: true, confirmText: 'Approve' }); if (c === null) return; await act(() => approveDmsDocument(id, c || undefined), 'Approved.'); }}><CheckCircle2 className="mr-1 h-4 w-4" /> Approve</Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={async () => { const r = await prompt({ title: 'Reject document', label: 'Reason', multiline: true, required: true, confirmText: 'Reject' }); if (!r) return; await act(() => rejectDmsDocument(id, r), 'Rejected.'); }}><XCircle className="mr-1 h-4 w-4" /> Reject</Button>
              </>
            )}
            {doc.status === 'APPROVED' && !doc.pendingAction && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const t = await prompt({ title: 'Edit document', label: 'Title', defaultValue: doc.title, required: true }); if (!t) return; const p = await prompt({ title: 'Edit document', label: 'Purpose (optional)', defaultValue: doc.purpose ?? '', multiline: true }); if (p === null) return; onSubmitAction('edit', { title: t, purpose: p }); }}><FileText className="mr-1 h-4 w-4" /> Edit</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const v = await prompt({ title: 'Share / change visibility', label: 'Visibility (staff | committee | all)', defaultValue: doc.visibility, required: true }); if (!v || !['staff', 'committee', 'all'].includes(v)) { if (v) toast.error('Enter staff, committee, or all.'); return; } onSubmitAction('share', { visibility: v }); }}><Share2 className="mr-1 h-4 w-4" /> Share</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const c = await prompt({ title: 'Re-classify', label: 'New folder/category', defaultValue: doc.category, required: true }); if (!c) return; onSubmitAction('classify', { category: c }); }}><Tag className="mr-1 h-4 w-4" /> Classify</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onSubmitAction('archive')}><Archive className="mr-1 h-4 w-4" /> Archive</Button>
                <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={async () => { if (await confirm({ title: 'Request deletion?', description: 'Submitted for checker approval before the document is removed.', destructive: true, confirmText: 'Request delete' })) onSubmitAction('delete'); }}><Trash2 className="mr-1 h-4 w-4" /> Delete</Button>
              </>
            )}
            {doc.pendingAction && <span className="inline-flex items-center gap-1.5 text-xs text-warning"><Clock className="h-3.5 w-3.5" /> A “{doc.pendingAction}” action is awaiting approval.</span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}

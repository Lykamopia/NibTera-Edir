'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm, usePrompt } from '@/components/ui/confirm-provider';
import {
  FileText, FileImage, File as FileIcon, UploadCloud, Eye, Download, Pencil, Trash2, History,
  Check, X, Loader2, Clock, CheckCircle2, XCircle, FileEdit, ChevronDown, GitBranch, AlertTriangle,
} from 'lucide-react';
import {
  getRelativeDocuments, submitRelativeDocument, submitRelativeDocumentUpdate, submitRelativeDocumentDelete,
  approveRelativeDocument, rejectRelativeDocument,
} from '@/app/actions/relative-documents';

type Doc = any;

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  DRAFT: { label: 'Draft', cls: 'border-muted-foreground/20 bg-muted text-muted-foreground', icon: FileEdit },
  PENDING: { label: 'Pending Approval', cls: 'border-warning/30 bg-warning/10 text-warning', icon: Clock },
  APPROVED: { label: 'Approved', cls: 'border-success/30 bg-success/10 text-success', icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', cls: 'border-destructive/30 bg-destructive/10 text-destructive', icon: XCircle },
};

function docIcon(t: string) { return t === 'image' ? FileImage : t === 'pdf' ? FileText : FileIcon; }
const fmt = (d: any) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

async function uploadDoc(file: File): Promise<{ path: string; name: string } | null> {
  const fd = new FormData(); fd.append('file', file); fd.append('type', 'documents');
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const j = await res.json().catch(() => null);
  if (res.ok && j?.success) return { path: j.path, name: j.name };
  toast.error(j?.error || 'Upload failed. Images and PDFs are supported.');
  return null;
}

export default function RelativeDocuments({ relativeId, relativeName }: { relativeId: string; relativeName: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [upload, setUpload] = useState<{ file: File; supersedes?: Doc } | null>(null);
  const [editDoc, setEditDoc] = useState<Doc | null>(null);
  const [preview, setPreview] = useState<Doc | null>(null);
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(() => {
    setLoading(true);
    getRelativeDocuments(relativeId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [relativeId]);
  useEffect(() => { load(); }, [load]);

  const caps = data?.caps ?? { canUpload: false, canEdit: false, canDelete: false, canReview: false };
  const lines: { current: Doc; versions: Doc[] }[] = data?.lines ?? [];

  const onPickFile = (file: File | undefined, supersedes?: Doc) => { if (file) setUpload({ file, supersedes }); };

  const review = async (doc: Doc, decision: 'approve' | 'reject') => {
    let comment: string | undefined;
    if (decision === 'reject') {
      const r = await prompt({ title: 'Reject document', label: 'Reason (shared with the uploader)', multiline: true, confirmText: 'Reject' });
      if (r === null) return; comment = r || undefined;
    }
    setBusyId(doc.id);
    const res = decision === 'approve' ? await approveRelativeDocument(doc.id, comment) : await rejectRelativeDocument(doc.id, comment);
    setBusyId(null);
    if (res?.success) { toast.success(decision === 'approve' ? 'Document approved.' : 'Document rejected.'); load(); }
    else toast.error(res?.error || 'Failed.');
  };

  const del = async (doc: Doc) => {
    if (!(await confirm({ title: 'Request deletion', description: 'This sends a deletion request through Maker–Checker. The document is removed only after a Checker approves.', destructive: true, confirmText: 'Request delete' }))) return;
    setBusyId(doc.id);
    const res = await submitRelativeDocumentDelete(doc.id);
    setBusyId(null);
    if (res?.success) { toast.success('Deletion requested — pending approval.'); load(); }
    else toast.error(res?.error || 'Failed.');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> Documents <span className="font-normal text-muted-foreground">({lines.length})</span></h4>
        {caps.canUpload && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => fileRef.current?.click()}><UploadCloud className="h-4 w-4" /> Upload</Button>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={e => { onPickFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ''; }} />
      </div>

      {/* Drag & drop zone */}
      {caps.canUpload && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); onPickFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}
        >
          <UploadCloud className={`h-5 w-5 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className="text-muted-foreground"><span className="font-medium text-foreground">Drag &amp; drop</span> or click to upload — images or PDF</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : lines.length === 0 ? (
        <p className="rounded-md bg-muted/40 px-3 py-3 text-center text-xs text-muted-foreground">No documents yet for {relativeName}.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {lines.map(({ current: d, versions }) => {
            const meta = STATUS[d.status] ?? STATUS.PENDING;
            const Icon = docIcon(d.fileType);
            const StatusIcon = meta.icon;
            const isPending = d.status === 'PENDING';
            const hasOtherPending = d.pendingAction === 'edit' || d.pendingAction === 'delete';
            return (
              <div key={d.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
                <div className="flex items-start gap-2.5">
                  {/* Thumbnail / icon */}
                  <button onClick={() => setPreview(d)} className="shrink-0">
                    {d.fileType === 'image'
                      ? <img src={d.fileUrl} alt={d.documentName || 'document'} className="h-12 w-12 rounded-lg border object-cover" />
                      : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-6 w-6" /></span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{d.documentName || d.fileName || 'Document'}</p>
                      {d.version > 1 && <span className="shrink-0 text-[10px] font-medium text-muted-foreground">v{d.version}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{d.category}</Badge>
                      <Badge variant="outline" className={`gap-0.5 px-1.5 py-0 text-[10px] ${meta.cls}`}><StatusIcon className="h-2.5 w-2.5" /> {meta.label}</Badge>
                      {hasOtherPending && <Badge variant="outline" className="border-warning/30 bg-warning/10 px-1.5 py-0 text-[10px] text-warning">{d.pendingAction === 'edit' ? 'Edit pending' : 'Delete pending'}</Badge>}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{fmt(d.createdAt)}{d.uploaderName ? ` · ${d.uploaderName}` : ''}</p>
                  </div>
                </div>

                {d.remarks && <p className="rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">{d.remarks}</p>}
                {d.status === 'REJECTED' && d.rejectionReason && <p className="flex items-start gap-1 text-[11px] text-destructive"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {d.rejectionReason}</p>}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-1 border-t pt-2">
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setPreview(d)}><Eye className="h-3.5 w-3.5" /> Preview</Button>
                  <a href={d.fileUrl} download className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent"><Download className="h-3.5 w-3.5" /> Download</a>
                  {versions.length > 1 && (
                    <button onClick={() => setOpenHistory(h => ({ ...h, [d.id]: !h[d.id] }))} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent">
                      <History className="h-3.5 w-3.5" /> {versions.length} versions <ChevronDown className={`h-3 w-3 transition-transform ${openHistory[d.id] ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {caps.canReview && isPending && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-success" disabled={busyId === d.id} onClick={() => review(d, 'approve')}>{busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve</Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-destructive" disabled={busyId === d.id} onClick={() => review(d, 'reject')}><X className="h-3.5 w-3.5" /> Reject</Button>
                      </>
                    )}
                    {caps.canUpload && !d.pendingAction && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Upload new version" onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.onchange = () => onPickFile(inp.files?.[0], d); inp.click(); }}><GitBranch className="h-3.5 w-3.5" /></Button>
                    )}
                    {caps.canEdit && !d.pendingAction && d.status !== 'REJECTED' && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit details" onClick={() => setEditDoc(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                    )}
                    {caps.canDelete && !d.pendingAction && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Request deletion" disabled={busyId === d.id} onClick={() => del(d)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </div>

                {/* Version history */}
                {openHistory[d.id] && versions.length > 1 && (
                  <ol className="space-y-1.5 rounded-lg bg-muted/30 p-2">
                    {versions.map((v: Doc) => {
                      const vm = STATUS[v.status] ?? STATUS.PENDING;
                      return (
                        <li key={v.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="flex items-center gap-1.5">
                            <span className="font-medium">v{v.version}</span>
                            <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${vm.cls}`}>{vm.label}</Badge>
                            {v.archivedAt && <span className="text-muted-foreground">superseded</span>}
                          </span>
                          <span className="flex items-center gap-2 text-muted-foreground">
                            {fmt(v.createdAt)}
                            <a href={v.fileUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">view</a>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}

      {upload && <UploadDialog file={upload.file} supersedes={upload.supersedes} relativeId={relativeId} categories={data?.categories ?? []} onClose={() => setUpload(null)} onDone={() => { setUpload(null); load(); }} />}
      {editDoc && <EditDialog doc={editDoc} categories={data?.categories ?? []} onClose={() => setEditDoc(null)} onDone={() => { setEditDoc(null); load(); }} />}
      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function UploadDialog({ file, supersedes, relativeId, categories, onClose, onDone }: { file: File; supersedes?: Doc; relativeId: string; categories: string[]; onClose: () => void; onDone: () => void }) {
  const [documentName, setDocumentName] = useState(supersedes?.documentName || file.name.replace(/\.[^.]+$/, ''));
  const [category, setCategory] = useState(supersedes?.category || categories[0] || 'General');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const isImage = file.type.startsWith('image/');
  const previewUrl = isImage ? URL.createObjectURL(file) : null;

  const submit = async () => {
    setSaving(true);
    const up = await uploadDoc(file);
    if (!up) { setSaving(false); return; }
    const res = await submitRelativeDocument(relativeId, {
      fileUrl: up.path, fileName: up.name, documentName: documentName.trim() || null,
      category, remarks: remarks.trim() || null, supersedesId: supersedes?.id ?? null,
    });
    setSaving(false);
    if (res?.success) { toast.success(supersedes ? 'New version submitted for approval.' : 'Document submitted for approval.'); onDone(); }
    else toast.error(res?.error || 'Failed.');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{supersedes ? `New version — ${supersedes.documentName || supersedes.fileName}` : 'Upload document'}</DialogTitle>
          <DialogDescription>The document is submitted through Maker–Checker and stays <strong>Pending</strong> until a Checker approves it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2.5">
            {previewUrl ? <img src={previewUrl} alt="preview" className="h-14 w-14 rounded-md object-cover" /> : <span className="flex h-14 w-14 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="h-6 w-6" /></span>}
            <div className="min-w-0"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Document name</Label><Input value={documentName} onChange={e => setDocumentName(e.target.value)} placeholder="e.g. Birth Certificate" /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Remarks (optional)</Label><Textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Any notes for the reviewer…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit for approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ doc, categories, onClose, onDone }: { doc: Doc; categories: string[]; onClose: () => void; onDone: () => void }) {
  const [documentName, setDocumentName] = useState(doc.documentName || '');
  const [category, setCategory] = useState(doc.category || 'General');
  const [remarks, setRemarks] = useState(doc.remarks || '');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    const res = await submitRelativeDocumentUpdate(doc.id, { documentName: documentName.trim() || null, category, remarks: remarks.trim() || null });
    setSaving(false);
    if (res?.success) { toast.success('Update submitted for approval.'); onDone(); }
    else toast.error(res?.error || 'Failed.');
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit document details</DialogTitle>
          <DialogDescription>Metadata changes go through Maker–Checker and apply only after approval.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label className="text-xs">Document name</Label><Input value={documentName} onChange={e => setDocumentName(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Remarks</Label><Textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Submit for approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const Icon = docIcon(doc.fileType);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader><DialogTitle className="flex items-center gap-2 pr-6 text-base"><Icon className="h-4 w-4 text-primary" /> {doc.documentName || doc.fileName || 'Document'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-center overflow-auto rounded-lg border bg-muted/30" style={{ maxHeight: '70vh' }}>
            {doc.fileType === 'image' ? (
              <img src={doc.fileUrl} alt={doc.documentName || 'document'} className="max-h-[70vh] w-auto object-contain" />
            ) : doc.fileType === 'pdf' ? (
              <iframe src={doc.fileUrl} title={doc.documentName || 'document'} className="h-[70vh] w-full" />
            ) : (
              <div className="flex flex-col items-center gap-3 p-10 text-center"><FileIcon className="h-12 w-12 text-muted-foreground" /><p className="text-sm text-muted-foreground">Inline preview is not available for this file type.</p></div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{doc.category} · v{doc.version}</span>
            <a href={doc.fileUrl} download className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"><Download className="h-4 w-4" /> Download</a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

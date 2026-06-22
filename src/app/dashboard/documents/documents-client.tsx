'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Loader2, Search, FolderArchive, FileText, FileImage, FileType2, Download, ExternalLink, User, Eye, ArrowUpRight,
} from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState, StatCard } from '@/components/ui/states';
import { getDocuments, type DocItem } from '@/app/actions/documents';

const STATUS: Record<string, string> = {
  PENDING: 'border-warning/20 bg-warning/10 text-warning', IN_REVIEW: 'border-info/20 bg-info/10 text-info',
  APPROVED: 'border-success/20 bg-success/10 text-success', RESOLVED: 'border-success/20 bg-success/10 text-success',
  REJECTED: 'border-destructive/20 bg-destructive/10 text-destructive',
};
const SOURCE_LABEL: Record<string, string> = { MEMBER: 'Member', RELATIVE: 'Relative', REQUEST: 'Request' };
const TypeIcon = ({ type, className }: { type: string; className?: string }) =>
  type === 'image' ? <FileImage className={className} /> : type === 'pdf' ? <FileType2 className={className} /> : <FileText className={className} />;

const fmt = (d: any) => new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });

export default function DocumentsClient() {
  const [data, setData] = useState<{ items: DocItem[]; isStaff: boolean; stats?: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [preview, setPreview] = useState<DocItem | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getDocuments({ query, source, status, type }).then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, [query, source, status, type]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader title="Documents" description="The central repository for every document uploaded across the system — scoped to what you're authorized to see." icon={FolderArchive} />

      {data?.stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard title="Total" value={data.stats.total} icon={FolderArchive} accent="primary" />
          <StatCard title="Pending Review" value={data.stats.pending} icon={FileText} accent="warning" />
          <StatCard title="Approved" value={data.stats.approved} icon={FileText} accent="success" />
          <StatCard title="Rejected" value={data.stats.rejected} icon={FileText} accent="destructive" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search file, owner, record…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="MEMBER">Member docs</SelectItem><SelectItem value="RELATIVE">Relative docs</SelectItem><SelectItem value="REQUEST">Request files</SelectItem></SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="image">Images</SelectItem><SelectItem value="pdf">PDFs</SelectItem><SelectItem value="file">Other</SelectItem></SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="PENDING">Pending</SelectItem><SelectItem value="APPROVED">Approved</SelectItem><SelectItem value="REJECTED">Rejected</SelectItem></SelectContent>
        </Select>
      </div>

      {loading ? <LoadingState label="Loading documents…" /> : error || !data ? <ErrorState onRetry={load} /> : data.items.length === 0 ? (
        <Card><CardContent className="p-0"><EmptyState icon={FolderArchive} title="No documents found" description="Documents uploaded across the system will appear here." /></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map(d => (
            <Card key={d.id} className="card-interactive overflow-hidden">
              <button type="button" className="block w-full text-left" onClick={() => setPreview(d)}>
                <div className="flex h-32 items-center justify-center border-b bg-muted/40">
                  {d.fileType === 'image'
                    ? <img src={d.fileUrl} alt={d.fileName} className="h-full w-full object-cover" />
                    : <TypeIcon type={d.fileType} className="h-12 w-12 text-muted-foreground" />}
                </div>
              </button>
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium" title={d.fileName}>{d.fileName}</div>
                    <div className="text-xs text-muted-foreground">{SOURCE_LABEL[d.source]} · {d.category.replace(/_/g, ' ')}</div>
                  </div>
                  <Badge variant="outline" className={STATUS[d.status] ?? 'bg-muted text-muted-foreground'}>{d.status.replace('_', ' ')}</Badge>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><User className="h-3.5 w-3.5" /> {d.ownerName} · {d.ownerCode}</div>
                <div className="flex items-center justify-between border-t pt-2 text-xs">
                  <span className="text-muted-foreground">{fmt(d.uploadedAt)}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPreview(d)} className="inline-flex items-center gap-1 text-primary hover:underline"><Eye className="h-3.5 w-3.5" /> Preview</button>
                    <a href={d.fileUrl} download className="inline-flex items-center gap-1 text-primary hover:underline"><Download className="h-3.5 w-3.5" /></a>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function PreviewDialog({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="truncate">{doc.fileName}</DialogTitle>
          <DialogDescription>{doc.sourceLabel} · {doc.category.replace(/_/g, ' ')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {doc.fileType === 'image'
            ? <img src={doc.fileUrl} alt={doc.fileName} className="max-h-[55vh] w-full object-contain" />
            : <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground"><TypeIcon type={doc.fileType} className="h-14 w-14" /><a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">Open file <ExternalLink className="inline h-3.5 w-3.5" /></a></div>}
        </div>
        <div className="space-y-1.5 text-sm">
          <Row label="Owner" value={`${doc.ownerName} · ${doc.ownerCode}`} />
          <Row label="Category" value={doc.category.replace(/_/g, ' ')} />
          <Row label="Status" value={<Badge variant="outline" className={STATUS[doc.status] ?? ''}>{doc.status.replace('_', ' ')}</Badge>} />
          <Row label="Uploaded" value={fmt(doc.uploadedAt)} />
          <Row label="Related record" value={<span>{doc.relatedType}: {doc.relatedLabel}</span>} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={doc.fileUrl} download><Download className="mr-1.5 h-4 w-4" /> Download</a></Button>
          <Button asChild><Link href={doc.relatedHref}><ArrowUpRight className="mr-1.5 h-4 w-4" /> Go to {doc.relatedType}</Link></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}

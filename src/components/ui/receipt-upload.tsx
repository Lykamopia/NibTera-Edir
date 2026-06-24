'use client';

/**
 * Reusable optional receipt / evidence uploader. Stores a file via /api/upload
 * and surfaces its public path. Used for manual payments, member self-payments,
 * and emergency disbursements so payment/disbursement evidence can be retained.
 */

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFile } from '@/lib/upload';

export interface ReceiptFile { path: string; name: string }

export function ReceiptUpload({
  value, onChange, label = 'Receipt / evidence', optional = true, accept = '.pdf,.png,.jpg,.jpeg',
}: {
  value: ReceiptFile | null;
  onChange: (v: ReceiptFile | null) => void;
  label?: string;
  optional?: boolean;
  accept?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const onFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    const res = await uploadFile(file, 'documents');
    setUploading(false);
    if (res) onChange(res);
    else toast.error('Upload failed. Try a PDF or image under 10MB.');
  };

  return (
    <div className="space-y-1.5">
      {label && <Label className="text-xs">{label}{optional && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>}
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
          <a href={value.path} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline">
            <FileText className="h-4 w-4 shrink-0" /><span className="truncate">{value.name}</span>
          </a>
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove receipt"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5">
          <input type="file" accept={accept} className="hidden" disabled={uploading} onChange={e => onFile(e.target.files?.[0])} />
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Upload receipt (PDF or image)'}
        </label>
      )}
    </div>
  );
}

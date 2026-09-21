'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Scale, Printer, Search, Plus, FilePlus2, Send, Trash2, Pencil, Paperclip, X, FileText,
  ExternalLink, History, Eye, CheckCircle2, Clock, CalendarDays, UserRound, Archive, BookOpenCheck,
} from 'lucide-react';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { SelectEdirNotice } from '@/components/select-edir-notice';
import {
  getRulesPage, createDraft, cloneCurrentToDraft, updateDraft, deleteDraft, submitRulesVersion,
  addRulesAttachment, removeRulesAttachment, searchRules,
} from '@/app/actions/rules-doc';
import { useConfirm } from '@/components/ui/confirm-provider';
import { cn } from '@/lib/utils';

const STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: 'Approved', cls: 'border-success/20 bg-success/10 text-success' },
  DRAFT: { label: 'Draft', cls: 'bg-muted text-muted-foreground' },
  ARCHIVED: { label: 'Archived', cls: 'bg-muted text-muted-foreground' },
};
const fmt = (d: any) => d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

function printDoc(title: string, html: string, meta: string) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast.error('Allow pop-ups to print or export.'); return; }
  w.document.write(`<!doctype html><html><head><title>${title}</title><meta charset="utf-8"/>
  <style>body{font-family:Georgia,'Times New Roman',serif;max-width:780px;margin:48px auto;padding:0 24px;color:#111;line-height:1.6}
  h1,h2,h3,h4{font-family:Arial,Helvetica,sans-serif;line-height:1.3} h1{font-size:24px} .meta{color:#666;font-size:12px;margin:8px 0 28px;border-bottom:1px solid #ddd;padding-bottom:12px}
  ul,ol{padding-left:24px} blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#555}</style></head>
  <body><h1>${title}</h1><div class="meta">${meta}</div>${html}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
}

export default function RulesClient() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  // Controlled so a data refresh never bounces the user off the tab they're on.
  const [tab, setTab] = useState('current');

  const load = useCallback(() => {
    setLoading(true); setError(false);
    getRulesPage().then(setData).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Refresh in place after edits — keeps the page mounted (no loading screen),
  // so the active tab, selected draft, and editor state all survive.
  const refresh = useCallback(() => {
    getRulesPage().then(setData).catch(() => toast.error('Could not refresh — please reload the page.'));
  }, []);

  if (loading) return <LoadingState label="Loading rules & bylaws…" className="min-h-[60vh]" />;
  if (data?.needsEdir) return <SelectEdirNotice what="rules & bylaws" />;
  if (error || !data) return <ErrorState variant="page" onRetry={load} showContact />;

  const drafts = data.history.filter((v: any) => v.status === 'DRAFT');

  return (
    <div className="space-y-5">
      <PageHeader title="Rules & Bylaws" description="The official rules and bylaws of your Edir. Changes are reviewed and approved before members see them." icon={Scale} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-11 gap-1 rounded-lg p-1">
          <TabsTrigger value="current" className="group gap-1.5 rounded-md px-4">
            <FileText className="h-4 w-4" /> Current Rules
          </TabsTrigger>
          {data.canManage && (
            <TabsTrigger value="editor" className="group gap-1.5 rounded-md px-4">
              <Pencil className="h-4 w-4" /> Editor
              {drafts.length > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary transition-colors group-data-[state=active]:bg-primary-foreground/25 group-data-[state=active]:text-primary-foreground">
                  {drafts.length}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="history" className="group gap-1.5 rounded-md px-4">
            <History className="h-4 w-4" /> Version History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-4"><CurrentTab current={data.current} onView={setViewing} /></TabsContent>
        {data.canManage && <TabsContent value="editor" className="mt-4"><EditorTab data={data} onChanged={refresh} /></TabsContent>}
        <TabsContent value="history" className="mt-4"><HistoryTab history={data.history} canManage={data.canManage} onView={setViewing} onChanged={refresh} /></TabsContent>
      </Tabs>

      {viewing && <ViewDialog version={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

// ─── Current ─────────────────────────────────────────────────────────────────

function MetaChip({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" /> {children}
    </span>
  );
}

function CurrentTab({ current, onView }: { current: any | null; onView: (v: any) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = async () => {
    if (!q.trim()) { setResults(null); return; }
    setSearching(true);
    try { setResults(await searchRules(q)); } catch { toast.error('Search failed.'); } finally { setSearching(false); }
  };

  if (!current) return (
    <Card><CardContent className="p-0"><EmptyState icon={Scale} title="No published rules yet" description="Once an administrator drafts and a checker approves the rules, they will appear here for all members." /></CardContent></Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search rules & versions…" value={q}
            onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runSearch(); }} />
        </div>
        <Button variant="outline" onClick={runSearch} disabled={searching}>Search</Button>
        {results !== null && <Button variant="ghost" onClick={() => { setQ(''); setResults(null); }}>Clear</Button>}
        <div className="ml-auto">
          <Button variant="outline" onClick={() => printDoc(current.title, current.content, `Version ${current.versionNumber} · Effective ${fmt(current.effectiveDate)} · Approved by ${current.approverName ?? '—'}`)}>
            <Printer className="mr-1.5 h-4 w-4" /> Print / Save as PDF
          </Button>
        </div>
      </div>

      {results !== null ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{results.length} result(s) for “{q}”</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {results.length === 0 ? <p className="text-sm text-muted-foreground">No matches found.</p> : results.map(r => (
              <button key={r.id} onClick={() => onView(r)} className="block w-full rounded-md border p-3 text-left hover:bg-muted/50">
                <div className="flex items-center gap-2 text-sm font-medium">v{r.versionNumber} · {r.title} <Badge variant="outline" className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label ?? r.status}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{r.snippet}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BookOpenCheck className="h-6 w-6" />
                </span>
                <div className="space-y-1.5">
                  <CardTitle className="text-xl">{current.title}</CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    <MetaChip icon={FileText}>Version {current.versionNumber}</MetaChip>
                    <MetaChip icon={CalendarDays}>Effective {fmt(current.effectiveDate)}</MetaChip>
                    <MetaChip icon={UserRound}>Approved by {current.approverName ?? '—'} on {fmt(current.approvedAt)}</MetaChip>
                  </div>
                </div>
              </div>
              <Badge variant="outline" className={STATUS.APPROVED.cls}><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> In effect</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: current.content }} />
            {current.attachments.length > 0 && (
              <div className="mt-6 border-t pt-4">
                <div className="mb-2 text-sm font-semibold">Attachments</div>
                <div className="flex flex-wrap gap-2">
                  {current.attachments.map((a: any) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-primary hover:bg-muted/50"><Paperclip className="h-4 w-4" /> {a.name} <ExternalLink className="h-3 w-3" /></a>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  'Write or revise a draft',
  'Submit it for approval',
  'A checker reviews & approves',
  'It becomes the official rules',
];

function EditorTab({ data, onChanged }: { data: any; onChanged: () => void }) {
  const drafts = data.history.filter((v: any) => v.status === 'DRAFT');
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  // Fall back to the first draft when the selected one disappears (e.g. deleted).
  const selected = data.history.find((v: any) => v.id === selectedId) ?? drafts[0] ?? null;

  const newBlank = async () => {
    setBusy(true);
    const res = await createDraft({ title: 'Rules & Bylaws', content: '<h1>Rules &amp; Bylaws</h1><p>Begin writing here…</p>', changeSummary: null, effectiveDate: null });
    setBusy(false);
    if (res?.success) { toast.success('Draft created.'); setSelectedId(res.id); onChanged(); } else toast.error(res?.error || 'Failed.');
  };
  const revise = async () => {
    setBusy(true);
    const res = await cloneCurrentToDraft();
    setBusy(false);
    if (res?.success) { toast.success('Draft created from current version.'); setSelectedId(res.id); onChanged(); } else toast.error(res?.error || 'Failed.');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Start a draft</CardTitle>
            <CardDescription className="text-xs">Drafts stay private until approved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Button onClick={revise} disabled={busy} variant="outline" className="w-full justify-start"><FilePlus2 className="mr-1.5 h-4 w-4 text-primary" /> Revise current version</Button>
            <Button onClick={newBlank} disabled={busy} variant="outline" className="w-full justify-start"><Plus className="mr-1.5 h-4 w-4 text-primary" /> New blank draft</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Drafts{drafts.length > 0 ? ` (${drafts.length})` : ''}</CardTitle></CardHeader>
          <CardContent className="p-2">
            {drafts.length === 0 ? <p className="px-2 py-4 text-center text-xs text-muted-foreground">No drafts yet.</p> : (
              <div className="space-y-1">
                {drafts.map((d: any) => {
                  const active = selected?.id === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      className={cn(
                        'block w-full rounded-md border px-3 py-2.5 text-left transition-colors',
                        active ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'border-transparent hover:bg-muted/60',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('truncate text-sm font-medium', active && 'text-primary')}>v{d.versionNumber} · {d.title}</span>
                        {d.pending && <Badge variant="outline" className="shrink-0 border-warning/20 bg-warning/10 text-warning"><Clock className="mr-1 h-3 w-3" />Pending</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {d.changeSummary || `Last edited ${fmt(d.updatedAt)}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="rounded-lg border border-dashed p-3">
          <p className="mb-2 text-xs font-semibold">How publishing works</p>
          <ol className="space-y-1.5">
            {WORKFLOW_STEPS.map((step, i) => (
              <li key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {selected ? <DraftEditor key={selected.id} draft={selected} onChanged={onChanged} /> : (
        <Card><CardContent className="p-0"><EmptyState icon={Pencil} title="No draft selected" description="Create a new draft or revise the current version to start editing." /></CardContent></Card>
      )}
    </div>
  );
}

function DraftEditor({ draft, onChanged }: { draft: any; onChanged: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [summary, setSummary] = useState(draft.changeSummary ?? '');
  const [effectiveDate, setEffectiveDate] = useState(draft.effectiveDate ? new Date(draft.effectiveDate).toISOString().slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const locked = draft.pending;

  const save = async () => {
    setSaving(true);
    const res = await updateDraft(draft.id, { title, content, changeSummary: summary || null, effectiveDate: effectiveDate || null });
    setSaving(false);
    if (res?.success) { toast.success('Draft saved.'); onChanged(); } else toast.error(res?.error || 'Failed to save.');
  };
  const submit = async () => {
    await save();
    const res = await submitRulesVersion(draft.id, summary || undefined);
    if (res?.success) { toast.success('Submitted for checker approval.'); onChanged(); } else toast.error(res?.error || 'Failed to submit.');
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete draft', description: 'This draft will be permanently deleted.', destructive: true, confirmText: 'Delete' }))) return;
    const res = await deleteDraft(draft.id);
    if (res?.success) { toast.success('Draft deleted.'); onChanged(); } else toast.error(res?.error || 'Failed.');
  };
  const upload = async (file: File) => {
    const fd = new FormData(); fd.append('file', file); fd.append('type', 'rules');
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok || !d.success) { toast.error(d.error || 'Upload failed.'); return; }
    const res = await addRulesAttachment(draft.id, { name: d.name, url: d.path });
    if (res?.success) { toast.success('Attachment added.'); onChanged(); } else toast.error(res?.error || 'Failed.');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Card>
      <CardHeader className="border-b bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Draft v{draft.versionNumber}</CardTitle>
            <CardDescription className="text-xs">Last edited {fmt(draft.updatedAt)}{draft.authorName ? ` · by ${draft.authorName}` : ''}</CardDescription>
          </div>
          {locked && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning"><Clock className="mr-1 h-3.5 w-3.5" /> Awaiting approval — read only</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <fieldset disabled={locked} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Effective Date</Label><Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Change Summary (shown in version history)</Label><Input value={summary} onChange={e => setSummary(e.target.value)} placeholder="What changed in this version?" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Rules Content</Label><RichTextEditor value={content} onChange={setContent} /></div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Attachments</Label>
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Paperclip className="mr-1 h-4 w-4" /> Add attachment</Button>
            </div>
            {draft.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.attachments.map((a: any) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{a.name}</a>
                    <button type="button" onClick={async () => { const res = await removeRulesAttachment(a.id); if (res?.success) onChanged(); else toast.error(res?.error || 'Failed.'); }} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <Button variant="ghost" className="text-destructive" onClick={del} disabled={locked}><Trash2 className="mr-1.5 h-4 w-4" /> Delete draft</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={save} disabled={saving || locked}>Save draft</Button>
            <Button onClick={submit} disabled={saving || locked}><Send className="mr-1.5 h-4 w-4" /> Submit for approval</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

const HISTORY_ICON: Record<string, { icon: any; cls: string }> = {
  APPROVED: { icon: CheckCircle2, cls: 'bg-success/10 text-success' },
  DRAFT: { icon: Pencil, cls: 'bg-muted text-muted-foreground' },
  ARCHIVED: { icon: Archive, cls: 'bg-muted text-muted-foreground' },
};

function HistoryTab({ history, onView }: { history: any[]; canManage: boolean; onView: (v: any) => void; onChanged: () => void }) {
  if (history.length === 0) return <Card><CardContent className="p-0"><EmptyState icon={History} title="No versions yet" /></CardContent></Card>;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        {history.map(v => {
          const marker = HISTORY_ICON[v.status] ?? HISTORY_ICON.DRAFT;
          const MarkerIcon = marker.icon;
          return (
            <div key={v.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', marker.cls)}>
                  <MarkerIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">v{v.versionNumber} · {v.title}</span>
                    <Badge variant="outline" className={STATUS[v.status]?.cls}>{STATUS[v.status]?.label ?? v.status}</Badge>
                    {v.requestStatus === 'PENDING' && <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning">Pending approval</Badge>}
                    {v.requestStatus === 'RETURNED' && <Badge variant="outline" className="border-info/20 bg-info/10 text-info">Returned</Badge>}
                    {v.requestStatus === 'REJECTED' && v.status === 'DRAFT' && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">Rejected</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    By {v.authorName ?? '—'} · Created {fmt(v.createdAt)}
                    {v.approverName && ` · Approved by ${v.approverName} on ${fmt(v.approvedAt)}`}
                    {v.changeSummary && ` · ${v.changeSummary}`}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" onClick={() => onView(v)}><Eye className="mr-1 h-4 w-4" /> View</Button>
                <Button size="sm" variant="ghost" onClick={() => printDoc(v.title, v.content, `Version ${v.versionNumber} · ${STATUS[v.status]?.label ?? v.status}`)}><Printer className="h-4 w-4" /></Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ViewDialog({ version, onClose }: { version: any; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">v{version.versionNumber} · {version.title} <Badge variant="outline" className={STATUS[version.status]?.cls}>{STATUS[version.status]?.label ?? version.status}</Badge></DialogTitle>
        </DialogHeader>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: version.content || '' }} />
        {version.attachments?.length > 0 && (
          <div className="border-t pt-3">
            <div className="mb-1.5 text-sm font-semibold">Attachments</div>
            <div className="flex flex-wrap gap-2">
              {version.attachments.map((a: any) => <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm text-primary hover:bg-muted/50"><Paperclip className="h-3.5 w-3.5" /> {a.name}</a>)}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

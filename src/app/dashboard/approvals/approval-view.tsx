'use client';

/**
 * Beautiful, module-aware detail view shown inside the approval dialog so a
 * checker can see exactly what they're approving — real names, amounts, before→
 * after diffs, and documents — instead of a raw JSON payload. Driven by the
 * resolved `context` from getApprovalDetail (see resolveApprovalContext).
 */

import Link from 'next/link';
import type { ReactNode, ComponentType } from 'react';
import { cn } from '@/lib/utils';
import {
  Wallet, Banknote, Siren, Package, PackageCheck, UserX, Scale, Building2, UserPlus,
  FileText, Network, ArrowRight, ExternalLink, HandCoins, ShieldCheck, User,
} from 'lucide-react';

type Accent = 'primary' | 'success' | 'warning' | 'destructive' | 'info';
type Icon = ComponentType<{ className?: string }>;

const ACCENT: Record<Accent, { chip: string; text: string }> = {
  primary: { chip: 'bg-primary/10 text-primary', text: 'text-primary' },
  success: { chip: 'bg-success/10 text-success', text: 'text-success' },
  warning: { chip: 'bg-warning/10 text-warning', text: 'text-warning' },
  destructive: { chip: 'bg-destructive/10 text-destructive', text: 'text-destructive' },
  info: { chip: 'bg-info/10 text-info', text: 'text-info' },
};

const money = (n: number) => `ETB ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const titleCase = (s: string) => s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

interface Fact { label: string; value: ReactNode; emphasis?: boolean }
interface Change { label: string; before?: ReactNode; after?: ReactNode }
interface Block { label: string; text: string }
interface Subject { icon: Icon; title: string; subtitle?: string; photoUrl?: string | null; href?: string }
interface DocRef { title: string; fileName: string; fileUrl: string; fileType: string; category?: string }
interface ViewModel {
  icon: Icon; accent: Accent;
  subject?: Subject; facts: Fact[]; changes?: Change[]; blocks?: Block[]; document?: DocRef;
  documents?: (DocRef & { status?: string; version?: number })[]; documentsLabel?: string;
}

function changesFrom(obj: Record<string, any> | undefined | null): Change[] | undefined {
  if (!obj || Object.keys(obj).length === 0) return undefined;
  return Object.entries(obj).map(([k, v]) => ({
    label: titleCase(k),
    after: typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '—'),
  }));
}

function buildView(detail: any): ViewModel {
  const p = (detail?.payload ?? {}) as any;
  const ctx = (detail?.context ?? {}) as any;
  const member: Subject | undefined = ctx.member
    ? { icon: User, title: ctx.member.name, subtitle: [ctx.member.code, ctx.member.phone].filter(Boolean).join(' · '), photoUrl: ctx.member.photoUrl }
    : undefined;

  switch (detail?.module) {
    case 'MANUAL_PAYMENT': {
      const facts: Fact[] = [{ label: 'Total', value: money(Number(p.total ?? 0)), emphasis: true }];
      Object.entries((p.breakdown ?? {}) as Record<string, number>)
        .filter(([, v]) => Number(v) > 0)
        .forEach(([k, v]) => facts.push({ label: titleCase(k), value: money(Number(v)) }));
      if (p.method) facts.push({ label: 'Method', value: titleCase(String(p.method)) });
      return { icon: Wallet, accent: 'success', subject: member, facts };
    }
    case 'PENALTY_WAIVER': {
      const facts: Fact[] = [];
      if (p.amount != null) facts.push({ label: 'Waived amount', value: money(Number(p.amount)), emphasis: true });
      return { icon: HandCoins, accent: 'warning', subject: member, facts, blocks: p.reason ? [{ label: 'Reason', text: String(p.reason) }] : undefined };
    }
    case 'EMERGENCY_CLAIM': {
      const c = ctx.claim ?? {};
      const subject: Subject | undefined = c.memberName ? { icon: User, title: c.memberName, subtitle: c.memberCode ?? undefined } : member;
      const facts: Fact[] = [{ label: 'Approved amount', value: money(Number(p.approvedAmount ?? 0)), emphasis: true }];
      if (c.typeName) facts.push({ label: 'Emergency type', value: c.typeName });
      if (c.affectedPerson) facts.push({ label: 'Affected person', value: c.affectedPerson });
      if (c.date) facts.push({ label: 'Incident date', value: new Date(c.date).toLocaleDateString() });
      return { icon: Siren, accent: 'destructive', subject, facts, blocks: c.description ? [{ label: 'Description', text: c.description }] : undefined };
    }
    case 'EMERGENCY_DISBURSEMENT': {
      const c = ctx.claim ?? {};
      const subject: Subject | undefined = c.memberName ? { icon: User, title: c.memberName, subtitle: c.memberCode ?? undefined } : member;
      const facts: Fact[] = [{ label: 'Disbursement', value: money(Number(p.amount ?? 0)), emphasis: true }];
      if (c.approvedAmount != null) facts.push({ label: 'Approved claim', value: money(c.approvedAmount) });
      if (c.typeName) facts.push({ label: 'Emergency type', value: c.typeName });
      return { icon: Banknote, accent: 'success', subject, facts };
    }
    case 'ASSET_ISSUANCE': {
      const i = ctx.issuance ?? {};
      const subject: Subject | undefined = i.assetName
        ? { icon: Package, title: i.assetName, subtitle: i.memberName ? `to ${i.memberName}${i.memberCode ? ` · ${i.memberCode}` : ''}` : undefined }
        : undefined;
      return { icon: Package, accent: 'info', subject, facts: [{ label: 'Quantity', value: String(p.qty ?? i.issuedQty ?? '—'), emphasis: true }] };
    }
    case 'ASSET_RETURN': {
      const i = ctx.issuance ?? {};
      const facts: Fact[] = [{ label: 'Returned qty', value: String(p.returnedQty ?? '—'), emphasis: true }];
      if (p.condition) facts.push({ label: 'Condition', value: titleCase(String(p.condition)) });
      if (Number(p.compensation) > 0) facts.push({ label: 'Compensation', value: money(Number(p.compensation)) });
      const subject: Subject | undefined = i.assetName ? { icon: PackageCheck, title: i.assetName, subtitle: i.memberName ? `from ${i.memberName}` : undefined } : undefined;
      return { icon: PackageCheck, accent: 'info', subject, facts };
    }
    case 'MEMBER_REMOVAL':
      return {
        icon: UserX, accent: 'destructive', subject: member,
        facts: [{ label: 'Action', value: 'Permanent removal', emphasis: true }],
        blocks: detail.summary ? [{ label: 'Reason', text: detail.summary }] : undefined,
      };
    case 'RULE_CHANGE': {
      if (p.kind === 'SETTINGS_BULK') {
        const changes: Change[] = Array.isArray(p.changes)
          ? p.changes.map((c: any) => ({ label: String(c.field), before: String(c.previous ?? '—'), after: String(c.current ?? '—') }))
          : [];
        return {
          icon: Scale, accent: 'primary',
          facts: [{ label: 'Change', value: 'Edir settings update', emphasis: true }, { label: 'Fields', value: String(changes.length) }],
          changes,
          blocks: p.reason ? [{ label: 'Note', text: p.reason }] : undefined,
        };
      }
      if (p.kind === 'SETTING') {
        const fmt = (v: any) => (p.fieldKind === 'money' && v != null && v !== '' && !isNaN(Number(v)) ? money(Number(v)) : String(v ?? '—'));
        return {
          icon: Scale, accent: 'primary',
          facts: [{ label: 'Setting', value: p.label ?? p.field, emphasis: true }],
          changes: [{ label: p.label ?? 'Value', before: fmt(p.previousValue), after: fmt(p.newValue) }],
          blocks: p.comment ? [{ label: 'Note', text: p.comment }] : undefined,
        };
      }
      if (p.kind === 'BYLAW_UPSERT') {
        return {
          icon: Scale, accent: 'primary',
          facts: [{ label: 'Bylaw', value: p.title, emphasis: true }, ...(p.section ? [{ label: 'Section', value: String(p.section) }] : [])],
          blocks: [{ label: 'Proposed content', text: p.content ?? '' }, ...(p.previousValue ? [{ label: 'Previous content', text: p.previousValue }] : [])],
        };
      }
      if (p.kind === 'BYLAW_DELETE') {
        return { icon: Scale, accent: 'destructive', facts: [{ label: 'Repeal bylaw', value: p.title, emphasis: true }], blocks: p.previousValue ? [{ label: 'Current content', text: p.previousValue }] : undefined };
      }
      if (p.kind === 'RULES_VERSION_PUBLISH') {
        return { icon: Scale, accent: 'primary', facts: [{ label: 'Document', value: p.title, emphasis: true }, { label: 'Version', value: `v${p.versionNumber}` }] };
      }
      return { icon: Scale, accent: 'primary', facts: [] };
    }
    case 'EDIR_REGISTRATION': {
      const admin = p.admin ?? {};
      const facts: Fact[] = [];
      if (admin.name) facts.push({ label: 'Managing admin', value: admin.name, emphasis: true });
      if (admin.email) facts.push({ label: 'Email', value: admin.email });
      if (admin.phone) facts.push({ label: 'Phone', value: admin.phone });
      return { icon: Building2, accent: 'primary', subject: { icon: Building2, title: ctx.edirName ?? detail.title, subtitle: 'New Edir registration' }, facts };
    }
    case 'EDIR_UPDATE':
      return {
        icon: Building2, accent: 'info',
        subject: { icon: Building2, title: ctx.edirName ?? 'Edir', subtitle: 'Profile update' },
        facts: [], changes: changesFrom(p.changes),
      };
    case 'USER_CREATION': {
      const facts: Fact[] = [];
      if (p.name) facts.push({ label: 'Name', value: p.name, emphasis: true });
      if (p.email) facts.push({ label: 'Email', value: p.email });
      if (p.phone) facts.push({ label: 'Phone', value: p.phone });
      if (ctx.role?.name) facts.push({ label: 'Role', value: ctx.role.name });
      if (ctx.edirName) facts.push({ label: 'Edir', value: ctx.edirName });
      return { icon: UserPlus, accent: 'primary', facts };
    }
    case 'RELATIVE_DOCUMENT_ACTION': {
      const d = ctx.document as DocRef | undefined;
      const rel = ctx.relative as any | undefined;
      const facts: Fact[] = [];
      if (p.action) facts.push({ label: 'Action', value: titleCase(String(p.action)), emphasis: true });
      if (rel?.relationship) facts.push({ label: 'Relationship', value: titleCase(String(rel.relationship)) });
      if (d?.category) facts.push({ label: 'Category', value: d.category });
      if (rel?.phone) facts.push({ label: 'Phone', value: rel.phone });
      if (rel?.dateOfBirth) facts.push({ label: 'Date of birth', value: new Date(rel.dateOfBirth).toLocaleDateString() });
      if (rel) facts.push({ label: 'Role', value: [rel.isDependent ? 'Dependent' : null, rel.isBeneficiary ? 'Beneficiary' : null].filter(Boolean).join(' · ') || '—' });
      const subject: Subject | undefined = rel
        ? { icon: User, title: rel.name, subtitle: [rel.relationship ? titleCase(String(rel.relationship)) : null, rel.memberName ? `of ${rel.memberName}` : null].filter(Boolean).join(' · ') }
        : member;
      // Every supporting document on file for the dependent (the one under review is
      // shown as the primary document; the rest give the checker full context).
      const supporting = Array.isArray(ctx.relativeDocuments) ? (ctx.relativeDocuments as any[]) : [];
      return { icon: FileText, accent: 'info', subject, facts, changes: changesFrom(p.changes), document: d, documents: supporting, documentsLabel: 'Supporting documents on file' };
    }
    case 'DOCUMENT_ACTION': {
      const d = ctx.document as DocRef | undefined;
      const facts: Fact[] = [];
      if (p.action) facts.push({ label: 'Action', value: titleCase(String(p.action)), emphasis: true });
      if (d?.category) facts.push({ label: 'Category', value: d.category });
      return { icon: FileText, accent: 'info', facts, changes: changesFrom(p.changes), document: d };
    }
    case 'RELATIONSHIP_CATEGORY': {
      const facts: Fact[] = [{ label: 'Action', value: titleCase(String(p.action ?? 'update')), emphasis: true }];
      if (ctx.category?.name) facts.push({ label: 'Category', value: ctx.category.name });
      return { icon: Network, accent: 'primary', facts, changes: changesFrom(p.changes) };
    }
    default:
      return {
        icon: ShieldCheck, accent: 'primary',
        facts: Object.entries(p)
          .filter(([k, v]) => !/id$/i.test(k) && typeof v !== 'object')
          .map(([k, v]) => ({ label: titleCase(k), value: String(v) })),
      };
  }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function SubjectCard({ subject, accent }: { subject: Subject; accent: Accent }) {
  const SIcon = subject.icon;
  const inner = (
    <div className="flex items-center gap-3 rounded-xl border p-3 transition-colors">
      {subject.photoUrl
        ? <img src={subject.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-full border object-cover" />
        : <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', ACCENT[accent].chip)}><SIcon className="h-5 w-5" /></span>}
      <div className="min-w-0">
        <div className="truncate font-medium">{subject.title}</div>
        {subject.subtitle && <div className="truncate text-xs text-muted-foreground">{subject.subtitle}</div>}
      </div>
      {subject.href && <ExternalLink className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />}
    </div>
  );
  return subject.href ? <Link href={subject.href} className="block hover:bg-muted/40">{inner}</Link> : inner;
}

function DocumentCard({ doc }: { doc: DocRef }) {
  return (
    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
       className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40">
      {doc.fileType === 'image'
        ? <img src={doc.fileUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border object-cover" />
        : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info"><FileText className="h-6 w-6" /></span>}
      <div className="min-w-0">
        <div className="truncate font-medium">{doc.title}</div>
        <div className="truncate text-xs text-muted-foreground">{doc.fileName}</div>
      </div>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary"><ExternalLink className="h-3.5 w-3.5" /> Open</span>
    </a>
  );
}

export function ApprovalView({ detail }: { detail: any }) {
  const v = buildView(detail);
  const a = ACCENT[v.accent];
  const Hero = v.icon;
  return (
    <div className="space-y-4">
      {/* Hero — what is being approved */}
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', a.chip)}>
          <Hero className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-snug">{detail.title}</div>
          {detail.summary && <div className="mt-0.5 text-sm text-muted-foreground">{detail.summary}</div>}
        </div>
      </div>

      {v.subject && <SubjectCard subject={v.subject} accent={v.accent} />}

      {v.facts.length > 0 && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
          {v.facts.map((f, i) => (
            <div key={i} className="bg-card px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</div>
              <div className={cn('mt-0.5 break-words text-sm font-medium', f.emphasis && cn('text-base font-bold', a.text))}>{f.value}</div>
            </div>
          ))}
        </div>
      )}

      {v.changes && v.changes.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>Proposed changes</SectionLabel>
          {v.changes.map((c, i) => (
            <div key={i} className="rounded-lg border p-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">{c.label}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {c.before != null && <span className="rounded bg-muted px-2 py-1 text-muted-foreground line-through decoration-destructive/40">{c.before}</span>}
                {c.before != null && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className={cn('rounded px-2 py-1 font-medium', a.chip)}>{c.after ?? '—'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {v.document && <DocumentCard doc={v.document} />}

      {v.documents && v.documents.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>{v.documentsLabel ?? 'Documents'} ({v.documents.length})</SectionLabel>
          <div className="space-y-2">
            {v.documents.map((doc, i) => (
              <a key={i} href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:bg-muted/40">
                {doc.fileType === 'image'
                  ? <img src={doc.fileUrl} alt="" className="h-10 w-10 shrink-0 rounded-md border object-cover" />
                  : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><FileText className="h-5 w-5" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{doc.title}{doc.version && doc.version > 1 ? ` · v${doc.version}` : ''}</div>
                  <div className="truncate text-xs text-muted-foreground">{doc.category}{doc.status ? ` · ${titleCase(String(doc.status))}` : ''}</div>
                </div>
                <ExternalLink className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      {v.blocks?.map((b, i) => (
        <div key={i} className="space-y-1.5">
          <SectionLabel>{b.label}</SectionLabel>
          <div className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">{b.text || '—'}</div>
        </div>
      ))}
    </div>
  );
}

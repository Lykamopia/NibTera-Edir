'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, ArrowLeft, Search, History, Receipt, AlertTriangle, CheckCircle2, XCircle, Building2 } from 'lucide-react';
import { fetchMemberForPayment } from '../actions';
import type { DetailedMember as Member } from '@/lib/data';
import { LangProvider, useLang } from '../i18n';

const money = (n: number, cur = 'ETB') => `${Number(n || 0).toLocaleString()} ${cur}`;
const fmt = (d: any) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Only Paid/Successful and Failed are shown — Pending/Void are hidden so members
// are never misled into thinking an in-progress payment has completed.
const SUCCESS = new Set(['success', 'partial']);
const SHOWN = new Set(['success', 'partial', 'failed']);

export default function HistoryClient() {
  return <LangProvider><HistoryInner /></LangProvider>;
}

function HistoryInner() {
  const { t, lang, setLang } = useLang();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phone = params.get('phone') || '';
    fetchMemberForPayment(phone, params.get('token') || undefined)
      .then(res => { if (res.status === 'success' && res.member) setMember(res.member); else setError(t(`err_${res.status}`)); })
      .catch(() => setError(t('err_error')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => {
    if (!member) return [];
    return member.paymentHistory
      .filter(h => SHOWN.has(h.status)) // hide pending/void
      .filter(h => filter === 'all' ? true : filter === 'success' ? SUCCESS.has(h.status) : h.status === 'failed')
      .filter(h => !query || h.transactionId.toLowerCase().includes(query.toLowerCase()) || h.method.toLowerCase().includes(query.toLowerCase()));
  }, [member, filter, query]);

  const cur = member?.currency ?? 'ETB';

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-muted/30 to-background">
      <div className="mx-auto w-full max-w-md px-4 pb-10 pt-6 sm:pt-10">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/pay" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" /> {t('appTitle')}</Link>
          <div className="flex items-center rounded-lg border bg-card p-0.5 text-xs">
            <button onClick={() => setLang('en')} className={`rounded-md px-2 py-1 font-medium ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>EN</button>
            <button onClick={() => setLang('am')} className={`rounded-md px-2 py-1 font-medium ${lang === 'am' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>አማ</button>
          </div>
        </div>

        <h1 className="mb-3 flex items-center gap-2 text-xl font-bold"><History className="h-5 w-5 text-primary" /> {t('history')}</h1>

        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : error || !member ? (
          <Card><CardContent className="flex flex-col items-center gap-2 p-8 text-center"><AlertTriangle className="h-8 w-8 text-destructive" /><p className="text-sm text-muted-foreground">{error}</p></CardContent></Card>
        ) : (
          <div className="space-y-4">
            {/* Edir + member context */}
            <Card className="overflow-hidden border-primary/20">
              <div className="flex items-center gap-3 bg-gradient-to-r from-primary/10 to-transparent p-3">
                {(member as any).edirLogoUrl ? <img src={(member as any).edirLogoUrl} alt="" className="h-10 w-10 rounded-lg object-contain" /> : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Building2 className="h-5 w-5" /></span>}
                <div className="min-w-0"><div className="truncate text-sm font-bold">{(member as any).edirName}</div><div className="truncate text-xs text-muted-foreground">{member.name} · {member.memberId}</div></div>
              </div>
            </Card>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-1.5">
              {(['all', 'success', 'failed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${filter === f ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
                  {f === 'all' ? 'All' : f === 'success' ? 'Successful' : 'Failed'}
                </button>
              ))}
            </div>

            {items.length === 0 ? (
              <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center"><Receipt className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No transactions found.</p></CardContent></Card>
            ) : (
              <div className="space-y-2">
                {items.map(h => {
                  const ok = SUCCESS.has(h.status);
                  return (
                    <Card key={h.transactionId}>
                      <CardContent className="flex items-center justify-between gap-3 p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>{ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{money(h.amount, cur)}</div>
                            <div className="truncate text-xs text-muted-foreground">{fmt(h.createdAt)} · {h.method}</div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{h.transactionId}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant="outline" className={ok ? 'border-success/20 bg-success/10 text-success' : 'border-destructive/20 bg-destructive/10 text-destructive'}>{ok ? t('PAID') : 'Failed'}</Badge>
                          {h.receiptUrl && <a href={h.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><Receipt className="h-3 w-3" /> Receipt</a>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

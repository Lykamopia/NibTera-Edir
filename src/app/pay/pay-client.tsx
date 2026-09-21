'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2, Wallet, CheckCircle2, AlertTriangle, Search, Phone, RefreshCw, User, CalendarClock,
  TrendingDown, ReceiptText, ShieldAlert, History, Building2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { validateNibToken, fetchMemberForPayment, getPaymentToken, checkTransactionStatus } from './actions';
import type { DetailedMember as Member } from '@/lib/data';
import { payLog, maskToken } from '@/lib/pay-log';
import { LangProvider, useLang } from './i18n';

declare global {
  interface Window { myJsChannel?: { postMessage: (msg: any) => void }; }
}

const money = (n: number, cur = 'ETB') => `${Number(n || 0).toLocaleString()} ${cur}`;
/** Loose phone equality — compares the last 9 significant digits (ignores 0/251/+251 prefixes). */
const sameNumber = (a?: string | null, b?: string | null) => {
  const tail = (s?: string | null) => (s || '').replace(/\D/g, '').slice(-9);
  const ta = tail(a), tb = tail(b);
  return !!ta && ta === tb;
};
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const monthFmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—');
const addMonths = (d: any, n: number) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth() + n, 1); };

export default function PayClient() {
  return <LangProvider><PayInner /></LangProvider>;
}

function PayInner() {
  const { t } = useLang();
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  // The payer = the logged-in Super App user's phone (from the validated token).
  // Preserved separately from `phone`, which the user may change to pay for someone else.
  const [payerPhone, setPayerPhone] = useState<string | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  // A phone can resolve to memberships in several Edirs when the platform allows
  // multi-Edir membership. `choices` holds them all; the payer picks one, and
  // `member` is only set once a single Edir is settled on.
  const [choices, setChoices] = useState<Member[]>([]);
  const [amount, setAmount] = useState('');
  const [fetching, setFetching] = useState(false);
  const [paying, setPaying] = useState(false);
  const [settled, setSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [prevOutstanding, setPrevOutstanding] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [txn, setTxn] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    payLog('client/init', 'Pay page mounted', { url: window.location.href, hasTokenParam: !!params.get('token'), phoneParam: params.get('phone'), myJsChannelPresent: typeof window.myJsChannel?.postMessage === 'function' });
    if (typeof window.myJsChannel?.postMessage !== 'function') payLog('client/init', '⚠ window.myJsChannel NOT present — Step 4 (handoff to Super App) will be unavailable unless opened inside the NIB Super App.');
    validateNibToken(params.get('token') || undefined)
      .then((res) => {
        payLog('client/init', 'validateNibToken result', { status: res.status, phone: (res as any).phone });
        if (res.status === 'success') { setToken(res.token || null); setPayerPhone(res.phone || null); setPhone(res.phone || params.get('phone') || ''); setSessionReady(true); }
        else { setSessionReady(false); setPhone(params.get('phone') || ''); }
      })
      .catch((e) => { payLog('client/init', 'validateNibToken threw', String(e)); setSessionReady(false); });
    return () => { esRef.current?.close(); };
  }, []);

  const fetchMember = async () => {
    if (!phone.trim()) { setError(t('err_enterPhone')); return; }
    payLog('client/fetch', 'Fetch clicked', { phone: phone.trim() });
    setFetching(true); setError(''); setMember(null); setChoices([]); setSettled(false);
    const res = await fetchMemberForPayment(phone.trim(), token || undefined);
    setFetching(false);
    payLog('client/fetch', 'result', { status: res.status });
    if (res.status === 'success' && res.member) {
      if (res.token) setToken(res.token);
      const found = ((res as any).members as Member[] | undefined) ?? [res.member];
      if (found.length > 1) {
        // Several Edirs — ask which one before showing any amount.
        payLog('client/fetch', 'multiple memberships → showing Edir picker', found.map(m => m.edirName));
        setChoices(found);
      } else {
        selectMembership(found[0]);
      }
    } else {
      setError(t(`err_${res.status}`));
    }
  };

  /**
   * Commit to one Edir's membership. Defaults the payable amount to the FULL dues
   * total — every obligation the shared calculator summed: contribution arrears
   * (all unpaid months), late penalty, reinstatement fee (if suspended/terminated),
   * and the pooled balance (registration + event/asset charges).
   */
  const selectMembership = (m: Member) => {
    setChoices([]);
    setMember(m);
    setError('');
    setAmount(String(Number((m as any).dues?.total ?? m.totalOutstanding)));
  };

  const reset = () => { setMember(null); setChoices([]); setAmount(''); setError(''); setTxn(null); setSettled(false); setPaidAmount(null); setPrevOutstanding(null); setRefreshing(false); };

  const pay = async () => {
    if (!member) return;
    if ((member as any).canAcceptPayments === false) { setError((member as any).paymentAccountReason || t('err_noAccount')); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError(t('err_amount')); return; }
    payLog('client/pay', 'Pay clicked', { amount: amt, memberId: member.memberId, token: maskToken(token) });
    setPaying(true); setError('');
    setPaidAmount(amt); setPrevOutstanding(Number(member.totalOutstanding));
    const memberPhone = member.phone || '';

    // Carry the itemized breakdown so settlement (and the receipt) records exactly
    // what each birr paid for — contributions, late penalty, reinstatement, and
    // pooled charges — from the shared dues calculator.
    const bd = (member as any).dues?.breakdown ?? {};
    const res = await getPaymentToken(amt, token || '', member.id, member.edirId, {
      source: 'mini-app',
      outstanding: member.totalOutstanding, monthlyFee: member.monthlyFee,
      installment: Number(bd.installment ?? 0), arrears: Number(bd.arrears ?? 0),
      latePenalty: Number(bd.latePenalty ?? (member as any).penalty?.amount ?? 0),
      serviceFees: Number(bd.serviceFees ?? 0), other: Number(bd.other ?? 0),
    });
    payLog('client/pay', 'getPaymentToken result', { status: res.status, transactionId: res.transactionId, paymentToken: maskToken((res as any).paymentToken) });
    if (res.status !== 'success' || !res.transactionId) { setPaying(false); setError(res.message || t('err_startFailed')); return; }
    setTxn(res.transactionId);

    const channel = typeof window !== 'undefined' ? window.myJsChannel : undefined;
    if (channel?.postMessage) {
      payLog('client/pay', 'STEP 4 → posting payment token to window.myJsChannel');
      try { channel.postMessage({ token: (res as any).paymentToken }); payLog('client/pay', 'STEP 4 postMessage(object) sent'); }
      catch (e) {
        payLog('client/pay', 'STEP 4 postMessage(object) threw — retrying as JSON string', String(e));
        try { channel.postMessage(JSON.stringify({ token: (res as any).paymentToken })); payLog('client/pay', 'STEP 4 postMessage(string) sent'); }
        catch (e2) { payLog('client/pay', 'STEP 4 postMessage(string) also threw', String(e2)); }
      }
    } else {
      payLog('client/pay', '⛔ STEP 4 SKIPPED — window.myJsChannel not found.');
      setPaying(false); setError(t('err_channel')); return;
    }

    let done = false;
    const paidMemberId = member.id;
    const finishSuccess = async () => {
      if (done) return; done = true;
      payLog('client/sse', 'settlement detected → refreshing member figures');
      setSettled(true); setPaying(false); es.close();
      setRefreshing(true);
      try {
        const fresh = await fetchMemberForPayment(memberPhone, token || undefined);
        if (fresh.status === 'success' && fresh.member) {
          // Re-select the SAME Edir we just paid — a multi-Edir payer must not be
          // silently switched to another membership on refresh.
          const list = ((fresh as any).members as Member[] | undefined) ?? [fresh.member];
          const same = list.find(m => m.id === paidMemberId) ?? fresh.member;
          setMember(same);
          payLog('client/sse', 'member refreshed', { edirName: same.edirName, newOutstanding: same.totalOutstanding });
        }
      } catch (e) { payLog('client/sse', 'refresh failed', String(e)); }
      finally { setRefreshing(false); }
    };

    const sseUrl = `/api/payment-events?transactionId=${res.transactionId}&phone=${encodeURIComponent(member.phone || '')}&previousOutstanding=${member.totalOutstanding}`;
    payLog('client/pay', 'opening SSE', { sseUrl });
    const es = new EventSource(sseUrl);
    esRef.current = es;
    es.onopen = () => payLog('client/sse', 'SSE open');
    es.onmessage = (ev) => {
      payLog('client/sse', 'SSE message', ev.data);
      try {
        const data = JSON.parse(ev.data);
        if (data.status === 'success' || data.status === 'partial' || data.outstandingChanged) finishSuccess();
        else if (data.status === 'failed' || data.status === 'void') { payLog('client/sse', 'failed/void'); setPaying(false); setError(t('err_notCompleted')); es.close(); }
      } catch { /* keep-alive */ }
    };
    es.onerror = (e) => payLog('client/sse', 'SSE error', String(e));

    let polls = 0;
    const poll = setInterval(async () => {
      if (done || polls++ > 30) { clearInterval(poll); return; }
      try {
        const s = await checkTransactionStatus(res.transactionId!);
        payLog('client/pay', `fallback status check #${polls}`, s);
        if (s.status === 'success' || s.status === 'partial') { clearInterval(poll); finishSuccess(); }
        else if (s.status === 'failed' || s.status === 'void') { clearInterval(poll); if (!done) { setPaying(false); setError(t('err_notCompleted')); } }
      } catch { /* ignore */ }
    }, 5000);
  };

  // ── Settled ──
  if (settled) {
    const m: any = member;
    const newBalance = m ? Number(m.totalOutstanding) : 0;
    return (
      <Shell edir={m}>
        <Card className="page-enter overflow-hidden">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success"><CheckCircle2 className="h-9 w-9" /></span>
            <h2 className="text-lg font-bold">{t('received')}</h2>
            {paidAmount != null && <p className="text-sm text-muted-foreground">{m?.name ? `${m.name} · ` : ''}{t('youPaid')} <span className="font-semibold text-foreground">{money(paidAmount, m?.currency)}</span></p>}
          </CardContent>
          <div className="border-t bg-muted/30 p-4">
            {refreshing ? <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('updating')}</div> : m && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{t('prevBalance')}</span><span className="text-muted-foreground line-through">{money(prevOutstanding ?? 0, m.currency)}</span></div>
                <div className="flex items-center justify-between"><span className="text-sm font-medium">{t('newBalance')}</span><span className={`text-lg font-bold ${newBalance > 0 ? 'text-warning' : 'text-success'}`}>{money(newBalance, m.currency)}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{t('contributionStatus')}</span><Badge variant="outline" className={m.contributionStatus === 'PAID' ? 'border-success/20 bg-success/10 text-success' : 'border-warning/20 bg-warning/10 text-warning'}>{t(m.contributionStatus)}</Badge></div>
                {m?.contributionCoverage?.paidThrough && (
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{t('paidThrough')}</span><span className="font-semibold text-success">{monthFmt(m.contributionCoverage.paidThrough)}</span></div>
                )}
                {m?.payWindow?.blocked && m.payWindow.availableAt ? (
                  // The advance-payment window is now closed — say when it reopens
                  // instead of inviting an immediate pay-ahead.
                  <div className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
                    {t('payWindowOpens').replace('{date}', new Date(m.payWindow.availableAt).toLocaleDateString(undefined, { dateStyle: 'long' }))}
                  </div>
                ) : m?.contributionCoverage?.nextDue && (
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{t('payAheadFor')}</span><span className="font-semibold">{monthFmt(m.contributionCoverage.nextDue)}</span></div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2 p-4">
            {txn && <p className="text-center font-mono text-[11px] text-muted-foreground">{t('ref')}: {txn}</p>}
            <Button variant="outline" className="w-full" onClick={reset}><Search className="mr-1.5 h-4 w-4" /> {t('makeAnother')}</Button>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell edir={member as any}>
      <Card className="page-enter">
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('phoneLabel')}</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-12 pl-9 text-base" inputMode="tel" placeholder="09xxxxxxxx" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchMember(); }} disabled={paying} />
            </div>
            <p className="text-[11px] text-muted-foreground">{t('phoneHelp')}</p>
          </div>
          <Button className="h-12 w-full text-base" onClick={fetchMember} disabled={fetching || paying}>
            {fetching ? <Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> : <Search className="mr-1.5 h-5 w-5" />} {t('fetchBtn')}
          </Button>
          {sessionReady === false && !member && <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-[11px] text-warning"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('sessionWarn')}</div>}
          {error && !member && <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>}
        </CardContent>
      </Card>

      {fetching && !member && <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}
      {choices.length > 1 && <EdirChoicePanel choices={choices} onSelect={selectMembership} />}
      {member && <MemberPanel member={member} payerPhone={payerPhone} amount={amount} setAmount={setAmount} paying={paying} error={error} txn={txn} onPay={pay} onChange={reset} />}
    </Shell>
  );
}

/**
 * Edir picker — shown only when one phone resolves to memberships in several
 * Edirs. Each row carries the figures the payer needs to tell them apart: the
 * Edir, their membership code and standing there, and what is outstanding.
 */
function EdirChoicePanel({ choices, onSelect }: { choices: Member[]; onSelect: (m: Member) => void }) {
  const { t } = useLang();
  return (
    <Card className="page-enter mt-4">
      <CardContent className="space-y-3 p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Building2 className="h-4 w-4 text-primary" /> {t('chooseEdirTitle')}</h2>
          <p className="text-[11px] text-muted-foreground">{t('chooseEdirDesc')}</p>
        </div>
        <div className="space-y-2">
          {choices.map(m => {
            const due = Number((m as any).dues?.total ?? m.totalOutstanding);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(m)}
                aria-label={`${t('chooseEdirCta')} — ${m.edirName}`}
                className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {m.edirLogoUrl
                  ? <img src={m.edirLogoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                  : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10"><Building2 className="h-4 w-4 text-primary" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.edirName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{m.memberId} · {m.status}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{t('outstanding')}</span>
                  <span className={`block text-sm font-semibold tabular-nums ${due > 0 ? 'text-destructive' : 'text-success'}`}>{money(due, m.currency)}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Shell({ children, edir }: { children: React.ReactNode; edir?: { edirName?: string; edirLogoUrl?: string | null } | null }) {
  const { t, lang, setLang } = useLang();
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-muted/30 to-background">
      <div className="mx-auto w-full max-w-md px-4 pb-28 pt-6 sm:pt-10">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            {edir?.edirLogoUrl
              ? <img src={edir.edirLogoUrl} alt={edir.edirName} className="h-10 w-10 rounded-xl object-contain" />
              : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Wallet className="h-5 w-5" /></span>}
            <div>
              <h1 className="text-lg font-bold leading-tight">{edir?.edirName || t('appTitle')}</h1>
              <p className="text-xs text-muted-foreground">{t('appSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center rounded-lg border bg-card p-0.5 text-xs">
            <button onClick={() => setLang('en')} className={`rounded-md px-2 py-1 font-medium transition-colors ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>EN</button>
            <button onClick={() => setLang('am')} className={`rounded-md px-2 py-1 font-medium transition-colors ${lang === 'am' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>አማ</button>
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

function MemberPanel({ member, payerPhone, amount, setAmount, paying, error, txn, onPay, onChange }: {
  member: Member; payerPhone: string | null; amount: string; setAmount: (v: string) => void; paying: boolean; error: string; txn: string | null; onPay: () => void; onChange: () => void;
}) {
  const { t } = useLang();
  const cur = member.currency;
  const m = member as any;
  // Suggested total = the full itemized dues (all obligations), consistent with
  // the default amount and the staff record dialog.
  const dues = m.dues ?? {};
  const amountDue = Number(dues.total ?? (Number(m.totalOutstanding) + Number(m.monthlyFee)));
  // On-behalf detection: the fetched member's phone differs from the payer's phone.
  const onBehalf = !!payerPhone && !sameNumber(payerPhone, m.phone);
  // Per-tenant payment availability — the member's Edir must be active with a
  // configured payment account. The server re-enforces this in getPaymentToken.
  const canPay = m.canAcceptPayments !== false;

  // Has this member already settled the CURRENT calendar month? `paidThrough` is
  // the latest fully-paid month; if it's the current month (or later, i.e. paid
  // ahead) they are up to date and the next payable month is `nextDue`.
  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const cov = m.contributionCoverage || {};
  const paidThrough = cov.paidThrough ? new Date(cov.paidThrough) : null;
  const settledThisMonth = !!paidThrough && paidThrough >= thisMonthStart;
  const nextDue = cov.nextDue ?? null;

  // Advance-payment window (Edir setting): while closed, the member is fully
  // settled and the pay option is hidden entirely — only the settled state and
  // when the next payment opens are shown. The server enforces the same gate.
  const win = m.payWindow || {};
  const opensDate = win.availableAt ? new Date(win.availableAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : '';

  // Membership standing: a TERMINATED membership can never pay (the server
  // enforces this too); a SUSPENDED member CAN pay — that's the path back.
  const terminated = m.status === 'TERMINATED';
  const suspended = m.status === 'SUSPENDED';
  const payClosed = !!win.blocked || terminated;

  return (
    <>
      {/* Who you are paying for — explicit when it differs from your own number */}
      <div className={`page-enter flex items-start gap-2 rounded-lg border p-3 text-xs ${onBehalf ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/20 bg-success/10 text-success'}`}>
        {onBehalf ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
        <div>
          <div className="font-semibold">{onBehalf ? t('onBehalfTitle') : t('payingForSelf')}</div>
          {onBehalf && <div className="mt-0.5 text-foreground/80">{t('onBehalfDesc')}</div>}
        </div>
      </div>

      {/* Edir identity — which Edir you are paying for */}
      <Card className="page-enter overflow-hidden border-primary/20">
        <div className="flex items-center gap-3 bg-gradient-to-r from-primary/10 to-transparent p-3">
          {m.edirLogoUrl ? <img src={m.edirLogoUrl} alt={m.edirName} className="h-11 w-11 rounded-lg object-contain" /> : <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary"><Building2 className="h-5 w-5" /></span>}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('payingFor')}</div>
            <div className="truncate text-base font-bold">{m.edirName}</div>
          </div>
        </div>
      </Card>

      {/* Edir cannot accept payments — no active/configured payment account */}
      {!canPay && (
        <div className="page-enter flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">{t('accountUnavailableTitle')}</div>
            <div className="mt-0.5 text-foreground/80">{m.paymentAccountReason || t('err_noAccount')}</div>
          </div>
        </div>
      )}

      {/* Member identity */}
      <Card className="page-enter overflow-hidden">
        <div className="flex items-center gap-3 border-b bg-muted/40 p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><User className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="truncate font-semibold">{m.name}</span><Badge variant="outline" className={m.status === 'ACTIVE' ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{t(m.status)}</Badge></div>
            <div className="font-mono text-xs text-muted-foreground">{m.memberId} · {m.phone}</div>
          </div>
          <button onClick={onChange} className="flex items-center gap-1 text-xs text-primary"><RefreshCw className="h-3.5 w-3.5" /> {t('change')}</button>
        </div>
        <CardContent className="grid grid-cols-2 gap-3 p-4">
          <Stat label={t('outstanding')} value={money(m.totalOutstanding, cur)} icon={TrendingDown} tone={m.totalOutstanding > 0 ? 'warn' : 'ok'} />
          <Stat label={t('monthlyFee')} value={money(m.monthlyFee, cur)} icon={ReceiptText} />
          <Stat label={t('monthsBehind')} value={String(m.monthsBehind)} icon={CalendarClock} tone={m.monthsBehind > 0 ? 'warn' : 'ok'} />
          <Stat label={t('contribution')} value={t(m.contributionStatus)} icon={CheckCircle2} tone={m.contributionStatus === 'PAID' ? 'ok' : 'warn'} />
        </CardContent>
      </Card>

      {/* Membership terminated — no longer a member, NO pay option */}
      {terminated && (
        <Card className="page-enter overflow-hidden border-destructive/30">
          <div className="flex flex-col items-center gap-2 bg-destructive/10 p-5 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/15 text-destructive"><AlertTriangle className="h-8 w-8" /></span>
            <h3 className="text-base font-bold text-destructive">{t('terminatedTitle')}</h3>
            <p className="max-w-sm text-sm text-foreground/80">{t('terminatedMsg').replace('{edir}', m.edirName ?? 'the Edir')}</p>
          </div>
        </Card>
      )}

      {/* Membership suspended — paying the dues (incl. reinstatement fee) is the way back */}
      {suspended && (
        <div className="page-enter flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-warning">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t('suspendedTitle')}</div>
            <div className="mt-0.5 text-xs text-foreground/80">{t('suspendedMsg')}</div>
          </div>
        </div>
      )}

      {/* Advance-payment window closed — settled state, descriptive message, NO pay option */}
      {!terminated && payClosed && (
        <Card className="page-enter overflow-hidden border-success/30">
          <div className="flex flex-col items-center gap-2 bg-success/10 p-5 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success"><CheckCircle2 className="h-8 w-8" /></span>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-success">{t('payWindowTitle')}</h3>
              <Badge variant="outline" className="border-success/30 bg-success/10 text-success">{t('payWindowBadge')}</Badge>
            </div>
            <p className="max-w-sm text-sm text-foreground/80">
              {t('payWindowBody').replace('{month}', nextDue ? monthFmt(nextDue) : monthFmt(addMonths(thisMonthStart, 1))).replace('{date}', opensDate)}
            </p>
            <p className="text-xs text-muted-foreground">{t('payWindowNoPay')}</p>
          </div>
          <div className="flex items-center justify-between border-t bg-card px-4 py-2.5 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="h-4 w-4" /> {t('paidThrough')}</span>
            <span className="font-semibold text-success">{paidThrough ? monthFmt(paidThrough) : '—'}</span>
          </div>
        </Card>
      )}

      {/* This-month settlement — clear confirmation + the next payable month */}
      {settledThisMonth && !payClosed && (
        <div className="page-enter flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3.5 text-success">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{monthFmt(thisMonthStart)} {t('settledWord')} · {t('upToDateMsg')}</div>
            <div className="mt-0.5 text-xs text-foreground/80">
              {nextDue ? `${t('payAheadFor')} ${monthFmt(nextDue)}` : t('upToDate')}
            </div>
          </div>
        </div>
      )}

      {/* Contribution coverage — which months are paid / being paid */}
      <CoverageCard member={member} amount={amount} />

      {/* What You Owe — aggregated obligations (hidden while the pay window is closed) */}
      {!payClosed && (
      <Card className="page-enter">
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">{t('obligations')}</h3>

          {/* Itemized dues — every line adds up to the suggested total below. */}
          <div className="space-y-1.5">
            {Number(dues.contributionArrears) > 0 && (
              <Line label={`${t('contributionsArrears')}${dues.monthsBehind ? ` (${dues.monthsBehind} ${t('monthsUnit')})` : ''}`} value={money(dues.contributionArrears, cur)} />
            )}
            {Number(dues.latePenalty) > 0 && <Line label={t('penaltyTitle')} value={money(dues.latePenalty, cur)} warn />}
            {Number(dues.reinstatementFee) > 0 && <Line label={t('reinstatementFee')} value={money(dues.reinstatementFee, cur)} warn />}
            {Number(dues.otherCharges) > 0 && <Line label={t('outstandingBalance')} value={money(dues.otherCharges, cur)} />}
            {Number(dues.total || 0) === 0 && <Line label={t('thisMonth')} value={money(m.monthlyFee, cur)} />}
          </div>

          {/* Installment summary */}
          {m.installmentSummary && (
            <Section title={t('installments')} icon={CalendarClock} badge={`${m.installmentSummary.paid}/${m.installmentSummary.total}`} defaultOpen>
              <div className="grid grid-cols-3 gap-2">
                <Mini label={t('totalInstallments')} value={String(m.installmentSummary.total)} />
                <Mini label={t('paidInstallments')} value={String(m.installmentSummary.paid)} tone="ok" />
                <Mini label={t('remainingInstallments')} value={String(m.installmentSummary.remaining)} tone={m.installmentSummary.remaining > 0 ? 'warn' : 'ok'} />
              </div>
              <div className="mt-2 space-y-1.5">
                <Line label={t('nextInstallment')} value={m.installmentSummary.nextDueDate ? `${money(m.installmentSummary.nextAmount, cur)} · ${fmt(m.installmentSummary.nextDueDate)}` : '—'} />
                <Line label={t('installmentOutstanding')} value={money(m.installmentSummary.outstanding, cur)} />
              </div>
            </Section>
          )}

          {/* Penalties & charges */}
          {(m.penalty || m.eventPenalties.length > 0 || m.assetPenalties.length > 0 || m.reinstatementFee > 0) ? (
            <Section title={t('chargesTitle')} icon={AlertTriangle} tone="warn"
              badge={money(
                (m.penalty?.amount || 0) + m.eventPenalties.reduce((s: number, e: any) => s + e.amount, 0) + m.assetPenalties.reduce((s: number, a: any) => s + a.amount, 0) + (m.reinstatementFee || 0), cur)}
              defaultOpen>
              <div className="space-y-2">
                {m.penalty && (
                  <Charge label={t('penaltyTitle')} amount={money(m.penalty.amount, cur)} tag={t('additional')}
                    rows={[[t('penaltyRule'), m.penalty.rule], [t('penaltyOverdue'), `${m.penalty.overdueDays} ${t('days')}`], [t('penaltyHow'), m.penalty.calculation]]} />
                )}
                {m.eventPenalties.map((e: any) => (
                  <Charge key={e.id} label={`${t('eventAbsence')}`} amount={money(e.amount, cur)} tag={t('includedInBalance')}
                    rows={[[t('penaltyReason'), e.event], [t('date'), fmt(e.date)]]} />
                ))}
                {m.assetPenalties.map((a: any) => (
                  <Charge key={a.id} label={t('assetCompensation')} amount={money(a.amount, cur)} tag={t('includedInBalance')}
                    rows={[[t('penaltyReason'), a.asset], [t('date'), fmt(a.date)]]} />
                ))}
                {m.reinstatementFee > 0 && (
                  <Charge label={t('reinstatementFee')} amount={money(m.reinstatementFee, cur)} tag={t('additional')}
                    rows={[[t('penaltyReason'), `${t('status')}: ${t(m.status)}`]]} />
                )}
              </div>
            </Section>
          ) : (
            <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">✓ {t('noCharges')}</p>
          )}

          {/* Suggested total + amount */}
          <div className="flex items-center justify-between border-t pt-3"><span className="text-sm font-medium">{t('suggestedTotal')}</span><span className="font-semibold">{money(amountDue, cur)}</span></div>
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs">{t('amountToPay')} ({cur})</Label>
            <Input className="h-12 text-base font-semibold" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} disabled={paying} />
            <p className="text-[11px] text-muted-foreground">{t('amountHelp')}</p>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Link to dedicated history page */}
      <Link href={`/pay/history?phone=${encodeURIComponent(m.phone || '')}&edirId=${encodeURIComponent(m.edirId || '')}`} className="block">
        <Card className="page-enter card-interactive">
          <CardContent className="flex items-center justify-between p-4 text-sm">
            <span className="flex items-center gap-2 font-medium"><History className="h-4 w-4 text-primary" /> {t('viewHistory')}</span>
            <span className="text-muted-foreground">→</span>
          </CardContent>
        </Card>
      </Link>

      {error && <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>}

      {/* Sticky pay bar — replaced by an informational strip while the pay window is closed */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/90 p-3 backdrop-blur-md">
        <div className="mx-auto w-full max-w-md">
          {terminated ? (
            <div className="flex h-14 items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 text-sm font-medium text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span className="truncate">{t('terminatedTitle')}</span>
            </div>
          ) : payClosed ? (
            <div className="flex h-14 items-center justify-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 text-sm font-medium text-success">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="truncate">{t('payWindowOpens').replace('{date}', opensDate)}</span>
            </div>
          ) : (
            <>
              <Button className="h-14 w-full text-base font-semibold shadow-lg" onClick={onPay} disabled={paying || Number(amount) <= 0 || !canPay}>
                {paying ? <><Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> {t('processing')}</> : !canPay ? <><AlertTriangle className="mr-1.5 h-5 w-5" /> {t('payUnavailable')}</> : <><Wallet className="mr-1.5 h-5 w-5" /> {t('pay')} {money(Number(amount) || 0, cur)}</>}
              </Button>
              {txn && <p className="mt-1 text-center font-mono text-[10px] text-muted-foreground">{t('ref')}: {txn}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CoverageCard({ member, amount }: { member: Member; amount: string }) {
  const { t } = useLang();
  const m = member as any;
  const cov = m.contributionCoverage || { monthsPaid: 0, paidThrough: null, nextDue: null };
  const amt = Number(amount) || 0;
  const monthsThisPays = m.monthlyFee > 0 ? Math.floor(amt / m.monthlyFee) : 0;
  const coverTo = monthsThisPays > 1 && cov.nextDue ? addMonths(cov.nextDue, monthsThisPays - 1) : cov.nextDue;
  return (
    <Card className="page-enter">
      <CardContent className="space-y-2.5 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> {t('coverageTitle')}</h3>
        <Line label={t('paidThrough')} value={cov.paidThrough ? monthFmt(cov.paidThrough) : t('noMonthsYet')} />
        <Line label={t('nextDueMonth')} value={cov.nextDue ? monthFmt(cov.nextDue) : t('upToDate')} />
        {monthsThisPays > 0 && cov.nextDue && (
          <div className="rounded-md bg-primary/5 px-3 py-2 text-xs">
            <span className="font-semibold text-primary">{t('thisPaysFor')} {monthsThisPays} {t('monthsUnit')}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-medium">{monthFmt(cov.nextDue)}{monthsThisPays > 1 ? ` – ${monthFmt(coverTo)}` : ''}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string; icon: any; tone?: 'ok' | 'warn' }) {
  const toneCls = tone === 'warn' ? 'text-warning' : tone === 'ok' ? 'text-success' : 'text-foreground';
  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <div className={`mt-0.5 text-base font-bold ${toneCls}`}>{value}</div>
    </div>
  );
}
function Line({ label, value, muted, warn }: { label: string; value: string; muted?: boolean; warn?: boolean }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className={warn ? 'font-medium text-warning' : muted ? 'text-muted-foreground' : 'font-medium'}>{value}</span></div>;
}

function Section({ title, icon: Icon, badge, tone, defaultOpen, children }: { title: string; icon: any; badge?: string; tone?: 'warn'; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-lg border">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between p-2.5 text-sm">
        <span className={`flex items-center gap-1.5 font-medium ${tone === 'warn' ? 'text-warning' : ''}`}><Icon className="h-4 w-4" /> {title}</span>
        <span className="flex items-center gap-2">{badge && <span className="text-xs font-semibold">{badge}</span>}<ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && <div className="border-t p-2.5">{children}</div>}
    </div>
  );
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const c = tone === 'warn' ? 'text-warning' : tone === 'ok' ? 'text-success' : '';
  return <div className="rounded-md border p-2 text-center"><div className="text-[10px] text-muted-foreground">{label}</div><div className={`text-base font-bold ${c}`}>{value}</div></div>;
}
function Charge({ label, amount, tag, rows }: { label: string; amount: string; tag: string; rows: [string, string][] }) {
  return (
    <div className="rounded-md border bg-card p-2.5 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span><span className="font-bold text-warning">{amount}</span></span>
      </div>
      {rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-3"><span className="shrink-0 text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>)}
    </div>
  );
}

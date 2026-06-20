'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2, Wallet, CheckCircle2, AlertTriangle, Search, Phone, RefreshCw, User, CalendarClock,
  TrendingDown, ReceiptText, ShieldAlert, ChevronRight, History,
} from 'lucide-react';
import { validateNibToken, fetchMemberForPayment, getPaymentToken, checkTransactionStatus } from './actions';
import type { DetailedMember as Member } from '@/lib/data';
import { payLog, maskToken } from '@/lib/pay-log';

declare global {
  interface Window {
    myJsChannel?: { postMessage: (msg: any) => void };
  }
}
const money = (n: number, cur = 'ETB') => `${Number(n || 0).toLocaleString()} ${cur}`;
const fmt = (d: any) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');

export default function PayClient() {
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [member, setMember] = useState<Member | null>(null);
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
    payLog('client/init', 'Pay page mounted', {
      url: window.location.href,
      hasTokenParam: !!params.get('token'),
      phoneParam: params.get('phone'),
      myJsChannelPresent: typeof window.myJsChannel?.postMessage === 'function',
    });
    if (typeof window.myJsChannel?.postMessage !== 'function') {
      payLog('client/init', '⚠ window.myJsChannel NOT present — Step 4 (handoff to Super App) will be unavailable unless opened inside the NIB Super App.');
    }
    validateNibToken(params.get('token') || undefined)
      .then((res) => {
        payLog('client/init', 'validateNibToken result', { status: res.status, phone: (res as any).phone, message: (res as any).message });
        if (res.status === 'success') {
          setToken(res.token || null);
          setPhone(res.phone || params.get('phone') || '');
          setSessionReady(true);
        } else {
          setSessionReady(false);
          setPhone(params.get('phone') || '');
        }
      })
      .catch((e) => { payLog('client/init', 'validateNibToken threw', String(e)); setSessionReady(false); });
    return () => { esRef.current?.close(); };
  }, []);

  const fetchMember = async () => {
    if (!phone.trim()) { setError('Please enter a phone number.'); return; }
    payLog('client/fetch', 'Fetch Member Data clicked', { phone: phone.trim() });
    setFetching(true); setError(''); setMember(null); setSettled(false);
    const res = await fetchMemberForPayment(phone.trim(), token || undefined);
    setFetching(false);
    payLog('client/fetch', 'fetchMemberForPayment result', { status: res.status, message: (res as any).message, member: res.status === 'success' ? { id: res.member?.id, memberId: res.member?.memberId } : undefined });
    if (res.status === 'success' && res.member) {
      setMember(res.member);
      if (res.token) setToken(res.token);
      setAmount(String(Number(res.member.totalOutstanding) + Number(res.member.monthlyFee)));
    } else {
      setError(res.message || 'Could not find member details.');
    }
  };

  const reset = () => { setMember(null); setAmount(''); setError(''); setTxn(null); setSettled(false); setPaidAmount(null); setPrevOutstanding(null); setRefreshing(false); };

  const pay = async () => {
    if (!member) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('Enter an amount greater than zero.'); return; }
    payLog('client/pay', 'Pay clicked', { amount: amt, memberId: member.memberId, token: maskToken(token) });
    setPaying(true); setError('');
    setPaidAmount(amt); setPrevOutstanding(Number(member.totalOutstanding));
    const memberPhone = member.phone || '';

    // ── Step 3: obtain a payment token from NIB (creates a PENDING PaymentLog). ──
    const res = await getPaymentToken(amt, token || '', member.id, member.edirId, { source: 'mini-app', outstanding: member.totalOutstanding, monthlyFee: member.monthlyFee });
    payLog('client/pay', 'getPaymentToken result', { status: res.status, transactionId: res.transactionId, paymentToken: maskToken((res as any).paymentToken), message: (res as any).message });
    if (res.status !== 'success' || !res.transactionId) {
      setPaying(false); setError(res.message || 'Failed to start payment.'); return;
    }
    setTxn(res.transactionId);

    // ── Step 4: hand the payment token back to the NIB Super App over its JS
    // channel — THIS is what actually charges the customer. Without it the page
    // just waits forever for a callback that never comes.
    const channel = typeof window !== 'undefined' ? window.myJsChannel : undefined;
    if (channel?.postMessage) {
      payLog('client/pay', 'STEP 4 → posting payment token to window.myJsChannel', { paymentToken: maskToken((res as any).paymentToken) });
      try {
        channel.postMessage({ token: (res as any).paymentToken });
        payLog('client/pay', 'STEP 4 postMessage(object) sent');
      } catch (e) {
        payLog('client/pay', 'STEP 4 postMessage(object) threw — retrying as JSON string', String(e));
        try { channel.postMessage(JSON.stringify({ token: (res as any).paymentToken })); payLog('client/pay', 'STEP 4 postMessage(string) sent'); }
        catch (e2) { payLog('client/pay', 'STEP 4 postMessage(string) also threw', String(e2)); }
      }
    } else {
      payLog('client/pay', '⛔ STEP 4 SKIPPED — window.myJsChannel not found. The customer will NOT be charged. Open this page inside the NIB Super App.');
      setPaying(false);
      setError('Could not reach the NIB Super App to complete the payment. Please open this page from within the Super App.');
      return;
    }

    // ── Step 5 detection: subscribe to live settlement updates (our callback). ──
    const sseUrl = `/api/payment-events?transactionId=${res.transactionId}&phone=${encodeURIComponent(member.phone || '')}&previousOutstanding=${member.totalOutstanding}`;
    payLog('client/pay', 'opening SSE for settlement', { sseUrl });
    // When settlement is detected, immediately re-fetch the member so the page
    // shows the updated balance/status without any manual refresh.
    let done = false;
    const finishSuccess = async () => {
      if (done) return; done = true;
      payLog('client/sse', 'settlement detected → refreshing member figures');
      setSettled(true); setPaying(false); es.close();
      setRefreshing(true);
      try {
        const fresh = await fetchMemberForPayment(memberPhone, token || undefined);
        if (fresh.status === 'success' && fresh.member) {
          setMember(fresh.member);
          payLog('client/sse', 'member refreshed after settlement', { newOutstanding: fresh.member.totalOutstanding, contribution: (fresh.member as any).contributionStatus });
        }
      } catch (e) { payLog('client/sse', 'refresh after settlement failed', String(e)); }
      finally { setRefreshing(false); }
    };

    const es = new EventSource(sseUrl);
    esRef.current = es;
    es.onopen = () => payLog('client/sse', 'SSE connection open');
    es.onmessage = (ev) => {
      payLog('client/sse', 'SSE message', ev.data);
      try {
        const data = JSON.parse(ev.data);
        if (data.status === 'success' || data.status === 'partial' || data.outstandingChanged) { finishSuccess(); }
        else if (data.status === 'failed' || data.status === 'void') { payLog('client/sse', 'settlement detected → failed/void'); setPaying(false); setError('Payment was not completed.'); es.close(); }
      } catch { /* ignore non-JSON keep-alives */ }
    };
    es.onerror = (e) => payLog('client/sse', 'SSE error', String(e));

    // Fallback poll: if the SSE window closes before the bank settles, keep
    // checking the transaction and refresh the moment it succeeds.
    let polls = 0;
    const poll = setInterval(async () => {
      if (done || polls++ > 30) { clearInterval(poll); return; }
      try {
        const s = await checkTransactionStatus(res.transactionId!);
        payLog('client/pay', `fallback status check #${polls}`, s);
        if (s.status === 'success' || s.status === 'partial') { clearInterval(poll); finishSuccess(); }
        else if (s.status === 'failed' || s.status === 'void') { clearInterval(poll); if (!done) { setPaying(false); setError('Payment was not completed.'); } }
      } catch { /* ignore */ }
    }, 5000);
  };

  // ── Settled screen — shows the freshly-updated figures, no manual refresh ──
  if (settled) {
    const m: any = member;
    const newBalance = m ? Number(m.totalOutstanding) : 0;
    return (
      <Shell>
        <Card className="page-enter overflow-hidden">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success"><CheckCircle2 className="h-9 w-9" /></span>
            <h2 className="text-lg font-bold">Payment received</h2>
            {paidAmount != null && <p className="text-sm text-muted-foreground">{m?.name ? `${m.name} · ` : ''}You paid <span className="font-semibold text-foreground">{money(paidAmount, m?.currency)}</span></p>}
          </CardContent>

          <div className="border-t bg-muted/30 p-4">
            {refreshing ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Updating your balance…</div>
            ) : m && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Previous balance</span>
                  <span className="text-muted-foreground line-through">{money(prevOutstanding ?? 0, m.currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">New outstanding balance</span>
                  <span className={`text-lg font-bold ${newBalance > 0 ? 'text-warning' : 'text-success'}`}>{money(newBalance, m.currency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Contribution status</span>
                  <Badge variant="outline" className={m.contributionStatus === 'PAID' ? 'border-success/20 bg-success/10 text-success' : 'border-warning/20 bg-warning/10 text-warning'}>{m.contributionStatus}</Badge>
                </div>
                {m.paymentHistory?.[0] && (
                  <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                    <span>Latest: {m.paymentHistory[0].method}</span>
                    <span>{money(m.paymentHistory[0].amount, m.currency)} · {m.paymentHistory[0].status}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 p-4">
            {txn && <p className="text-center font-mono text-[11px] text-muted-foreground">Ref: {txn}</p>}
            <Button variant="outline" className="w-full" onClick={reset}><Search className="mr-1.5 h-4 w-4" /> Make another payment</Button>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Lookup */}
      <Card className="page-enter">
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Member phone number</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-12 pl-9 text-base" inputMode="tel" placeholder="09xxxxxxxx" value={phone}
                onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchMember(); }} disabled={paying} />
            </div>
            <p className="text-[11px] text-muted-foreground">Pre-filled with your number — change it to pay on behalf of another member.</p>
          </div>
          <Button className="h-12 w-full text-base" onClick={fetchMember} disabled={fetching || paying}>
            {fetching ? <Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> : <Search className="mr-1.5 h-5 w-5" />} Fetch Member Data
          </Button>
          {sessionReady === false && !member && (
            <div className="flex items-start gap-2 rounded-md bg-warning/10 p-2.5 text-[11px] text-warning">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Open this page from the NIB Super App to start a secure payment session.
            </div>
          )}
          {error && !member && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </CardContent>
      </Card>

      {fetching && !member && (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      )}

      {member && <MemberPanel member={member} amount={amount} setAmount={setAmount} paying={paying} error={error} txn={txn} onPay={pay} onChange={reset} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 via-muted/30 to-background">
      <div className="mx-auto w-full max-w-md px-4 pb-28 pt-6 sm:pt-10">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Wallet className="h-5 w-5" /></span>
          <div>
            <h1 className="text-lg font-bold leading-tight">Edir Payment</h1>
            <p className="text-xs text-muted-foreground">Pay contributions securely with NIB</p>
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

function MemberPanel({ member, amount, setAmount, paying, error, txn, onPay, onChange }: {
  member: Member; amount: string; setAmount: (v: string) => void; paying: boolean; error: string; txn: string | null; onPay: () => void; onChange: () => void;
}) {
  const cur = member.currency;
  const m = member as any;
  const amountDue = Number(m.totalOutstanding) + Number(m.monthlyFee);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <>
      {/* Identity */}
      <Card className="page-enter overflow-hidden">
        <div className="flex items-center gap-3 border-b bg-muted/40 p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><User className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{m.name}</span>
              <Badge variant="outline" className={m.status === 'ACTIVE' ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{m.status}</Badge>
            </div>
            <div className="font-mono text-xs text-muted-foreground">{m.memberId} · {m.phone}</div>
          </div>
          <button onClick={onChange} className="flex items-center gap-1 text-xs text-primary"><RefreshCw className="h-3.5 w-3.5" /> Change</button>
        </div>
        <CardContent className="grid grid-cols-2 gap-3 p-4">
          <Stat label="Outstanding" value={money(m.totalOutstanding, cur)} icon={TrendingDown} tone={m.totalOutstanding > 0 ? 'warn' : 'ok'} />
          <Stat label="Monthly Fee" value={money(m.monthlyFee, cur)} icon={ReceiptText} />
          <Stat label="Months Behind" value={String(m.monthsBehind)} icon={CalendarClock} tone={m.monthsBehind > 0 ? 'warn' : 'ok'} />
          <Stat label="Contribution" value={m.contributionStatus} icon={CheckCircle2} tone={m.contributionStatus === 'PAID' ? 'ok' : 'warn'} />
        </CardContent>
      </Card>

      {/* Breakdown + amount */}
      <Card className="page-enter">
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Payment Breakdown</h3>
          <Line label="Outstanding balance" value={money(m.totalOutstanding, cur)} />
          <Line label="This month's contribution" value={money(m.monthlyFee, cur)} />
          {m.penaltiesPaid > 0 && <Line label="Penalties paid to date" value={money(m.penaltiesPaid, cur)} muted />}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm font-medium">Suggested total</span>
            <span className="font-semibold">{money(amountDue, cur)}</span>
          </div>
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs">Amount to pay ({cur})</Label>
            <Input className="h-12 text-base font-semibold" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} disabled={paying} />
            <p className="text-[11px] text-muted-foreground">Edit to pay a partial amount. Payments settle penalties → installments → monthly fee.</p>
          </div>
        </CardContent>
      </Card>

      {/* Due installments */}
      {m.dueInstallments.length > 0 && (
        <Card className="page-enter">
          <CardContent className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Upcoming Installments</h3>
            <div className="space-y-1.5">
              {m.dueInstallments.slice(0, 5).map((i: any) => (
                <div key={i.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground"><CalendarClock className="h-4 w-4" /> Due {fmt(i.dueDate)}</span>
                  <span className="flex items-center gap-2">{i.overdue && <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">Overdue</Badge>}<span className="font-medium">{money(i.amount, cur)}</span></span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {m.paymentHistory.length > 0 && (
        <Card className="page-enter">
          <CardContent className="p-4">
            <button onClick={() => setShowHistory(s => !s)} className="flex w-full items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2"><History className="h-4 w-4" /> Payment History</span>
              <ChevronRight className={`h-4 w-4 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
            </button>
            {showHistory && (
              <div className="mt-3 space-y-1.5">
                {m.paymentHistory.map((h: any) => (
                  <div key={h.transactionId} className="flex items-center justify-between text-sm">
                    <div><div className="text-muted-foreground">{fmt(h.createdAt)}</div><div className="font-mono text-[10px] text-muted-foreground">{h.method}</div></div>
                    <div className="flex items-center gap-2"><Badge variant="outline" className={h.status === 'success' || h.status === 'partial' ? 'border-success/20 bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>{h.status}</Badge><span className="font-medium">{money(h.amount, cur)}</span></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Sticky pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/90 p-3 backdrop-blur-md">
        <div className="mx-auto w-full max-w-md">
          <Button className="h-14 w-full text-base font-semibold shadow-lg" onClick={onPay} disabled={paying || Number(amount) <= 0}>
            {paying ? <><Loader2 className="mr-1.5 h-5 w-5 animate-spin" /> Processing…</> : <><Wallet className="mr-1.5 h-5 w-5" /> Pay {money(Number(amount) || 0, cur)}</>}
          </Button>
          {txn && <p className="mt-1 text-center font-mono text-[10px] text-muted-foreground">Ref: {txn}</p>}
        </div>
      </div>
    </>
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
function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className={muted ? 'text-muted-foreground' : 'font-medium'}>{value}</span></div>;
}

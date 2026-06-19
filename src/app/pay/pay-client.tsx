'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Wallet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { validateNibToken, getPaymentToken } from './actions';

type State = 'loading' | 'ready' | 'error' | 'paying' | 'settled';

export default function PayClient() {
  const [state, setState] = useState<State>('loading');
  const [member, setMember] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [txn, setTxn] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    validateNibToken(params.get('token') || undefined)
      .then((res) => {
        if (res.status === 'success' && res.member) {
          setMember(res.member); setToken(res.token || null); setState('ready');
        } else {
          setMessage(res.message || 'Could not identify a member for this account.');
          setState('error');
        }
      })
      .catch(() => { setMessage('Failed to validate session.'); setState('error'); });
    return () => { esRef.current?.close(); };
  }, []);

  const amountDue = member ? Number(member.totalOutstanding || 0) + Number(member.monthlyFee || 0) : 0;

  const pay = async () => {
    if (!member || !token) return;
    setState('paying');
    const res = await getPaymentToken(amountDue, token, member.id, member.edirId, { source: 'mini-app' });
    if (res.status !== 'success' || !res.transactionId) {
      setMessage(res.message || 'Failed to start payment.'); setState('error'); return;
    }
    setTxn(res.transactionId);
    // Subscribe to live settlement updates via SSE.
    const es = new EventSource(`/api/payment-events?transactionId=${res.transactionId}&phone=${encodeURIComponent(member.phone || '')}&previousOutstanding=${member.totalOutstanding}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.status === 'success' || data.status === 'partial' || data.outstandingChanged) {
          setState('settled'); es.close();
        }
      } catch { /* ignore */ }
    };
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Edir Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'loading' && <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
          )}

          {(state === 'ready' || state === 'paying') && member && (
            <>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">{member.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{member.memberId}</div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding</span>
                <span>{Number(member.totalOutstanding).toLocaleString()} {member.currency}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Monthly Fee</span>
                <span>{Number(member.monthlyFee).toLocaleString()} {member.currency}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2 font-semibold">
                <span>Amount Due</span>
                <span>{amountDue.toLocaleString()} {member.currency}</span>
              </div>
              <Button className="w-full" onClick={pay} disabled={state === 'paying' || amountDue <= 0}>
                {state === 'paying' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Pay with NIB
              </Button>
              {txn && <p className="text-center text-[11px] text-muted-foreground">Ref: {txn}</p>}
            </>
          )}

          {state === 'settled' && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
              <p className="font-medium">Payment received</p>
              <p className="text-sm text-muted-foreground">Your balance has been updated.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

/**
 * Collections breakdown charts — shared by the Edir, Branch, District, and
 * Platform dashboards. Splits settled collections by SOURCE (monthly
 * contributions, late penalties, interest, service fees, other charges,
 * unclassified) and by METHOD/channel (Manual, NIBtera Mini App, …), with a
 * trailing-12-month stacked trend.
 *
 * Colors: one fixed categorical order (never cycled), validated for both light
 * and dark surfaces with the dataviz palette validator (lightness band, chroma
 * floor, adjacent-pair CVD ΔE, contrast) — identity is never color-alone: every
 * figure is also direct-labeled in the side lists.
 */

import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Wallet, PieChart as PieIcon, ArrowLeftRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import type { CollectionAnalytics } from '@/app/actions/dashboard';

// Fixed categorical order — validated (light #fcfcfb and dark #1a1a19 surfaces).
const SOURCE_COLORS: Record<string, string> = {
  contributions: '#B8860B', // brand gold — the headline series
  latePenalty: '#DB2777',
  interest: '#2563EB',
  serviceFees: '#0D9488',
  other: '#7C3AED',
  unclassified: '#EA580C',
};
// Method colors follow the entity (same validated hues, fixed per method).
const METHOD_COLORS: Record<string, string> = {
  NIBTERA_MINI_APP: '#2563EB',
  MANUAL: '#B8860B',
  CASH: '#0D9488',
  BANK: '#7C3AED',
};
const methodColor = (m: string) => METHOD_COLORS[m] ?? '#EA580C';
const METHOD_LABEL: Record<string, string> = {
  NIBTERA_MINI_APP: 'NIBtera Mini App',
  MANUAL: 'Manual (staff-recorded)',
  CASH: 'Cash',
  BANK: 'Bank transfer',
};

const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export function CollectionsBreakdown({ data, currency = 'ETB' }: { data?: CollectionAnalytics | null; currency?: string }) {
  if (!data) return null;
  const money = (n: number) => `${fmt(n)} ${currency}`;

  // Only series that actually occur — colors stay bound to the source (never
  // reassigned), so dropping empty ones cannot repaint survivors.
  const activeSources = data.bySource.filter(s => s.amount > 0.005);
  const donut = activeSources.map(s => ({ ...s, color: SOURCE_COLORS[s.key] ?? '#EA580C' }));
  const total = data.totalSettled;

  if (total <= 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Collections Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EmptyState icon={Wallet} title="No settled collections yet" description="Once payments settle, you'll see them broken down by source and channel here." className="min-h-40" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Monthly trend, stacked by source ── */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-primary" /> Collections by Source</CardTitle>
            <CardDescription>Trailing 12 months of settled payments, split by what each birr paid for.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.monthly} margin={{ left: -8, right: 8, top: 8 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => compact(Number(v))} />
                <RTooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
                  formatter={(v: any, name: any) => [`${money(Number(v))}`, name]}
                  itemSorter={() => -1}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                {activeSources.map(s => (
                  // 1px card-colored stroke = the surface gap between stacked segments.
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="src" fill={SOURCE_COLORS[s.key] ?? '#EA580C'} stroke="hsl(var(--card))" strokeWidth={1} maxBarSize={34} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Source split (period totals) ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><PieIcon className="h-4 w-4 text-primary" /> Source Split</CardTitle>
            <CardDescription>{money(total)} settled in the selected period.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={donut} dataKey="amount" nameKey="label" innerRadius={44} outerRadius={68} paddingAngle={2} strokeWidth={0}>
                  {donut.map(d => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <RTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
                  formatter={(v: any, name: any) => [money(Number(v)), name]}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Direct-labeled table of the same figures (identity never color-alone). */}
            <div className="space-y-1.5">
              {donut.map(d => {
                const pct = total > 0 ? Math.round((d.amount / total) * 1000) / 10 : 0;
                return (
                  <div key={d.key} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.label}</span>
                    <span className="font-medium tabular-nums">{money(d.amount)}</span>
                    <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Channel / method split ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><ArrowLeftRight className="h-4 w-4 text-primary" /> Collections by Channel</CardTitle>
          <CardDescription>How the money arrived — staff-recorded manual payments vs digital NIBtera Mini App settlements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {data.byMethod.map(m => {
            const pct = total > 0 ? (m.amount / total) * 100 : 0;
            return (
              <div key={m.method} className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: methodColor(m.method) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{METHOD_LABEL[m.method] ?? String(m.method).replace(/_/g, ' ')}</span>
                  <span className="text-xs text-muted-foreground">{m.count} payment{m.count === 1 ? '' : 's'}</span>
                  <span className="font-semibold tabular-nums">{money(m.amount)}</span>
                  <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{Math.round(pct * 10) / 10}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-2 rounded-full transition-all" style={{ width: `${Math.max(2, pct)}%`, background: methodColor(m.method) }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

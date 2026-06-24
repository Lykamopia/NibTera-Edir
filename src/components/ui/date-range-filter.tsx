'use client';

/**
 * Standardized date-range filter used across data-driven pages. It owns the
 * preset selection and emits a resolved { preset, from, to } range so every
 * consumer filters statistics, tables, and exports consistently.
 *
 *   const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
 *   <DateRangeFilter value={range} onChange={setRange} />
 *   const rows = items.filter(i => inDateRange(i.createdAt, range));
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DatePreset =
  | 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'last_30' | 'custom';

export interface DateRangeValue {
  preset: DatePreset;
  from: Date | null; // inclusive start (00:00:00)
  to: Date | null;   // inclusive end (23:59:59.999)
}

export const ALL_TIME: DateRangeValue = { preset: 'all', from: null, to: null };

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'this_year', label: 'This Year' },
  { id: 'last_30', label: 'Last 30 Days' },
  { id: 'custom', label: 'Custom Range' },
];

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Resolve a preset (and optional custom dates) into a concrete from/to range. */
export function computeRange(preset: DatePreset, customFrom?: Date | null, customTo?: Date | null): DateRangeValue {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { preset, from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const y = addDays(now, -1);
      return { preset, from: startOfDay(y), to: endOfDay(y) };
    }
    case 'this_week': {
      const day = (now.getDay() + 6) % 7; // 0 = Monday
      return { preset, from: startOfDay(addDays(now, -day)), to: endOfDay(now) };
    }
    case 'this_month':
      return { preset, from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(now) };
    case 'this_year':
      return { preset, from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: endOfDay(now) };
    case 'last_30':
      return { preset, from: startOfDay(addDays(now, -29)), to: endOfDay(now) };
    case 'custom':
      return {
        preset,
        from: customFrom ? startOfDay(customFrom) : null,
        to: customTo ? endOfDay(customTo) : null,
      };
    case 'all':
    default:
      return ALL_TIME;
  }
}

/** True if `date` falls within the (inclusive) range. A null bound means "open". */
export function inDateRange(date: Date | string | null | undefined, range: DateRangeValue): boolean {
  if (!range || range.preset === 'all' || (!range.from && !range.to)) return true;
  if (!date) return false;
  const t = new Date(date).getTime();
  if (range.from && t < range.from.getTime()) return false;
  if (range.to && t > range.to.getTime()) return false;
  return true;
}

const fmt = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const toInputValue = (d: Date | null) => {
  if (!d) return '';
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};

/** A short human label for the current selection (for chips / summaries). */
export function dateRangeLabel(v: DateRangeValue): string {
  if (v.preset === 'all') return 'All time';
  const preset = PRESETS.find(p => p.id === v.preset);
  if (v.preset !== 'custom' && preset) return preset.label;
  if (v.from && v.to) return `${fmt(v.from)} – ${fmt(v.to)}`;
  if (v.from) return `From ${fmt(v.from)}`;
  if (v.to) return `Until ${fmt(v.to)}`;
  return 'Custom Range';
}

export function DateRangeFilter({
  value, onChange, className, align = 'start', presets = PRESETS.map(p => p.id),
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  className?: string;
  align?: 'start' | 'center' | 'end';
  presets?: DatePreset[];
}) {
  const [open, setOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState<string>(toInputValue(value.from));
  const [customTo, setCustomTo] = React.useState<string>(toInputValue(value.to));

  React.useEffect(() => {
    if (value.preset === 'custom') { setCustomFrom(toInputValue(value.from)); setCustomTo(toInputValue(value.to)); }
  }, [value]);

  const pick = (preset: DatePreset) => {
    if (preset === 'custom') {
      onChange(computeRange('custom', customFrom ? new Date(customFrom) : null, customTo ? new Date(customTo) : null));
      return;
    }
    onChange(computeRange(preset));
    setOpen(false);
  };

  const applyCustom = () => {
    onChange(computeRange('custom', customFrom ? new Date(customFrom) : null, customTo ? new Date(customTo) : null));
    setOpen(false);
  };

  const shown = PRESETS.filter(p => presets.includes(p.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start gap-2 font-normal', className)}>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{dateRangeLabel(value)}</span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="flex flex-col p-1">
          {shown.map(p => {
            const active = value.preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => pick(p.id)}
                className={cn(
                  'flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                  active && 'bg-primary/10 font-medium text-primary',
                )}
              >
                {p.label}
                {active && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
        {value.preset === 'custom' && (
          <div className="space-y-2 border-t p-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)} />
            </div>
            <Button size="sm" className="w-full" onClick={applyCustom} disabled={!customFrom && !customTo}>Apply</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

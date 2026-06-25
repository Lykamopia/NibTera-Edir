'use client';

/**
 * Standardized date-range filter used across data-driven pages. It owns the
 * preset selection and emits a resolved { preset, from, to } range so every
 * consumer filters statistics, tables, charts, and exports consistently.
 *
 *   const [range, setRange] = useState<DateRangeValue>(ALL_TIME);
 *   <DateRangeFilter value={range} onChange={setRange} />
 *   // client-side:  rows.filter(i => inDateRange(i.createdAt, range))
 *   // server-side:  action({ ...filters, range: toParam(range) })
 *
 * All range math lives in `@/lib/date-range` so the server resolves identical
 * bounds. The pure helpers are re-exported here for backwards compatibility.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type DatePreset,
  type DateRangeValue,
  type DateRangeParam,
  ALL_TIME,
  DATE_PRESETS,
  computeRange,
  inDateRange,
  resolveBounds,
  dateWhere,
  toParam,
  dateRangeLabel,
} from '@/lib/date-range';

export {
  type DatePreset,
  type DateRangeValue,
  type DateRangeParam,
  ALL_TIME,
  computeRange,
  inDateRange,
  resolveBounds,
  dateWhere,
  toParam,
  dateRangeLabel,
};

const toInputValue = (d: Date | null) => {
  if (!d) return '';
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};

export function DateRangeFilter({
  value, onChange, className, align = 'start', presets = DATE_PRESETS.map(p => p.id),
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

  const shown = DATE_PRESETS.filter(p => presets.includes(p.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start gap-2 font-normal', className)}>
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{dateRangeLabel(value)}</span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-0">
        <div className="grid max-h-80 grid-cols-1 gap-0.5 overflow-y-auto p-1">
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

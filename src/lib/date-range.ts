/**
 * Standardized date-range framework — the single source of truth shared by the
 * UI filter component and every server action. The client owns a `DateRangeValue`
 * (with concrete Date bounds); when it calls a server action it sends a
 * serializable `DateRangeParam` ({ preset, from?, to? }). The server re-resolves
 * relative presets against its own "now" and turns the range into a Prisma
 * `where` fragment via `dateWhere(field, param)`.
 *
 * Every preset the product spec requires is here: Today, Yesterday, This/Last
 * Week, This/Last Month, This/Last Quarter, This/Last Year, Last 30 Days, and
 * Custom Range — plus All time.
 */

export type DatePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'last_quarter'
  | 'this_year'
  | 'last_year'
  | 'last_30'
  | 'custom';

/** Concrete range used in client state. */
export interface DateRangeValue {
  preset: DatePreset;
  from: Date | null; // inclusive start (00:00:00.000)
  to: Date | null;   // inclusive end (23:59:59.999)
}

/** Serializable range passed across the server-action boundary. */
export interface DateRangeParam {
  preset: DatePreset;
  from?: string | null; // ISO date/datetime — only meaningful for 'custom'
  to?: string | null;
}

export const ALL_TIME: DateRangeValue = { preset: 'all', from: null, to: null };

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This Week' },
  { id: 'last_week', label: 'Last Week' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'last_quarter', label: 'Last Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'last_year', label: 'Last Year' },
  { id: 'last_30', label: 'Last 30 Days' },
  { id: 'custom', label: 'Custom Range' },
];

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d: Date) => { const day = (d.getDay() + 6) % 7; return startOfDay(addDays(d, -day)); }; // Monday

/** Resolve a preset (+ optional custom dates) into concrete inclusive bounds. */
export function computeRange(preset: DatePreset, customFrom?: Date | null, customTo?: Date | null): DateRangeValue {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'today':
      return { preset, from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': {
      const yd = addDays(now, -1);
      return { preset, from: startOfDay(yd), to: endOfDay(yd) };
    }
    case 'this_week':
      return { preset, from: startOfWeek(now), to: endOfDay(now) };
    case 'last_week': {
      const thisWeekStart = startOfWeek(now);
      return { preset, from: addDays(thisWeekStart, -7), to: endOfDay(addDays(thisWeekStart, -1)) };
    }
    case 'this_month':
      return { preset, from: startOfDay(new Date(y, m, 1)), to: endOfDay(now) };
    case 'last_month':
      return { preset, from: startOfDay(new Date(y, m - 1, 1)), to: endOfDay(new Date(y, m, 0)) };
    case 'this_quarter': {
      const qStart = Math.floor(m / 3) * 3;
      return { preset, from: startOfDay(new Date(y, qStart, 1)), to: endOfDay(now) };
    }
    case 'last_quarter': {
      const qStart = Math.floor(m / 3) * 3;
      const start = new Date(y, qStart - 3, 1);
      const end = new Date(y, qStart, 0); // day 0 of this quarter's start month = last day of prev quarter
      return { preset, from: startOfDay(start), to: endOfDay(end) };
    }
    case 'this_year':
      return { preset, from: startOfDay(new Date(y, 0, 1)), to: endOfDay(now) };
    case 'last_year':
      return { preset, from: startOfDay(new Date(y - 1, 0, 1)), to: endOfDay(new Date(y - 1, 11, 31)) };
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

/** Server side: turn a serializable param into concrete inclusive bounds.
 *  Relative presets are recomputed against the server's "now". */
export function resolveBounds(param?: DateRangeParam | DateRangeValue | null): { from: Date | null; to: Date | null } {
  if (!param || param.preset === 'all') return { from: null, to: null };
  if (param.preset === 'custom') {
    const from = param.from ? startOfDay(new Date(param.from)) : null;
    const to = param.to ? endOfDay(new Date(param.to)) : null;
    return { from, to };
  }
  const r = computeRange(param.preset);
  return { from: r.from, to: r.to };
}

/**
 * Prisma `where` fragment for a single date column, e.g.
 *   where: { ...tenantWhere(actor), ...dateWhere('createdAt', range) }
 * Returns `{}` for "all time" so it composes cleanly with other filters.
 */
export function dateWhere(field: string, param?: DateRangeParam | DateRangeValue | null): Record<string, any> {
  const { from, to } = resolveBounds(param);
  if (!from && !to) return {};
  const cond: { gte?: Date; lte?: Date } = {};
  if (from) cond.gte = from;
  if (to) cond.lte = to;
  return { [field]: cond };
}

/** Convert client `DateRangeValue` (Dates) → serializable `DateRangeParam`. */
export function toParam(v?: DateRangeValue | null): DateRangeParam {
  if (!v) return { preset: 'all' };
  return { preset: v.preset, from: v.from ? v.from.toISOString() : null, to: v.to ? v.to.toISOString() : null };
}

/** True if `date` falls within the (inclusive) range. A null bound means "open". */
export function inDateRange(date: Date | string | null | undefined, range?: DateRangeValue | null): boolean {
  if (!range || range.preset === 'all' || (!range.from && !range.to)) return true;
  if (!date) return false;
  const t = new Date(date).getTime();
  if (range.from && t < range.from.getTime()) return false;
  if (range.to && t > range.to.getTime()) return false;
  return true;
}

const fmt = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** A short human label for the current selection (for chips / summaries). */
export function dateRangeLabel(v: DateRangeValue): string {
  if (v.preset === 'all') return 'All time';
  const preset = DATE_PRESETS.find(p => p.id === v.preset);
  if (v.preset !== 'custom' && preset) return preset.label;
  if (v.from && v.to) return `${fmt(v.from)} – ${fmt(v.to)}`;
  if (v.from) return `From ${fmt(v.from)}`;
  if (v.to) return `Until ${fmt(v.to)}`;
  return 'Custom Range';
}

'use client';

// Shared presentational helpers for the two directory surfaces (Edir Members and
// Platform Users). Kept here so both clients reuse identical avatar/sort-header
// rendering and status colours instead of duplicating them.

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { TableHead } from '@/components/ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { PersonRow } from '@/app/actions/people';

export const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'border-success/20 bg-success/10 text-success',
  INVITED: 'border-info/20 bg-info/10 text-info',
  INACTIVE: 'bg-muted text-muted-foreground',
  SUSPENDED: 'border-warning/20 bg-warning/10 text-warning',
  TERMINATED: 'border-destructive/20 bg-destructive/10 text-destructive',
};

export function Avatar({ row, lg }: { row: PersonRow; lg?: boolean }) {
  const cls = lg ? 'h-12 w-12' : 'h-9 w-9';
  if (row.photoUrl) return <img src={row.photoUrl} alt="" className={cn(cls, 'shrink-0 rounded-full border object-cover')} />;
  return (
    <span className={cn(cls, 'flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground')}>
      {row.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function SortHead<K extends string>({ label, k, sort, onSort, className }: {
  label: string; k: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (k: K) => void; className?: string;
}) {
  const Icon = sort.key !== k ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-foreground', className?.includes('text-right') && 'flex-row-reverse')}>
        {label}<Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </TableHead>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function FormField({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={cn('space-y-1.5', full && 'sm:col-span-2')}><Label className="text-xs">{label}</Label>{children}</div>;
}

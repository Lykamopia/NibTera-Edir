'use client';

/**
 * Reusable, design-system pagination. Two ways to use it:
 *
 *  1. Server-paginated lists — drive it from the action's page/pages/total:
 *       <Pagination page={page} pageCount={pages} total={total}
 *                   pageSize={25} itemLabel="transaction" onPageChange={setPage} />
 *
 *  2. Client-paginated lists — slice locally with the hook:
 *       const { pageItems, page, setPage, pageCount, total } = usePagination(rows, 10);
 *       …render pageItems…
 *       <Pagination page={page} pageCount={pageCount} total={total}
 *                   pageSize={10} onPageChange={setPage} />
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

const range = (start: number, end: number) =>
  Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);

/** Page items with ellipses, e.g. [1, 'dots', 5, 6, 7, 'dots', 20]. */
function pageItems(page: number, pageCount: number, siblings: number): (number | 'dots-l' | 'dots-r')[] {
  const totalShown = siblings * 2 + 5; // first + last + current + 2 ellipses
  if (pageCount <= totalShown) return range(1, pageCount);
  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, pageCount);
  const showLeft = left > 2;
  const showRight = right < pageCount - 1;
  if (!showLeft && showRight) return [...range(1, 3 + 2 * siblings), 'dots-r', pageCount];
  if (showLeft && !showRight) return [1, 'dots-l', ...range(pageCount - (2 + 2 * siblings), pageCount)];
  return [1, 'dots-l', ...range(left, right), 'dots-r', pageCount];
}

export interface PaginationProps {
  /** Current page (1-based). */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total item count — enables the "Showing X–Y of Z" summary. */
  total?: number;
  /** Items per page — used with `total` for the summary. */
  pageSize?: number;
  /** Singular noun for the summary (e.g. "transaction"). */
  itemLabel?: string;
  /** Plural noun — defaults to `itemLabel` + "s". Pass for irregular plurals (e.g. "entries"). */
  itemLabelPlural?: string;
  /** Pages shown on each side of the current page (default 1). */
  siblingCount?: number;
  className?: string;
}

export function Pagination({
  page, pageCount, onPageChange, total, pageSize, itemLabel = 'item', itemLabelPlural, siblingCount = 1, className,
}: PaginationProps) {
  const safeCount = Math.max(1, pageCount);
  const items = pageItems(page, safeCount, siblingCount);
  const hasSummary = total != null;
  const from = hasSummary && pageSize ? (page - 1) * pageSize + 1 : null;
  const to = hasSummary && pageSize ? Math.min(page * pageSize, total!) : null;
  const plural = itemLabelPlural ?? `${itemLabel}s`;
  const noun = (n: number) => (n === 1 ? itemLabel : plural);

  // Nothing to show: no summary requested and a single page.
  if (!hasSummary && safeCount <= 1) return null;

  return (
    <nav className={cn('flex flex-col-reverse items-center justify-between gap-3 sm:flex-row', className)} aria-label="Pagination">
      {hasSummary ? (
        <p className="text-sm text-muted-foreground">
          {total === 0 ? (
            <>No {plural}</>
          ) : from != null ? (
            <>Showing <span className="font-medium text-foreground">{from.toLocaleString()}–{to!.toLocaleString()}</span> of <span className="font-medium text-foreground">{total!.toLocaleString()}</span> {noun(total!)}</>
          ) : (
            <><span className="font-medium text-foreground">{total!.toLocaleString()}</span> {noun(total!)}</>
          )}
        </p>
      ) : <span />}

      {safeCount > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {items.map((it, i) =>
            typeof it === 'number' ? (
              <Button
                key={it}
                variant={it === page ? 'default' : 'outline'}
                size="icon"
                className={cn('h-8 w-8 tabular-nums', it === page && 'pointer-events-none')}
                onClick={() => onPageChange(it)}
                aria-current={it === page ? 'page' : undefined}
              >
                {it}
              </Button>
            ) : (
              <span key={`${it}-${i}`} className="flex h-8 w-8 items-center justify-center text-muted-foreground" aria-hidden>
                <MoreHorizontal className="h-4 w-4" />
              </span>
            ),
          )}
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= safeCount} onClick={() => onPageChange(page + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </nav>
  );
}

/** Client-side pagination over an in-memory array. Resets to page 1 when the
 *  data shrinks below the current page. */
export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = React.useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  React.useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
  return { page, setPage, pageCount, pageItems, pageSize, total };
}

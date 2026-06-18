'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScrollContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Extra classes for the inner scrollable element (where the wide content lives). */
  innerClassName?: string;
  /** Show subtle chevron affordances on the edges when more content is available. Default true. */
  showChevrons?: boolean;
}

/**
 * Horizontal scroll region that keeps overflowing content accessible instead of
 * clipping it. Renders left/right fade overlays and chevron hints that appear
 * only when there is more content to scroll to in that direction — a clear,
 * professional indicator that content continues off-screen.
 *
 * Usage: wrap wide content (tables, KPI grids, allocation matrices) e.g.
 *   <ScrollContainer className="rounded-xl border"><table>…</table></ScrollContainer>
 */
export function ScrollContainer({
  children,
  className,
  innerClassName,
  showChevrons = true,
  ...props
}: ScrollContainerProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(true);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setAtStart(scrollLeft <= 1);
    setAtEnd(scrollLeft >= max - 1);
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Observe content size changes too (e.g. data loads)
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [update, children]);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className={cn('relative', className)} {...props}>
      <div ref={ref} className={cn('scroll-x', innerClassName)}>
        {children}
      </div>

      {/* Left fade + chevron */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background/80 to-transparent transition-opacity duration-200',
          atStart ? 'opacity-0' : 'opacity-100'
        )}
      />
      {showChevrons && !atStart && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => nudge(-1)}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 grid h-6 w-6 place-items-center rounded-full border bg-background/90 shadow-sm hover:bg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Right fade + chevron */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background/80 to-transparent transition-opacity duration-200',
          atEnd ? 'opacity-0' : 'opacity-100'
        )}
      />
      {showChevrons && !atEnd && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => nudge(1)}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 grid h-6 w-6 place-items-center rounded-full border bg-background/90 shadow-sm hover:bg-muted"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

'use client';

/**
 * Shared design-system primitives for consistent page structure and the three
 * universal data states: loading, empty, and error. Use these everywhere so the
 * app feels like one cohesive product.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2, AlertTriangle, RotateCcw, ArrowLeft, Home, LifeBuoy, Inbox,
} from 'lucide-react';
import { toUserError } from '@/lib/errors';

// ─── Page header ─────────────────────────────────────────────────────────────

export function PageHeader({
  title, description, icon: Icon, actions, className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ─── Loading ─────────────────────────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground', className)} />;
}

export function LoadingState({ label = 'Loading…', className, rows }: { label?: string; className?: string; rows?: number }) {
  if (rows && rows > 0) {
    return (
      <div className={cn('space-y-2 p-4', className)} aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-40 flex-col items-center justify-center gap-3 p-8 text-center', className)} aria-busy="true" aria-live="polite">
      <Spinner className="h-6 w-6 text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Empty ───────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon = Inbox, title, description, action, className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-center', className)}>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-7 w-7" />
      </span>
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ─── Error ───────────────────────────────────────────────────────────────────

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  showBack?: boolean;
  showHome?: boolean;
  showContact?: boolean;
  variant?: 'inline' | 'page';
  className?: string;
}

/**
 * Standardized friendly error surface. Always renders a user-safe message
 * (never raw error text) plus contextual actions: Retry, Go Back, Return Home,
 * Contact Administrator.
 */
export function ErrorState({
  error, title, message, onRetry, showBack, showHome, showContact = true, variant = 'inline', className,
}: ErrorStateProps) {
  const router = useRouter();
  const ue = toUserError(error);
  const heading = title ?? ue.title;
  const body = message ?? ue.message;

  const content = (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" />
      </span>
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold">{heading}</h3>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {onRetry && <Button onClick={onRetry}><RotateCcw className="mr-1.5 h-4 w-4" /> Try again</Button>}
        {showBack && <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-1.5 h-4 w-4" /> Go back</Button>}
        {showHome && <Button variant="outline" asChild><Link href="/dashboard"><Home className="mr-1.5 h-4 w-4" /> Return home</Link></Button>}
        {showContact && (
          <Button variant="ghost" asChild>
            <a href="mailto:support@edir.local"><LifeBuoy className="mr-1.5 h-4 w-4" /> Contact administrator</a>
          </Button>
        )}
      </div>
    </div>
  );

  if (variant === 'page') {
    return (
      <div className={cn('flex min-h-[60vh] w-full items-center justify-center p-6', className)}>
        <Card className="w-full max-w-lg"><CardContent className="p-8">{content}</CardContent></Card>
      </div>
    );
  }
  return <div className={cn('flex min-h-48 items-center justify-center p-8', className)}>{content}</div>;
}

// ─── Stat card ───────────────────────────────────────────────────────────────

export function StatCard({
  title, value, icon: Icon, hint, href, accent = 'primary', className,
}: {
  title: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: string;
  href?: string;
  accent?: 'primary' | 'success' | 'warning' | 'destructive' | 'info';
  className?: string;
}) {
  const accents: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    info: 'bg-info/10 text-info',
  };
  const body = (
    <Card className={cn('group h-full transition-all hover:-translate-y-0.5 hover:shadow-md', href && 'cursor-pointer', className)}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
          {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', accents[accent])}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

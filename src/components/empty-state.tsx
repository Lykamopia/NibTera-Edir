'use client';

import React from 'react';
import { MemoEmptyIllustration } from './memo-empty-illustration';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon = <MemoEmptyIllustration />,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div data-testid="empty-state" className="flex h-full w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted bg-card text-center p-8">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

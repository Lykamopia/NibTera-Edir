'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/states';
import { logError } from '@/lib/errors';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { logError(error, 'app-boundary'); }, [error]);
  return <ErrorState error={error} variant="page" onRetry={reset} showHome showContact />;
}

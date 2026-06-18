
'use client';

import { cn } from '@/lib/utils';
import type { Memo } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

interface StatusBadgeProps {
  status: Memo['status'] | 'unread' | 'read' | 'forwarded' | 'delegated' | 'replied' | 'acknowledged' | 'open' | 'in_progress' | 'closed';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const statusStyles: Record<string, string> = {
    draft: 'bg-yellow-100/60 text-yellow-800 border-yellow-200/80 hover:bg-yellow-100/80 dark:bg-yellow-900/40 dark:text-yellow-200 dark:border-yellow-800/60',
    open: 'bg-blue-100/60 text-blue-800 border-blue-200/80 hover:bg-blue-100/80 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800/60',
    in_progress: 'bg-amber-100/60 text-amber-800 border-amber-200/80 hover:bg-amber-100/80 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800/60',
    closed: 'bg-slate-100/60 text-slate-800 border-slate-200/80 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700/60',
    sent: 'bg-blue-100/60 text-blue-800 border-blue-200/80 hover:bg-blue-100/80 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800/60',
    read: 'bg-gray-100/60 text-gray-800 border-gray-200/80 hover:bg-gray-100/80 dark:bg-gray-900/40 dark:text-gray-200 dark:border-gray-800/60',
    unread: 'bg-green-100/60 text-green-800 border-green-200/80 hover:bg-green-100/80 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800/60',
    acknowledged: 'bg-purple-100/60 text-purple-800 border-purple-200/80 hover:bg-purple-100/80 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800/60',
    forwarded: 'bg-indigo-100/60 text-indigo-800 border-indigo-200/80 hover:bg-indigo-100/80 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-800/60',
    delegated: 'bg-indigo-100/60 text-indigo-800 border-indigo-200/80 hover:bg-indigo-100/80 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-800/60',
    replied: 'bg-teal-100/60 text-teal-800 border-teal-200/80 hover:bg-teal-100/80 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-800/60',
  };

  const labelMap: Record<string, string> = {
      'in_progress': 'In Progress',
      'open': 'Open',
      'closed': 'Closed',
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        'capitalize text-[10px] md:text-xs font-medium px-2 py-0',
        statusStyles[status] || 'bg-gray-100 text-gray-800'
      )}
    >
      {labelMap[status] || status}
    </Badge>
  );
}

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, Globe, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getEdirContext, setActiveEdir, type EdirContext } from '@/app/actions/edir-context';

const ALL = '__all__';

/**
 * Super-Admin global Edir switcher. Pinning an Edir scopes every Edir-specific
 * page to that tenant; "All Edirs" restores the platform-wide view. Rendered
 * only for Super-Admins (returns null otherwise).
 */
export function EdirSwitcher() {
  const router = useRouter();
  const [ctx, setCtx] = useState<EdirContext | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => { getEdirContext().then(setCtx).catch(() => {}); }, []);

  if (!ctx || !ctx.isSuperAdmin) return null;

  const choose = (edirId: string | null) => {
    setOpen(false);
    startTransition(async () => {
      const res = await setActiveEdir(edirId);
      if (res?.success) {
        setCtx(c => c ? { ...c, activeEdirId: res.activeEdirId, activeEdirName: res.activeEdirName ?? null } : c);
        toast.success(edirId ? `Working in ${res.activeEdirName}` : 'Viewing all Edirs');
        router.refresh();
      } else {
        toast.error(res?.error || 'Could not switch Edir.');
      }
    });
  };

  const activeLabel = ctx.activeEdirName ?? 'All Edirs';
  const filtered = ctx.edirs.filter(e => e.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 max-w-[12rem] gap-1.5" title="Switch the Edir you are working in">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : ctx.activeEdirId ? <Building2 className="h-4 w-4 text-primary" /> : <Globe className="h-4 w-4 text-muted-foreground" />}
          <span className="truncate text-xs font-medium">{activeLabel}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-0">
        <div className="border-b p-2">
          <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edir context</div>
          <Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Edirs…" className="h-8" />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          <button onClick={() => choose(null)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted', !ctx.activeEdirId && 'bg-muted/60')}>
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-left">All Edirs</span>
            {!ctx.activeEdirId && <Check className="h-4 w-4 text-primary" />}
          </button>
          <div className="my-1 h-px bg-border" />
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">No Edirs match.</div>
          ) : filtered.map(e => {
            const on = ctx.activeEdirId === e.id;
            return (
              <button key={e.id} onClick={() => choose(e.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted', on && 'bg-muted/60')}>
                <Building2 className={cn('h-4 w-4', on ? 'text-primary' : 'text-muted-foreground')} />
                <span className="flex-1 truncate text-left">{e.name}</span>
                {on && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

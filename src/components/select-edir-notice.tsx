import { Building2, ArrowUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Shown on Edir-specific pages when a Super-Admin has not pinned an Edir in the
 * top-bar switcher (context = "All Edirs"). These pages operate on a single Edir.
 */
export function SelectEdirNotice({ what = 'this page' }: { what?: string }) {
  return (
    <Card className="page-enter">
      <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Building2 className="h-7 w-7" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Select an Edir</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {what.charAt(0).toUpperCase() + what.slice(1)} is specific to a single Edir. Choose one from the
            <span className="mx-1 inline-flex items-center gap-1 font-medium text-foreground"><ArrowUp className="h-3.5 w-3.5" /> Edir switcher</span>
            in the top bar to view and manage it.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

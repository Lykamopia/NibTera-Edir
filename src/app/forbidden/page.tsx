'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert, ArrowLeft, Home, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ForbiddenPage() {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-lg page-enter">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 text-warning">
            <ShieldAlert className="h-7 w-7" />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold">Access denied</h1>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              You do not have permission to view this page. If you believe this is a mistake, please contact your Edir administrator.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-1.5 h-4 w-4" /> Go back</Button>
            <Button asChild><Link href="/dashboard"><Home className="mr-1.5 h-4 w-4" /> Return home</Link></Button>
            <Button variant="ghost" asChild><a href="mailto:support@edir.local"><LifeBuoy className="mr-1.5 h-4 w-4" /> Contact administrator</a></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

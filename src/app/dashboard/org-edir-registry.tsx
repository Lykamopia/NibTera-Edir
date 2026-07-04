'use client';

/**
 * Shared "Edir Registry" table for the Branch and District dashboards: every
 * Edir in the org unit with its placement, member count, in-period transaction
 * volume, and the maker–checker trail of its registration (created by /
 * approved by). Fed by orgEdirRegistry via getBranchDashboard/getDistrictDashboard.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2 } from 'lucide-react';

export interface OrgEdirRow {
  id: string;
  name: string;
  status: string;
  branchName: string | null;
  branchCode: string | null;
  districtName: string | null;
  members: number;
  txCount: number;
  collected: number;
  createdBy: string | null;
  approvedBy: string | null;
  registrationStatus: string | null;
  createdAt: string | Date;
}

const money = (n: number) => `ETB ${Number(n || 0).toLocaleString()}`;

const STATUS_CLS: Record<string, string> = {
  ACTIVE: 'border-success/30 bg-success/10 text-success',
  PENDING: 'border-warning/30 bg-warning/10 text-warning',
  SUSPENDED: 'border-warning/30 bg-warning/10 text-warning',
  CLOSED: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function OrgEdirRegistry({ edirs, showBranch }: { edirs: OrgEdirRow[]; showBranch?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-primary" /> Edir Registry</CardTitle>
        <CardDescription>Every Edir in your scope — placement, membership, period transactions, and who created and approved the registration.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {edirs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No Edirs registered in your scope yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Edir</TableHead>
                  {showBranch && <TableHead>Branch</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Approved By</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {edirs.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <a href={`/dashboard/edirs/${e.id}`} className="font-medium hover:text-primary hover:underline">{e.name}</a>
                      {!showBranch && e.branchName && <div className="text-xs text-muted-foreground">{e.branchName}</div>}
                    </TableCell>
                    {showBranch && (
                      <TableCell className="text-sm text-muted-foreground">{e.branchName ?? '—'}{e.branchCode ? ` (${e.branchCode})` : ''}</TableCell>
                    )}
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLS[e.status] ?? 'text-muted-foreground'}>{e.status}</Badge>
                      {e.registrationStatus === 'REJECTED' && (
                        <Badge variant="outline" className="ml-1 border-destructive/30 bg-destructive/10 text-destructive">Rejected</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{e.members}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.txCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(e.collected)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.createdBy ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.approvedBy ?? '—'}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

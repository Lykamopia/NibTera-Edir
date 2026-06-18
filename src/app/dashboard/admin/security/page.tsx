
"use client";

import { useState, useEffect, useCallback } from "react";
import { getSecurityLogs } from "@/app/actions/admin";
import type { SecurityLog, User, LogSeverity } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronsLeft, ChevronsRight, Search, Shield, AlertTriangle, Info, Loader2 } from "lucide-react";
import { formatTimestamp } from "@/lib/data";
import { useDebouncedCallback } from "use-debounce";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type SecurityLogWithActor = SecurityLog & { actor: User | null };

function SecurityLogViewer() {
    const [data, setData] = useState<{ logs: SecurityLogWithActor[], total: number, totalPages: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(15);
    const [filters, setFilters] = useState<{ severity?: string; query?: string }>({});
    const [selectedLog, setSelectedLog] = useState<SecurityLogWithActor | null>(null);

    const debouncedSetQuery = useDebouncedCallback((query: string) => {
        setPage(1);
        setFilters(prev => ({ ...prev, query }));
    }, 500);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getSecurityLogs(page, limit, filters);
            setData(result as any);
        } catch (error) {
            console.error("Failed to fetch security logs:", error);
        } finally {
            setLoading(false);
        }
    }, [page, limit, filters]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const getSeverityBadge = (severity: LogSeverity) => {
        switch (severity) {
            case 'CRITICAL':
                return <Badge variant="destructive" className="items-center gap-1"><AlertTriangle className="h-3 w-3" /> CRITICAL</Badge>;
            case 'WARN':
                return <Badge variant="secondary" className="bg-yellow-500/80 text-background items-center gap-1"><Shield className="h-3 w-3" /> WARN</Badge>;
            case 'INFO':
            default:
                return <Badge variant="outline" className="items-center gap-1"><Info className="h-3 w-3" /> INFO</Badge>;
        }
    };
    
    return (
         <>
         <Card>
            <CardHeader>
                <CardTitle>Security Event Logs</CardTitle>
                <CardDescription>An audit trail of security-relevant activities within the system.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 mb-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by event, IP, user ID..."
                            className="pl-8 pr-8"
                            onChange={(e) => debouncedSetQuery(e.target.value)}
                        />
                        {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <Select value={filters.severity || 'all'} onValueChange={(value) => {
                        setPage(1);
                        setFilters(prev => ({ ...prev, severity: value === 'all' ? undefined : value }));
                    }}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by severity" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Severities</SelectItem>
                            <SelectItem value={'INFO'}>Info</SelectItem>
                            <SelectItem value={'WARN'}>Warning</SelectItem>
                            <SelectItem value={'CRITICAL'}>Critical</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Severity</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>Details</TableHead>
                                <TableHead>Actor</TableHead>
                                <TableHead>IP Address</TableHead>
                                <TableHead>Date</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && !data ? ( // Show skeleton only on initial load
                                Array.from({ length: limit }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : data && data.logs.length > 0 ? (
                                data.logs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell>{getSeverityBadge(log.severity as LogSeverity)}</TableCell>
                                        <TableCell><Badge variant="secondary" className="font-mono">{log.event}</Badge></TableCell>
                                        <TableCell className="max-w-xs truncate">
                                            <span
                                                className="cursor-pointer hover:underline"
                                                onClick={() => setSelectedLog(log)}
                                            >
                                                {log.details}
                                            </span>
                                        </TableCell>
                                        <TableCell>{log.actor?.name || log.actorId || 'System'}</TableCell>
                                        <TableCell className="font-mono">{log.ipAddress}</TableCell>
                                        <TableCell>{formatTimestamp(log.timestamp)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center">No security logs found.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                {data && data.total > 0 && (
                    <div className="flex justify-between items-center mt-4">
                        <div className="text-sm text-muted-foreground">
                            {data.total} total logs.
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">Rows per page</p>
                                <Select
                                    value={`${limit}`}
                                    onValueChange={(value) => {
                                        setLimit(Number(value));
                                        setPage(1); // Reset to first page
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[70px]">
                                        <SelectValue placeholder={`${limit}`} />
                                    </SelectTrigger>
                                    <SelectContent side="top">
                                        {[15, 25, 50, 100].map((pageSize) => (
                                        <SelectItem key={pageSize} value={`${pageSize}`}>
                                            {pageSize}
                                        </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="text-sm font-medium">
                                Page {page} of {data.totalPages}
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                                    <ChevronsLeft className="h-4 w-4 mr-1" /> Previous
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>
                                    Next <ChevronsRight className="h-4 w-4 ml-1" />
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
        <Dialog open={!!selectedLog} onOpenChange={(isOpen) => !isOpen && setSelectedLog(null)}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Full Log Details</DialogTitle>
                    <DialogDescription>
                       Event: <Badge variant="secondary" className="font-mono text-xs">{selectedLog?.event}</Badge>
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-md border bg-muted/50 p-4">
                    <p className="text-sm font-sans whitespace-pre-wrap break-words">
                        {selectedLog?.details}
                    </p>
                </div>
            </DialogContent>
        </Dialog>
        </>
    )
}

export default function SecurityLogPage() {
    return <SecurityLogViewer />;
}

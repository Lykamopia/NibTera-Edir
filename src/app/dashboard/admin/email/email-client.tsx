
"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveEmailSettings, getEmailLogs } from "@/app/actions/admin";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Save, Search, ChevronsLeft, ChevronsRight, Eye } from "lucide-react";
import Image from "next/image";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedCallback } from "use-debounce";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/data";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import type { EmailLog } from "@/lib/types";

function EmailTemplateSettings({ initialSettings }: { initialSettings: any }) {
  const [settings, setSettings] = useState({
    notificationsEnabled: initialSettings.notificationsEnabled ?? true,
    headerText: initialSettings.headerText || '',
    bodyText: initialSettings.bodyText || '',
    footerText: initialSettings.footerText || '',
  });
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (initialSettings) {
        setSettings({
            notificationsEnabled: initialSettings.notificationsEnabled ?? true,
            headerText: initialSettings.headerText || '',
            bodyText: initialSettings.bodyText || '',
            footerText: initialSettings.footerText || '',
        });
    }
  }, [initialSettings]);


  const handleSave = async () => {
    setIsSaving(true);
    const result = await saveEmailSettings(settings);
    if (result.success) {
      toast.success("Settings Saved", { description: "Email settings have been updated." });
    } else {
      toast.error("Error", { description: "Could not save settings." });
    }
    setIsSaving(false);
  };

  const processTextForPreview = (text: string) => {
    const planUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3010'}/dashboard/plans?id=...`;
    
    const notificationType = `You have received a new plan from <strong>Sender Name</strong>.`;

    return text
        .replace(/{{notificationType}}/g, notificationType)
        .replace(/{{senderName}}/g, 'Sender Name')
        .replace(/{{subject}}/g, 'Sample Plan Subject')
        .replace(/{{reference}}/g, 'PLAN-2024-XXX')
        .replace(/{{memoUrl}}/g, planUrl)
        .replace(/\n/g, '<br>');
  }

  if (loading) {
    return <div className="space-y-6"><Skeleton className="h-96 w-full" /></div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Template Settings</CardTitle>
        <CardDescription>Customize the content and appearance of email notifications.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label htmlFor="notifications-enabled" className="text-base">
                Email Notifications
                </Label>
                <p className="text-sm text-muted-foreground">
                Enable or disable all outgoing email notifications for new plans.
                </p>
            </div>
            <Switch
                id="notifications-enabled"
                checked={settings.notificationsEnabled}
                onCheckedChange={(checked) => setSettings(prev => ({ ...prev, notificationsEnabled: checked }))}
            />
            </div>
            
            <div className="space-y-2">
                <Label htmlFor="header-text">Email Header Text</Label>
                <Input 
                    id="header-text"
                    value={settings.headerText}
                    onChange={(e) => setSettings(prev => ({ ...prev, headerText: e.target.value }))}
                    placeholder="e.g., New Plan Notification"
                    disabled={!settings.notificationsEnabled}
                />
            </div>
            
            <div className="space-y-2">
                <Label htmlFor="body-text">Email Body Template</Label>
                <Textarea
                    id="body-text"
                    value={settings.bodyText}
                    onChange={(e) => setSettings(prev => ({ ...prev, bodyText: e.target.value }))}
                    placeholder="e.g., Hello, {{notificationType}}"
                    rows={5}
                    disabled={!settings.notificationsEnabled}
                />
                <p className="text-xs text-muted-foreground">
                Use placeholders like `{"{{notificationType}}"}`, `{"{{senderName}}"}`, `{"{{subject}}"}`, `{"{{reference}}"}`, and `{"{{memoUrl}}"}`.
                </p>
            </div>

            <div className="space-y-2">
                <Label htmlFor="footer-text">Email Footer Text</Label>
                <Textarea
                    id="footer-text"
                    value={settings.footerText}
                    onChange={(e) => setSettings(prev => ({ ...prev, footerText: e.target.value }))}
                    placeholder="e.g., This is an automated message. Please do not reply."
                    rows={3}
                    disabled={!settings.notificationsEnabled}
                />
            </div>
        </div>

        <div>
            <Label className="text-base font-semibold">Live Preview</Label>
            <div className="mt-2 rounded-lg border bg-muted/30 p-4">
                <div className="mx-auto max-w-xl rounded-md border bg-card shadow-lg">
                    <div className="p-4 text-center rounded-t-md">
                        <Image src="/Logo.png" alt="Logo" width={60} height={60} className="mx-auto" />
                    </div>
                    <div className="p-6">
                        <h2 className="text-xl font-bold mb-4">{settings.headerText}</h2>
                        <div className="prose prose-sm max-w-none dark:prose-invert"
                            dangerouslySetInnerHTML={{ __html: processTextForPreview(settings.bodyText) }}
                        />
                        <div className="my-6 rounded-md border-l-4 border-accent bg-muted/50 p-4 text-sm">
                            <p><strong>From:</strong> Sender Name</p>
                            <p><strong>Subject:</strong> Sample Plan Subject</p>
                            <p><strong>Reference:</strong> PLAN-2024-XXX</p>
                        </div>
                        <div className="text-center">
                            <Button size="sm" disabled={!settings.notificationsEnabled}>View Full Plan</Button>
                        </div>
                    </div>
                    <div className="bg-muted p-4 text-center text-xs text-muted-foreground rounded-b-md">
                        <p>{settings.footerText}</p>
                    </div>
                </div>
            </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save Settings
        </Button>
      </CardFooter>
    </Card>
  );
}

function EmailLogViewer() {
    const [data, setData] = useState<{ logs: EmailLog[], total: number, totalPages: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit] = useState(15);
    const [filters, setFilters] = useState<{ status?: string; query?: string }>({});
    const [selectedEmail, setSelectedEmail] = useState<EmailLog | null>(null);

    const debouncedSetQuery = useDebouncedCallback((query: string) => {
        setFilters(prev => ({ ...prev, query }));
        setPage(1);
    }, 500);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getEmailLogs(page, limit, filters);
            setData(result);
        } catch (error) {
            toast.error("Failed to fetch email logs.");
        } finally {
            setLoading(false);
        }
    }, [page, limit, filters]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);
    
    const getSanitizedEmailBody = (log: EmailLog) => {
        const isSensitive = ['welcome_user', 'password_reset', 'email_change_notice'].includes(log.triggerEvent || '');

        // Mask sensitive info if any
        const maskedBody = log.body.replace(/<code>(.*?)<\/code>/g, '<code>********</code>');

        // For sensitive auth emails, hide the button container.
        // For all emails, disable links just in case.
        const style = `
            <style>
                a, button {
                    pointer-events: none !important;
                    cursor: default !important;
                    opacity: 0.6 !important;
                }
                ${isSensitive ? `.button-container { display: none !important; }` : ''}
            </style>
        `;
        return style + maskedBody;
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Sent Email Log</CardTitle>
                <CardDescription>Browse and audit all emails sent by the system.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-2 mb-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by recipient, subject, or ID..."
                            className="pl-8 pr-8"
                            onChange={(e) => debouncedSetQuery(e.target.value)}
                        />
                        {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <Select value={filters.status || 'all'} onValueChange={(value) => {
                        setFilters(prev => ({ ...prev, status: value === 'all' ? undefined : value }));
                        setPage(1);
                    }}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="sent">Sent</SelectItem>
                            <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Status</TableHead>
                                <TableHead>To</TableHead>
                                <TableHead>Subject</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell>
                                    </TableRow>
                                ))
                            ) : data && data.logs.length > 0 ? (
                                data.logs.map(log => (
                                    <TableRow key={log.id}>
                                        <TableCell>
                                            <Badge variant={log.status === 'sent' ? 'secondary' : 'destructive'}>{log.status}</Badge>
                                        </TableCell>
                                        <TableCell>{log.to}</TableCell>
                                        <TableCell className="max-w-xs truncate">{log.subject}</TableCell>
                                        <TableCell>{log.triggerEvent}</TableCell>
                                        <TableCell>{formatTimestamp(log.createdAt)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => setSelectedEmail(log)}>
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center">No email logs found.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                {data && data.totalPages > 1 && (
                    <div className="flex justify-between items-center mt-4">
                        <div className="text-sm text-muted-foreground">
                            Page {page} of {data.totalPages} ({data.total} results)
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronsLeft /> Previous</Button>
                            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>Next <ChevronsRight /></Button>
                        </div>
                    </div>
                )}
            </CardContent>
             <Dialog open={!!selectedEmail} onOpenChange={(isOpen) => !isOpen && setSelectedEmail(null)}>
                <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Email Details</DialogTitle>
                        <DialogDescription>
                            Audit trail for email sent to {selectedEmail?.to}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedEmail && (
                        <div className="flex-1 overflow-y-auto pr-4 -mr-6 space-y-4 text-sm">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <p><strong>From:</strong> {selectedEmail.from}</p>
                                <p><strong>To:</strong> {selectedEmail.to}</p>
                                {selectedEmail.cc && <p><strong>CC:</strong> {selectedEmail.cc}</p>}
                                <p><strong>Date:</strong> {formatTimestamp(selectedEmail.createdAt)}</p>
                                <p><strong>Subject:</strong> {selectedEmail.subject}</p>
                                <p><strong>Event:</strong> {selectedEmail.triggerEvent}</p>
                                <p><strong>Related ID:</strong> {selectedEmail.relatedEntityId}</p>
                                <p><strong>Status:</strong> <Badge variant={selectedEmail.status === 'sent' ? 'secondary' : 'destructive'}>{selectedEmail.status}</Badge></p>
                            </div>
                            {selectedEmail.errorMessage && (
                                <div className="p-2 bg-destructive/10 border border-destructive/20 rounded">
                                    <strong>Error:</strong> {selectedEmail.errorMessage}
                                </div>
                            )}
                            <iframe
                                srcDoc={getSanitizedEmailBody(selectedEmail)}
                                className="w-full h-[50vh] border rounded-md"
                                sandbox="allow-same-origin"
                                title="Email Body Preview"
                            />
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    );
}


export default function AdminEmailPageClient({ initialSettings }: { initialSettings: any }) {
    return (
        <Tabs defaultValue="settings" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="settings" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Template Settings</TabsTrigger>
                <TabsTrigger value="log" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Sent Email Log</TabsTrigger>
            </TabsList>
            <TabsContent value="settings">
                <EmailTemplateSettings initialSettings={initialSettings} />
            </TabsContent>
            <TabsContent value="log">
                <EmailLogViewer />
            </TabsContent>
        </Tabs>
    );
}

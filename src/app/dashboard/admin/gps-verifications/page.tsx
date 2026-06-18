'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getGPSVerifications, reviewGPSVerification } from '@/app/actions/admin';
import type { GPSVerification } from '@/lib/types';
import { toast } from 'sonner';
import { handleActionError } from '@/lib/error-handler';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronsLeft, ChevronsRight, Eye, CheckCircle, AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const ITEMS_PER_PAGE = 10;

function GPSVerificationsLoadingSkeleton() {
    return (
        <Card>
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>GPS Verifications</CardTitle>
                <Skeleton className="h-10 w-[150px]" />
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                </div>
            </CardContent>
        </Card>
    );
}

export default function GPSVerificationsPage() {
    const [loading, setLoading] = useState(true);
    const [verifications, setVerifications] = useState<GPSVerification[]>([]);
    const [total, setTotal] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [viewingVerification, setViewingVerification] = useState<GPSVerification | null>(null);
    const [reviewingVerification, setReviewingVerification] = useState<GPSVerification | null>(null);
    const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
    const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const fetchVerifications = useCallback(async (page: number, status?: string) => {
        setLoading(true);
        try {
            const result = await getGPSVerifications(page, ITEMS_PER_PAGE, { 
                status: status && status !== 'all' ? status : undefined 
            });
            setVerifications(result.verifications);
            setTotal(result.total);
        } catch (error) {
            console.error(error);
            toast.error('Failed to load GPS verifications');
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch on component mount
    useEffect(() => {
        fetchVerifications(1, statusFilter);
    }, [fetchVerifications, statusFilter]);

    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

    const handleView = (verification: GPSVerification) => {
        setViewingVerification(verification);
        setIsViewDialogOpen(true);
    };

    const handleReview = (verification: GPSVerification) => {
        setReviewingVerification(verification);
        setIsReviewDialogOpen(true);
    };

    const handleSaveReview = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!reviewingVerification) return;

        const formData = new FormData(e.currentTarget);
        const status = formData.get('status') as 'VERIFIED' | 'REVIEWED';
        const comment = (formData.get('comment') as string) || undefined;

        setIsSaving(true);
        try {
            await reviewGPSVerification({ id: reviewingVerification.id, status, comment });
            toast.success('Successfully reviewed GPS verification');
            await fetchVerifications(currentPage, statusFilter);
            setIsReviewDialogOpen(false);
        } catch (error: any) {
            handleActionError(error, "Failed to Review GPS Verification");
        } finally {
            setIsSaving(false);
        }
    };

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            VERIFIED: 'bg-green-100 text-green-800',
            FLAGGED: 'bg-red-100 text-red-800',
            REVIEWED: 'bg-blue-100 text-blue-800',
        };
        return <Badge className={colors[status] || 'bg-gray-100 text-gray-800'}>{status}</Badge>;
    };

    const formatCoordinates = (lat?: any, lng?: any) => {
        if (!lat || !lng) return '-';
        return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
    };

    const formatDistance = (distance?: any) => {
        if (!distance) return '-';
        const meters = Number(distance);
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(2)} km`;
        }
        return `${meters.toFixed(2)} m`;
    };

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row justify-between items-center">
                    <CardTitle>GPS Verifications</CardTitle>
                    <div className="flex gap-2">
                        <Select value={statusFilter} onValueChange={(val) => {
                            setStatusFilter(val);
                            setCurrentPage(1);
                        }}>
                            <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="Filter by status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="VERIFIED">Verified</SelectItem>
                                <SelectItem value="FLAGGED">Flagged</SelectItem>
                                <SelectItem value="REVIEWED">Reviewed</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <GPSVerificationsLoadingSkeleton />
                    ) : (
                        <>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-12">#</TableHead>
                                            <TableHead>Job</TableHead>
                                            <TableHead>Submitted By</TableHead>
                                            <TableHead>Distance</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Date</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {verifications.map((verification, index) => (
                                            <TableRow key={verification.id}>
                                                <TableCell>{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</TableCell>
                                                <TableCell>{verification.job?.title || 'Unknown Job'}</TableCell>
                                                <TableCell>{verification.job?.createdBy?.name || 'Unknown User'}</TableCell>
                                                <TableCell>{formatDistance(verification.distanceMeters)}</TableCell>
                                                <TableCell>{getStatusBadge(verification.status)}</TableCell>
                                                <TableCell>{format(new Date(verification.createdAt), 'MMM d, yyyy h:mm a')}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="ghost" size="icon" onClick={() => handleView(verification)}>
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        {verification.status !== 'REVIEWED' && (
                                                            <Button variant="ghost" size="icon" onClick={() => handleReview(verification)}>
                                                                <CheckCircle className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="flex justify-between items-center mt-4">
                                <div className="text-sm text-muted-foreground">
                                    Page {currentPage} of {totalPages}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const newPage = Math.max(1, currentPage - 1);
                                            setCurrentPage(newPage);
                                            fetchVerifications(newPage, statusFilter);
                                        }}
                                        disabled={currentPage === 1}
                                    >
                                        <ChevronsLeft /> Previous
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            const newPage = Math.min(totalPages, currentPage + 1);
                                            setCurrentPage(newPage);
                                            fetchVerifications(newPage, statusFilter);
                                        }}
                                        disabled={currentPage === totalPages}
                                    >
                                        Next <ChevronsRight />
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* View Verification Dialog */}
            <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>GPS Verification Details</DialogTitle>
                    </DialogHeader>
                    {viewingVerification && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-sm text-muted-foreground">Job Title</Label>
                                    <p className="font-medium">{viewingVerification.job?.title}</p>
                                </div>
                                <div>
                                    <Label className="text-sm text-muted-foreground">Status</Label>
                                    <div className="mt-1">{getStatusBadge(viewingVerification.status)}</div>
                                </div>
                                <div>
                                    <Label className="text-sm text-muted-foreground">Submitted By</Label>
                                    <p>{viewingVerification.job?.createdBy?.name}</p>
                                </div>
                                <div>
                                    <Label className="text-sm text-muted-foreground">Distance</Label>
                                    <p>{formatDistance(viewingVerification.distanceMeters)}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label className="text-sm text-muted-foreground">Submission Location</Label>
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4" />
                                        <span>{formatCoordinates(viewingVerification.submissionLatitude, viewingVerification.submissionLongitude)}</span>
                                    </div>
                                </div>
                                <div>
                                    <Label className="text-sm text-muted-foreground">Target Location</Label>
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4" />
                                        <span>{formatCoordinates(viewingVerification.targetLatitude, viewingVerification.targetLongitude)}</span>
                                    </div>
                                </div>
                            </div>

                            {viewingVerification.reviewedBy && (
                                <div>
                                    <Label className="text-sm text-muted-foreground">Reviewed By</Label>
                                    <p>{viewingVerification.reviewedBy.name}</p>
                                    {viewingVerification.reviewComment && (
                                        <div className="mt-2">
                                            <Label className="text-sm text-muted-foreground">Review Comment</Label>
                                            <p className="text-sm">{viewingVerification.reviewComment}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Review Verification Dialog */}
            <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Review GPS Verification</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSaveReview}>
                        <fieldset disabled={isSaving}>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="status">Status</Label>
                                    <Select name="status" defaultValue={reviewingVerification?.status === 'FLAGGED' ? 'REVIEWED' : 'VERIFIED'}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select status" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="VERIFIED">Verified</SelectItem>
                                            <SelectItem value="REVIEWED">Reviewed</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="comment">Comment</Label>
                                    <Textarea id="comment" name="comment" rows={3} />
                                </div>
                            </div>
                        </fieldset>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsReviewDialogOpen(false)} disabled={isSaving}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSaving}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Review
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}

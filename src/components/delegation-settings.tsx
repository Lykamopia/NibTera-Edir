
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Checkbox } from './ui/checkbox';
import { RecipientSelector } from './recipient-selector';
import { UserPlus, Trash2, Key, Users, Loader2, Repeat, Edit, MoreHorizontal, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { handleActionError } from '@/lib/error-handler';
import { delegationPermissions } from '@/lib/permissions';
import { addOrUpdateDelegate, removeDelegate } from '@/app/actions/admin';
import type { Delegation, User, DelegationPermission } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Badge } from './ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { DelegationEmptyIllustration } from './delegation-empty-illustration';
import { NoAccessIllustration } from './no-access-illustration';

interface DelegationSettingsProps {
  user: User & { delegations?: Delegation[], delegatedTo?: Delegation[] };
  allUsers: User[];
  onUpdate: () => void;
}

export function DelegationSettings({ user, allUsers, onUpdate }: DelegationSettingsProps) {
    const { update: updateSession } = useSession();
    const router = useRouter();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const [editingDelegation, setEditingDelegation] = useState<Delegation | null>(null);
    const [selectedDelegate, setSelectedDelegate] = useState<User | null>(null);
    
    const [selectedPermissions, setSelectedPermissions] = useState<DelegationPermission[]>([]);
    const [delegationToDelete, setDelegationToDelete] = useState<Delegation | null>(null);
    
    const myDelegates = useMemo(() => user.delegations || [], [user.delegations]);
    const accountsICanAccess = useMemo(() => user.delegatedTo || [], [user.delegatedTo]);

    const availableUsersToDelegate = useMemo(() => {
        const delegatedIds = new Set(myDelegates.map(d => d.delegateId));
        // Requirement: Filter to only include active users
        return allUsers.filter(u => u.id !== user.id && !delegatedIds.has(u.id) && u.status === 'active');
    }, [allUsers, user.id, myDelegates]);

    const handleDialogChange = (open: boolean) => {
        setIsDialogOpen(open);
        if (!open) {
            setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
        }
    };

    const handleAlertChange = (open: boolean) => {
        if (!open) {
            setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
            setDelegationToDelete(null);
        }
    };


    const handleEdit = (delegation: Delegation) => {
        setEditingDelegation(delegation);
        setSelectedDelegate(delegation.delegate);
        setSelectedPermissions((delegation.permissions?.split(',') as DelegationPermission[]) || []);
        handleDialogChange(true);
    };
    
    const handleAddNew = () => {
        setEditingDelegation(null);
        setSelectedDelegate(null);
        setSelectedPermissions([]);
        handleDialogChange(true);
    };
    
    const handleSave = async () => {
        if (!selectedDelegate) {
            toast.error('No delegate selected.');
            return;
        }
        setIsSaving(true);
        try {
            await addOrUpdateDelegate({
                delegateId: selectedDelegate.id,
                permissions: selectedPermissions,
            });
            toast.success(`Delegation for ${selectedDelegate.name} has been ${editingDelegation ? 'updated' : 'saved'}.`);
            onUpdate();
            handleDialogChange(false);
        } catch (error: any) {
            handleActionError(error, "Failed to Save Delegation");
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemove = async () => {
        if (!delegationToDelete) return;
        setIsSaving(true);
        try {
            await removeDelegate(delegationToDelete.id);
            toast.success(`Delegation for ${delegationToDelete.delegate.name} has been revoked.`);
            onUpdate();
            handleAlertChange(false);
        } catch (error: any) {
            handleActionError(error, "Failed to Revoke Delegation");
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleSwitchAccount = async (delegatorId: string) => {
        toast.loading("Switching accounts...", { id: 'account-switch' });
        const res = await updateSession({ switch_to_delegator_id: delegatorId, redirect: false });
        if (res) {
            window.location.href = '/dashboard/plans';
        } else {
            toast.error("Failed to switch accounts.", { id: 'account-switch' });
        }
    }

    // Animation variants
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05,
            },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                type: 'spring',
                stiffness: 100,
                damping: 15,
            },
        },
    };

    return (
        <>
            <div className="space-y-8">
                <Card>
                    <CardHeader className="flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-xl"><Key className="text-primary"/> My Delegates</CardTitle>
                            <CardDescription>Users you have given access to your account.</CardDescription>
                        </div>
                        <Button onClick={handleAddNew}>
                            <UserPlus className="mr-2 h-4 w-4" /> Add Delegate
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <div className="border rounded-lg">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[300px]">User</TableHead>
                                        <TableHead>Permissions</TableHead>
                                        <TableHead className="text-right w-[100px]">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <motion.tbody
                                    variants={containerVariants}
                                    initial="hidden"
                                    animate="visible"
                                >
                                    {myDelegates.length > 0 ? myDelegates.map(delegation => {
                                        const permissions = delegation.permissions ? delegation.permissions.split(',') : [];
                                        return (
                                            <motion.tr key={delegation.id} variants={itemVariants} className="hover:bg-muted/50">
                                                <TableCell>
                                                    <div className="flex items-center gap-4">
                                                        <Avatar className="h-10 w-10">
                                                            <AvatarImage src={delegation.delegate.avatar ?? undefined} alt={delegation.delegate.name} />
                                                            <AvatarFallback>{delegation.delegate.name?.charAt(0)}</AvatarFallback>
                                                        </Avatar>
                                                        <div>
                                                            <p className="font-semibold">{delegation.delegate.name}</p>
                                                            <p className="text-sm text-muted-foreground">{delegation.delegate.email}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        {permissions.map(perm => {
                                                            const permInfo = delegationPermissions.find(p => p.id === perm);
                                                            return (
                                                                <TooltipProvider key={perm}>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <Badge variant="secondary" className="font-normal">{permInfo?.label || perm}</Badge>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>
                                                                            <p>{permInfo?.description}</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            )
                                                        })}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent>
                                                            <DropdownMenuItem onSelect={() => handleEdit(delegation)}><Edit className="mr-2"/>Edit</DropdownMenuItem>
                                                            <DropdownMenuItem onSelect={() => setDelegationToDelete(delegation)} className="text-destructive"><Trash2 className="mr-2"/>Revoke</DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </motion.tr>
                                        );
                                    }) : (
                                        <TableRow>
                                            <TableCell colSpan={3} className="h-48 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <DelegationEmptyIllustration />
                                                    <div className="text-center">
                                                        <p className="font-semibold">No Delegates Yet</p>
                                                        <p className="text-sm text-muted-foreground">Click "Add Delegate" to grant someone access to your account.</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </motion.tbody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-xl"><Users className="text-primary"/> Accounts I Can Access</CardTitle>
                        <CardDescription>Accounts that have been delegated to you by other users.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="border rounded-lg">
                           <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>User</TableHead>
                                        <TableHead className="text-right w-[150px]">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <motion.tbody
                                    variants={containerVariants}
                                    initial="hidden"
                                    animate="visible"
                                >
                                    {accountsICanAccess.length > 0 ? accountsICanAccess.map(delegation => (
                                        <motion.tr key={delegation.id} variants={itemVariants} className="hover:bg-muted/50">
                                            <TableCell>
                                                 <div className="flex items-center gap-4">
                                                    <Avatar className="h-10 w-10">
                                                        <AvatarImage src={delegation.delegator.avatar ?? undefined} alt={delegation.delegator.name} />
                                                        <AvatarFallback>{delegation.delegator.name?.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-semibold">{delegation.delegator.name}</p>
                                                        <p className="text-sm text-muted-foreground">{delegation.delegator.email}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button onClick={() => handleSwitchAccount(delegation.delegatorId)}>
                                                    <Repeat className="mr-2 h-4 w-4" /> Act as
                                                </Button>
                                            </TableCell>
                                        </motion.tr>
                                    )) : (
                                        <TableRow>
                                            <TableCell colSpan={2} className="h-48 text-center">
                                                <div className="flex flex-col items-center justify-center gap-4">
                                                    <NoAccessIllustration />
                                                    <div className="text-center">
                                                        <p className="font-semibold">No Delegated Accounts</p>
                                                        <p className="text-sm text-muted-foreground">When other users delegate access to you, their accounts will appear here.</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </motion.tbody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
            
            <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5 text-primary" />
                            {editingDelegation ? `Edit Delegation for ${editingDelegation.delegate.name}` : 'Add a New Delegate'}
                        </DialogTitle>
                        <DialogDescription>Select a user and grant them specific permissions to act on your behalf.</DialogDescription>
                    </DialogHeader>
                    <fieldset disabled={isSaving} className="py-2">
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Delegate</Label>
                                <RecipientSelector 
                                    allUsers={editingDelegation ? [editingDelegation.delegate] : availableUsersToDelegate}
                                    selected={selectedDelegate ? [selectedDelegate] : []}
                                    setSelected={(users) => setSelectedDelegate(users[0] || null)}
                                    placeholder="Search for a user by name, email, or title..."
                                    className={cn(
                                        "bg-background",
                                        editingDelegation && "bg-muted pointer-events-none opacity-80"
                                    )}
                                    hideBulkOptions={true}
                                    usePortal={false}
                                    closeOnSelect={true}
                                />
                            </div>
                            
                            <AnimatePresence mode="wait">
                                {selectedDelegate && (
                                    <motion.div 
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="space-y-4"
                                    >
                                        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                                            <Avatar className="h-10 w-10">
                                                <AvatarImage src={selectedDelegate.avatar || undefined} alt={selectedDelegate.name} />
                                                <AvatarFallback>{selectedDelegate.name.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <div>
                                                <p className="text-sm font-semibold">{selectedDelegate.name}</p>
                                                <p className="text-xs text-muted-foreground">{selectedDelegate.email}</p>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Permissions</Label>
                                            <div className="grid gap-2 p-4 rounded-xl border bg-muted/30 max-h-[280px] overflow-y-auto scrollbar-thin scrollbar-thumb-primary/10 hover:scrollbar-thumb-primary/20">
                                                {delegationPermissions.map(permission => (
                                                    <label 
                                                        key={permission.id} 
                                                        className={cn(
                                                            "flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer hover:bg-background",
                                                            selectedPermissions.includes(permission.id) ? "border-primary bg-primary/5 shadow-sm" : "border-transparent bg-transparent"
                                                        )}
                                                    >
                                                        <Checkbox
                                                            id={`perm-${permission.id}`}
                                                            checked={selectedPermissions.includes(permission.id)}
                                                            onCheckedChange={(checked) => {
                                                                setSelectedPermissions(prev => 
                                                                    checked
                                                                    ? [...prev, permission.id]
                                                                    : prev.filter(p => p !== permission.id)
                                                                );
                                                            }}
                                                            className="mt-1"
                                                        />
                                                        <div className="grid gap-1">
                                                            <span className="text-sm font-semibold leading-none">{permission.label}</span>
                                                            <span className="text-xs text-muted-foreground leading-snug">{permission.description}</span>
                                                        </div>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </fieldset>
                    <DialogFooter className="gap-2 sm:gap-0 border-t pt-4">
                        <Button variant="ghost" onClick={() => handleDialogChange(false)} disabled={isSaving}>Cancel</Button>
                        <Button 
                            onClick={handleSave} 
                            disabled={!selectedDelegate || isSaving || selectedPermissions.length === 0}
                            className="min-w-[140px]"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                editingDelegation ? 'Update Delegation' : 'Grant Access'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!delegationToDelete} onOpenChange={handleAlertChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will immediately revoke all delegated access for <strong>{delegationToDelete?.delegate.name}</strong>. They will no longer be able to act on your behalf.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel 
                            onClick={(e) => {
                                e.preventDefault();
                                handleAlertChange(false);
                            }} 
                            disabled={isSaving}
                        >
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={handleRemove} className="bg-destructive hover:bg-destructive/90" disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Revoke Access'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

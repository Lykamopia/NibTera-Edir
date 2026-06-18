
"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveOffice, deleteOffice } from "@/app/actions/admin";
import type { Office } from "@/lib/types";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffices } from "../hooks";
import { ChevronsLeft, ChevronsRight, MoreHorizontal, Trash2, Edit, PlusCircle, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";


const ITEMS_PER_PAGE = 10;

function OfficesLoadingSkeleton() {
    return (
        <Card>
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>Offices</CardTitle>
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
    )
}

export default function OfficesPage() {
  const { data: offices, loading, mutate } = useOffices();
  
  const [editingOffice, setEditingOffice] = useState<Partial<Office> | null>(null);
  const [deletingOffice, setDeletingOffice] = useState<Office | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedType, setSelectedType] = useState<string>('branch_office');

  const paginatedOffices = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return offices.slice(start, end);
  }, [offices, currentPage]);

  const totalPages = Math.ceil(offices.length / ITEMS_PER_PAGE);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const code = formData.get('code') as string;
    
    if (!name || !code) {
        toast.error("Error", { description: "Name and code are required." });
        return;
    }

    const officeData = {
        id: editingOffice?.id,
        name,
        code,
        type: selectedType as 'branch_office' | 'division_office' | 'head_office',
    };

    setIsSaving(true);
    try {
      await saveOffice(officeData);
      await mutate();
      toast.success("Success", { description: `Office ${editingOffice?.id ? 'updated' : 'created'} successfully.` });
      handleDialogChange(false);
    } catch (error: any) {
      handleActionError(error, "Failed to Save Office");
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleEdit = (office: Office) => {
    setEditingOffice(office);
    setSelectedType(office.type || 'branch_office');
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setEditingOffice(null);
    setSelectedType('branch_office');
    setIsDialogOpen(true);
  };

  const handleDelete = (office: Office) => {
    setDeletingOffice(office);
    setIsAlertOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingOffice) return;
    setIsDeleting(true);
    try {
      const result = await deleteOffice(deletingOffice.id);
      if (result.error) {
        toast.error("Error", { description: result.error });
      } else {
        toast.success("Success", { description: "Office deleted successfully." });
        await mutate();
      }
    } catch (error: any) {
      handleActionError(error, "Failed to Delete Office");
    } finally {
      setIsDeleting(false);
      handleAlertChange(false);
    }
  };

  const handleDialogChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
      setEditingOffice(null);
    }
  };
  
  const handleAlertChange = (open: boolean) => {
    setIsAlertOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
      setDeletingOffice(null);
    }
  };

  if (loading) {
    return <OfficesLoadingSkeleton />;
  }

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle>Offices</CardTitle>
        <Button onClick={handleAddNew}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Office
        </Button>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md">
            <Table>
            <TableHeader>
                <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {paginatedOffices.map((office, index) => (
                <TableRow key={office.id}>
                    <TableCell>{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</TableCell>
                    <TableCell>{office.name}</TableCell>
                    <TableCell>{office.code}</TableCell>
                    <TableCell>
                        {office.type === 'head_office' ? 'Head Office' : 
                         office.type === 'division_office' ? 'Division Office' : 
                         'Branch Office'}
                    </TableCell>
                    <TableCell className="text-right">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onSelect={() => handleEdit(office)}><Edit className="mr-2"/>Edit</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleDelete(office)} className="text-destructive"><Trash2 className="mr-2"/>Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
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
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}><ChevronsLeft/> Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next <ChevronsRight/></Button>
            </div>
        </div>

        
      </CardContent>
    </Card>

    <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent>
        <DialogHeader>
            <DialogTitle>{editingOffice?.id ? 'Edit Office' : 'Add New Office'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave}>
            <fieldset disabled={isSaving}>
                <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">Name</Label>
                    <Input id="name" name="name" defaultValue={editingOffice?.name} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="code" className="text-right">Code</Label>
                    <Input id="code" name="code" defaultValue={editingOffice?.code} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="type" className="text-right">Type</Label>
                    <Select value={selectedType} onValueChange={setSelectedType}>
                        <SelectTrigger className="col-span-3">
                            <SelectValue placeholder="Select office type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="head_office">Head Office</SelectItem>
                            <SelectItem value="division_office">Division Office</SelectItem>
                            <SelectItem value="branch_office">Branch Office</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                </div>
            </fieldset>
            <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={isSaving}>Cancel</Button>
            <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
            </Button>
            </DialogFooter>
        </form>
        </DialogContent>
    </Dialog>

    <AlertDialog open={isAlertOpen} onOpenChange={handleAlertChange}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the office '{deletingOffice?.name}'.
                </AlertDialogDescription>
            </AlertDialogHeader>
                <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive hover:bg-destructive/90" disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Delete'}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    </>
  );
}


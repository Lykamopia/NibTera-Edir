
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
  DialogDescription,
  DialogTrigger,
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
import { saveDivision, deleteDivision, bulkImportDivisions, type BulkImportResult } from "@/app/actions/admin";
import type { Division } from "@/lib/types";
import { toast } from "sonner";
import { handleActionError } from "@/lib/error-handler";
import { Skeleton } from "@/components/ui/skeleton";
import { useDivisions, useDepartments, useOffices } from "../hooks";
import { ChevronsLeft, ChevronsRight, MoreHorizontal, Trash2, Edit, PlusCircle, Loader2, UploadCloud, Download, FileSpreadsheet, CheckCircle, XCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Combobox } from "@/components/ui/combobox";
import Papa from "papaparse";
import * as XLSX from "xlsx";


const ITEMS_PER_PAGE = 10;

function DivisionImportDialog({ onComplete }: { onComplete: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      const allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
      if (!allowedTypes.includes(selectedFile.type) && !selectedFile.name.endsWith('.csv') && !selectedFile.name.endsWith('.xlsx')) {
        toast.error("Invalid File Type", { description: "Please upload a CSV or XLSX file." });
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [{ 
        name: "Client Services", 
        code: "CS-001",
        department: "Retail Banking",
        office: "Head Office"
    }];
    const csv = Papa.unparse(templateData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'division_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleImport = async () => {
    if (!file) return;
    setProcessing(true);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            let csvData = '';
            if (file.name.endsWith('.csv')) {
                csvData = e.target?.result as string;
            } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                csvData = XLSX.utils.sheet_to_csv(firstSheet);
            } else {
                toast.error("Invalid File Type", { description: "Please upload a CSV or XLSX file." });
                setProcessing(false);
                return;
            }
            const importResult = await bulkImportDivisions(csvData);
            setResult(importResult);
            if (importResult.successCount > 0) {
              onComplete();
            }
        } catch (error: any) {
            handleActionError(error, "Import Failed");
        } finally {
            setProcessing(false);
        }
    };
    if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
    } else {
        reader.readAsArrayBuffer(file);
    }
  };
  
  const resetState = () => {
    setFile(null);
    setProcessing(false);
    setResult(null);
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
      resetState();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline"><UploadCloud className="mr-2"/> Import</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Divisions</DialogTitle>
          <DialogDescription>
            Import multiple divisions at once by uploading a CSV or XLSX file.
          </DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="py-4 space-y-6">
            <div className="p-4 rounded-md border border-dashed bg-muted/50 text-center">
                <h3 className="font-semibold text-lg">1. Download Template</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    Start by downloading the CSV template. Use a spreadsheet program to fill it out.
                </p>
                <Button variant="secondary" size="sm" className="mt-4" onClick={handleDownloadTemplate}>
                    <Download className="mr-2" /> Download CSV Template
                </Button>
            </div>

            <div className="p-4 rounded-md border border-dashed bg-muted/50 text-center">
                <h3 className="font-semibold text-lg">2. Upload File</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    Once you've filled out the template, upload the saved CSV or XLSX file here.
                </p>
                <div 
                    className="mt-4 flex justify-center items-center h-24 border-2 border-dashed rounded-md cursor-pointer hover:border-primary"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv, text/csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"/>
                    {file ? (
                        <div className="text-center">
                            <FileSpreadsheet className="h-6 w-6 mx-auto text-green-500" />
                            <p className="text-sm font-medium">{file.name}</p>
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground">Click to select a CSV or XLSX file</div>
                    )}
                </div>
            </div>
            
            <DialogFooter>
              <Button onClick={handleImport} disabled={!file || processing}>
                {processing ? <Loader2 className="mr-2 animate-spin"/> : <UploadCloud className="mr-2"/>}
                {processing ? "Importing..." : "Start Import"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="py-4 space-y-4">
              <div className="text-center">
                  <h3 className="text-xl font-bold">Import Complete</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-green-100/60 dark:bg-green-900/40 rounded-lg text-center">
                      <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-3xl font-bold">{result.successCount}</p>
                      <p className="text-sm text-muted-foreground">Divisions Imported</p>
                  </div>
                  <div className="p-4 bg-red-100/60 dark:bg-red-900/40 rounded-lg text-center">
                      <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
                      <p className="text-3xl font-bold">{result.errorCount}</p>
                      <p className="text-sm text-muted-foreground">Rows Failed</p>
                  </div>
              </div>
              {result.errorCount > 0 && (
                  <div className="space-y-2">
                      <h4 className="font-semibold">Failure Details:</h4>
                      <div className="max-h-48 overflow-y-auto border rounded-md p-2 bg-muted/50 text-sm">
                          <Table>
                              <TableHeader>
                                  <TableRow>
                                      <TableHead>Row</TableHead>
                                      <TableHead>Name</TableHead>
                                      <TableHead>Error</TableHead>
                                  </TableRow>
                              </TableHeader>
                              <TableBody>
                                  {result.errors.map((err, i) => (
                                      <TableRow key={i}>
                                          <TableCell>{err.rowIndex}</TableCell>
                                          <TableCell>{err.email}</TableCell>
                                          <TableCell>{err.error}</TableCell>
                                      </TableRow>
                                  ))}
                              </TableBody>
                          </Table>
                      </div>
                  </div>
              )}
              <DialogFooter>
                  <Button onClick={() => handleOpenChange(false)}>Close</Button>
              </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DivisionsLoadingSkeleton() {
    return (
        <Card>
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>Divisions</CardTitle>
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

export default function DivisionsPage() {
  const { data: divisions, loading, mutate } = useDivisions();
  const { data: departments, loading: loadingDepts } = useDepartments();
  
  const [editingDivision, setEditingDivision] = useState<Partial<Division> | null>(null);
  const [deletingDivision, setDeletingDivision] = useState<Division | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | undefined>(undefined);

  const paginatedDivisions = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return divisions.slice(start, end);
  }, [divisions, currentPage]);

  const totalPages = Math.ceil(divisions.length / ITEMS_PER_PAGE);

  useEffect(() => {
    if (isDialogOpen && editingDivision) {
      setSelectedDepartmentId((editingDivision as Division).departmentId);
    } else if (isDialogOpen && !editingDivision) {
      setSelectedDepartmentId(undefined);
    }
  }, [isDialogOpen, editingDivision]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const code = formData.get('code') as string;
    
    if (!name || !code || !selectedDepartmentId) {
        toast.error("Error", { description: "All fields are required." });
        return;
    }

    const divisionData = {
        id: editingDivision?.id,
        name,
        code,
        departmentId: selectedDepartmentId,
    }

    setIsSaving(true);
    try {
      await saveDivision(divisionData);
      await mutate();
      toast.success("Success", { description: `Division ${editingDivision?.id ? 'updated' : 'created'} successfully.` });
      handleDialogChange(false);
    } catch (error: any) {
      handleActionError(error, "Failed to Save Division");
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleEdit = (division: Division) => {
    setEditingDivision(division);
    setIsDialogOpen(true);
  }

  const handleAddNew = () => {
    setEditingDivision(null);
    setIsDialogOpen(true);
  }

  const handleDelete = (division: Division) => {
    setDeletingDivision(division);
    setIsAlertOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingDivision) return;
    setIsDeleting(true);
    try {
      const result = await deleteDivision(deletingDivision.id);
      if (result && result.error) {
        toast.error("Error", { description: result.error });
      } else {
        toast.success("Success", { description: "Division deleted successfully." });
        await mutate();
      }
    } catch (error: any) {
      handleActionError(error, "Failed to Delete Division");
    } finally {
      setIsDeleting(false);
      handleAlertChange(false);
    }
  };

  const handleDialogChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
      setEditingDivision(null);
      setSelectedDepartmentId(undefined);
    }
  }
  
  const handleAlertChange = (open: boolean) => {
    setIsAlertOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
      setDeletingDivision(null);
    }
  }

  const getDepartmentName = (departmentId: string) => {
      return departments.find(d => d.id === departmentId)?.name || 'N/A';
  }

  const departmentOptions = departments.map(d => ({ value: d.id, label: d.name }));

  if (loading || loadingDepts) {
    return <DivisionsLoadingSkeleton />;
  }

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle>Divisions</CardTitle>
        <div className="flex gap-2">
            <DivisionImportDialog onComplete={mutate} />
            <Button onClick={handleAddNew}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Division
            </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md">
            <Table>
            <TableHeader>
                <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Actions</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {paginatedDivisions.map((division, index) => (
                <TableRow key={division.id}>
                    <TableCell>{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</TableCell>
                    <TableCell>{division.name}</TableCell>
                    <TableCell>{division.code}</TableCell>
                    <TableCell>{getDepartmentName(division.departmentId)}</TableCell>
                    <TableCell className="text-right">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onSelect={() => handleEdit(division)}><Edit className="mr-2"/>Edit</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleDelete(division)} className="text-destructive"><Trash2 className="mr-2"/>Delete</DropdownMenuItem>
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
            <DialogTitle>{editingDivision?.id ? "Edit Division" : "Add New Division"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave}>
            <fieldset disabled={isSaving}>
                <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="name" className="text-right">Name</Label>
                    <Input id="name" name="name" defaultValue={editingDivision?.name} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="code" className="text-right">Code</Label>
                    <Input id="code" name="code" defaultValue={editingDivision?.code} className="col-span-3" />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="departmentId" className="text-right">Department</Label>
                    <Combobox
                        options={departmentOptions}
                        value={selectedDepartmentId}
                        onChange={setSelectedDepartmentId}
                        placeholder="Select a department"
                        searchPlaceholder="Search departments..."
                        className="col-span-3"
                    />
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
                    This action cannot be undone. This will permanently delete the division '{deletingDivision?.name}'.
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

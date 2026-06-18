
"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { saveUser, bulkImportUsers, type BulkImportResult, getAdminUsers, deleteUser, lockUser, unlockUser, adminResetUserPassword, getAssignableRoles, getUserManagementContext } from "@/app/actions/admin";
import { handleActionError } from "@/lib/error-handler";
import { exportAllUsers } from "@/app/actions/users";
import type { User, Role, Office, Department, Division, District, Branch, LoggedInUser } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffices, useRoles, useDepartments, useDivisions, useDistricts, useBranches } from "../hooks";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Copy, ShieldCheck, ShieldOff, UserPlus, ChevronsLeft, ChevronsRight, FileDown, Pencil, Loader2, UploadCloud, Download, CheckCircle, XCircle, FileSpreadsheet, Search, FilterX, Eye, User as UserIcon, Mail, Shield, Building, Fingerprint, Info, Globe, Calendar, Lock, AlertCircle, AlertTriangle, History, MousePointer2, Trash2, KeyRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useDebouncedCallback } from "use-debounce";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTimestamp } from "@/lib/data";
import { formatDistanceToNow } from "date-fns";

type UserWithRelations = User & {
    office: Office;
    role: Role;
    department?: Department;
    division?: Division;
    district?: District;
    branch?: Branch;
    createdAt?: string;
    updatedAt?: string;
    failedLoginAttempts?: number;
    lockoutUntil?: string | null;
};

function UserImportDialog({ onComplete }: { onComplete: () => void }) {
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
        name: "Jane Doe",
        email: "jane.doe@example.com",
        role: "Member",
        office: "Head Office",
        department: "Retail Banking",
        division: "Client Services",
        district: "",
        branch: ""
    }];
    const csv = Papa.unparse(templateData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'user_import_template.csv');
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
            const importResult = await bulkImportUsers(csvData);
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
          <DialogTitle>Bulk Import Users</DialogTitle>
          <DialogDescription>
            Import multiple users at once by uploading a CSV or XLSX file.
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
                      <p className="text-sm text-muted-foreground">Users Imported</p>
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
                                      <TableHead>Email</TableHead>
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


function UsersLoadingSkeleton() {
    return (
        <Card>
            <CardHeader className="flex flex-row justify-between items-center">
                <CardTitle>Users</CardTitle>
                <Skeleton className="h-10 w-[150px]" />
            </CardHeader>
            <CardContent>
                 <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                </div>
            </CardContent>
        </Card>
    )
}

const initialFormState = {
    id: '', name: '', email: '', roleId: '', status: 'active',
    officeId: '', departmentId: '', divisionId: '', districtId: '', branchId: ''
};

export default function UsersClient({ user }: { user: LoggedInUser | null }) {
  const { data: offices, loading: loadingOffices } = useOffices();
  const { data: allRoles, loading: loadingRoles } = useRoles();
  const { data: departments, loading: loadingDepts } = useDepartments();
  const { data: divisions, loading: loadingDivisions } = useDivisions();
  const { data: districts, loading: loadingDistricts } = useDistricts();
  const { data: branches, loading: loadingBranches } = useBranches();

  const userPermissions = useMemo(() => user?.role?.permissions?.split(',') || [], [user?.role?.permissions]);
  const canResetPassword = userPermissions.includes('reset_password');

  // ── Delegated user-management scope ───────────────────────────────────────
  // The manager's authority (branch / district / organization) governs which
  // users are visible and which roles can be assigned. The list itself is
  // already scoped on the server; these drive the UI affordances.
  const [scopeCtx, setScopeCtx] = useState<Awaited<ReturnType<typeof getUserManagementContext>> | null>(null);
  const [assignableRoles, setAssignableRoles] = useState<Role[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [ctx, ar] = await Promise.all([getUserManagementContext(), getAssignableRoles()]);
        setScopeCtx(ctx);
        setAssignableRoles(ar as Role[]);
      } catch (error) {
        handleActionError(error);
      }
    })();
  }, []);

  // Roles the current manager may actually assign (subset of their own perms).
  // Falls back to the full list only until the scoped list has loaded.
  const roles = assignableRoles.length > 0 ? assignableRoles : (scopeCtx ? [] : allRoles);
  const scopeLevel = scopeCtx?.scope.level ?? 'organization';
  const isScopedManager = scopeLevel !== 'organization';

  const [users, setUsers] = useState<UserWithRelations[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [officeFilter, setOfficeFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [districtFilter, setDistrictFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [limit] = useState(10);

  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLockDialogOpen, setIsLockDialogOpen] = useState(false);
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [viewingUser, setViewingUser] = useState<UserWithRelations | null>(null);
  const [editingUser, setEditingUser] = useState<UserWithRelations | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserWithRelations | null>(null);
  const [lockingUser, setLockingUser] = useState<UserWithRelations | null>(null);
  const [resettingPasswordUser, setResettingPasswordUser] = useState<UserWithRelations | null>(null);
  const [lockDuration, setLockDuration] = useState("1h");

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const [formState, setFormState] = useState(initialFormState);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
        const result = await getAdminUsers(currentPage, limit, {
            query: searchQuery,
            status: statusFilter,
            roleId: roleFilter,
            officeId: officeFilter,
            departmentId: deptFilter,
            districtId: districtFilter,
            branchId: branchFilter,
        });
        setUsers(result.users as UserWithRelations[]);
        setTotalUsers(result.total);
        setTotalPages(result.totalPages);
    } catch (error) {
        handleActionError(error);
    } finally {
        setLoading(false);
    }
  }, [currentPage, limit, searchQuery, statusFilter, roleFilter, officeFilter, deptFilter, districtFilter, branchFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const debouncedSearch = useDebouncedCallback((value) => {
    setSearchQuery(value);
    setCurrentPage(1);
  }, 500);

  const clearFilters = () => {
      setSearchQuery('');
      setStatusFilter('all');
      setRoleFilter('all');
      setOfficeFilter('all');
      setDeptFilter('all');
      setDistrictFilter('all');
      setBranchFilter('all');
      setCurrentPage(1);
  }

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setIsSaving(true);
    try {
        const result = await saveUser(formState as any);
        if (result.error) {
            handleActionError(result.error, "Error Saving User");
            return;
        }

        await fetchUsers();
        toast.success("Success", { description: editingUser ? "User updated successfully." : "User created successfully." });
        handleDialogChange(false);
    } catch (error: any) {
        handleActionError(error, "Failed to Save User");
    } finally {
        setIsSaving(false);
    }
  };

  const handleDialogChange = (open: boolean) => {
    setIsFormDialogOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
      setEditingUser(null);
      setFormState(initialFormState);
    }
  };

  const handleDetailsDialogChange = (open: boolean) => {
    setIsDetailsDialogOpen(open);
    if (!open) {
        setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
        setViewingUser(null);
    }
  }

  const handleEdit = (user: UserWithRelations) => {
    setEditingUser(user);
    setFormState({
        ...initialFormState,
        id: user.id,
        name: user.name || '',
        email: user.email || '',
        roleId: user.roleId || '',
        officeId: user.officeId || '',
        departmentId: user.departmentId || '',
        divisionId: user.divisionId || '',
        districtId: user.districtId || '',
        branchId: user.branchId || '',
        status: user.status || '',
    });
    setIsFormDialogOpen(true);
  }

  const handleViewDetails = (user: UserWithRelations) => {
      setViewingUser(user);
      setIsDetailsDialogOpen(true);
  }

  const handleAddNew = () => {
    setEditingUser(null);
    // Pre-fill (and effectively lock) the org unit to the manager's own scope so
    // a scoped manager can only create users inside their branch/district.
    setFormState({
      ...initialFormState,
      districtId: scopeCtx?.scope.districtId || '',
      branchId: scopeCtx?.scope.branchId || '',
    });
    setIsFormDialogOpen(true);
  }

  const handleDelete = async () => {
    if (!deletingUser) return;

    setIsDeleting(true);
    try {
        const result = await deleteUser(deletingUser.id);
        if (result?.error) {
            handleActionError(result.error, "Error Deleting User");
            return;
        }

        await fetchUsers();
        toast.success("Success", { description: "User deleted successfully." });
        setIsDeleteDialogOpen(false);
        setDeletingUser(null);
        setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
    } catch (error: any) {
        handleActionError(error, "Failed to Delete User");
    } finally {
        setIsDeleting(false);
    }
  };

  const handleLock = async () => {
    if (!lockingUser) return;
    setIsLocking(true);

    try {
      const lockUntil = new Date();
      switch (lockDuration) {
        case "1h":
          lockUntil.setHours(lockUntil.getHours() + 1);
          break;
        case "1d":
          lockUntil.setDate(lockUntil.getDate() + 1);
          break;
        case "7d":
          lockUntil.setDate(lockUntil.getDate() + 7);
          break;
        case "30d":
          lockUntil.setDate(lockUntil.getDate() + 30);
          break;
        case "permanent":
          lockUntil.setFullYear(lockUntil.getFullYear() + 100);
          break;
      }

      const result = await lockUser(lockingUser.id, lockUntil);
      if (result?.error) {
        handleActionError(result.error, "Error Locking User");
        return;
      }

      await fetchUsers();
      toast.success("Success", { description: "User locked successfully." });
      setIsLockDialogOpen(false);
      setLockingUser(null);
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
    } catch (error: any) {
      handleActionError(error, "Failed to Lock User");
    } finally {
      setIsLocking(false);
    }
  };

  const handleUnlock = async (user: UserWithRelations) => {
    setIsLocking(true);
    try {
      const result = await unlockUser(user.id);
      if (result?.error) {
        handleActionError(result.error, "Error Unlocking User");
        return;
      }
      await fetchUsers();
      toast.success("Success", { description: "User unlocked successfully." });
    } catch (error: any) {
      handleActionError(error, "Failed to Unlock User");
    } finally {
      setIsLocking(false);
    }
  }

  const handleResetPassword = async () => {
    if (!resettingPasswordUser) return;
    setIsResettingPassword(true);
    try {
      const result = await adminResetUserPassword(resettingPasswordUser.id);
      if (result?.error) {
        handleActionError(result.error, "Error Sending Password Reset");
        return;
      }
      toast.success("Success", { description: `Password reset email sent to ${resettingPasswordUser.email}.` });
      setIsResetPasswordDialogOpen(false);
      setResettingPasswordUser(null);
      setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
    } catch (error: any) {
      handleActionError(error, "Failed to Send Password Reset");
    } finally {
      setIsResettingPassword(false);
    }
  }

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (mode: 'selected' | 'all') => {
    setIsExporting(true);
    try {
        let dataToExport: any[] = [];

        if (mode === 'selected') {
            const selectedData = users.filter(u => selectedUsers.includes(u.id));
            dataToExport = selectedData;
        } else {
            // Fetch all users matching current filters without pagination
            const allFilteredUsers = await exportAllUsers({
                query: searchQuery,
                status: statusFilter,
                roleId: roleFilter,
                officeId: officeFilter,
                departmentId: deptFilter,
            });
            dataToExport = allFilteredUsers;
        }

        const formattedData = dataToExport.map((user, index) => ({
            "#": index + 1,
            "Name": user.name || '',
            "Email": user.email || '',
            "Role": user.role?.name || '',
            "Status": user.status || '',
            "Office": user.office?.name || '',
            "Department": user.department?.name || '',
            "Division": user.division?.name || '',
            "District": user.district?.name || '',
            "Branch": user.branch?.name || '',
        }));

        const csv = Papa.unparse(formattedData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `user_directory_${mode}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        if (mode === 'selected') {
            setSelectedUsers([]);
        }
        toast.success(`Exported ${formattedData.length} users successfully.`);
    } catch (error) {
        handleActionError(error, "Export Failed");
    } finally {
        setIsExporting(false);
    }
  }

  const officeOptions = offices.map(o => ({ value: o.id, label: o.name }));
  const roleOptions = roles.map(r => ({ value: r.id, label: r.name }));

  const handleFormChange = (field: keyof typeof formState, value: string) => {
      setFormState(prev => ({ ...prev, [field]: value }));
  }

  const selectedOffice = offices.find(o => o.id === formState.officeId);

  const departmentOptions = departments
    .filter(d => d.officeId === formState.officeId)
    .map(d => ({ value: d.id, label: d.name }));

  const divisionOptions = divisions
    .filter(d => d.departmentId === formState.departmentId)
    .map(d => ({ value: d.id, label: d.name }));

  const districtOptions = districts
    .filter(d => d.officeId === formState.officeId)
    .map(d => ({ value: d.id, label: d.name }));

  const branchOptions = branches
    .filter(b => b.districtId === formState.districtId)
    .map(b => ({ value: b.id, label: b.name }));

  const HEAD_OFFICE_PERMS = ['create_plans','approve_plans_head_office','edit_active_plans','allocate_plans_to_districts','approve_district_allocations','manage_users','manage_roles','manage_general_settings','manage_email_settings','manage_districts','manage_branches','manage_offices','view_all_reports'];

  const scopeWarnings = useMemo(() => {
    if (!formState.roleId || (!formState.branchId && !formState.districtId)) return [];
    const selectedRole = roles.find(r => r.id === formState.roleId);
    if (!selectedRole) return [];
    const rolePerms = (selectedRole as any).permissions?.split(',') ?? [];
    const conflicting: string[] = rolePerms.filter((p: string) => HEAD_OFFICE_PERMS.includes(p));
    if (conflicting.length === 0) return [];
    const scope = formState.branchId ? 'branch' : 'district';
    const names = conflicting.slice(0, 3).map((p: string) => p.replace(/_/g, ' ')).join(', ');
    return [`This role includes ${conflicting.length} head office permission${conflicting.length > 1 ? 's' : ''} (${names}${conflicting.length > 3 ? '…' : ''}) typically reserved for head office users. This user is assigned to a ${scope}, which may be a configuration issue.`];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formState.roleId, formState.branchId, formState.districtId, roles]);

  const getUserAssignment = (user: UserWithRelations) => {
      const path = [user.office?.name];
      if(user.department) path.push(user.department.name);
      if(user.division) path.push(user.division.name);
      if(user.district) path.push(user.district.name);
      if(user.branch) path.push(user.branch.name);
      return path.filter(Boolean).join(' / ');
  }

  if (loadingOffices || loadingRoles || loadingDepts || loadingDivisions || loadingDistricts || loadingBranches) {
    return <UsersLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
        {isScopedManager && scopeCtx && (
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/30">
                <Building className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="text-sm">
                    <p className="font-medium text-blue-900 dark:text-blue-200">
                        You are managing users for {scopeCtx.label}.
                    </p>
                    <p className="text-blue-700/80 dark:text-blue-300/80">
                        Only users within your {scopeLevel === 'branch' ? 'branch' : 'district'} are shown, and you can
                        assign only roles within your own authority. Actions on users outside your scope are blocked.
                    </p>
                </div>
            </div>
        )}
        <Card>
            <CardHeader>
                <div className="flex flex-row justify-between items-center">
                    <CardTitle>User Directory</CardTitle>
                    <div className="flex gap-2">
                        {(scopeCtx?.can.manage ?? userPermissions.includes('manage_users')) && (
                            <Button onClick={handleAddNew}>
                                <UserPlus className="mr-2 h-4 w-4" />
                                Add New
                            </Button>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" disabled={isExporting}>
                                    {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
                                    Export Data
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem disabled={selectedUsers.length === 0} onClick={() => handleExport('selected')}>
                                    Export Selected ({selectedUsers.length})
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleExport('all')}>
                                    Export All ({totalUsers})
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
                    <div className="relative xl:col-span-2">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search name or email..."
                            className="pl-8 pr-8"
                            defaultValue={searchQuery}
                            onChange={(e) => debouncedSearch(e.target.value)}
                        />
                        {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>

                    <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Statuses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                        </SelectContent>
                    </Select>

                    <Combobox
                        options={[{ value: 'all', label: 'All Roles' }, ...roleOptions]}
                        value={roleFilter}
                        onChange={(v) => { setRoleFilter(v); setCurrentPage(1); }}
                        placeholder="Filter by Role"
                        searchPlaceholder="Search roles..."
                    />

                    <Combobox
                        options={[{ value: 'all', label: 'All Offices' }, ...officeOptions]}
                        value={officeFilter}
                        onChange={(v) => {
                            setOfficeFilter(v);
                            setDeptFilter('all');
                            setDistrictFilter('all');
                            setBranchFilter('all');
                            setCurrentPage(1);
                        }}
                        placeholder="Filter by Office"
                        searchPlaceholder="Search offices..."
                    />

                    <Combobox
                        options={[
                            { value: 'all', label: 'All Departments' },
                            ...departments
                                .filter(d => officeFilter === 'all' || d.officeId === officeFilter)
                                .map(d => ({ value: d.id, label: d.name }))
                        ]}
                        value={deptFilter}
                        onChange={(v) => { setDeptFilter(v); setCurrentPage(1); }}
                        placeholder="Filter by Dept"
                        searchPlaceholder="Search departments..."
                    />

                    <Combobox
                        options={[
                            { value: 'all', label: 'All Districts' },
                            ...districts
                                .filter(d => officeFilter === 'all' || d.officeId === officeFilter)
                                .map(d => ({ value: d.id, label: d.name }))
                        ]}
                        value={districtFilter}
                        onChange={(v) => {
                            setDistrictFilter(v);
                            setBranchFilter('all');
                            setCurrentPage(1);
                        }}
                        placeholder="Filter by District"
                        searchPlaceholder="Search districts..."
                    />

                    <Combobox
                        options={[
                            { value: 'all', label: 'All Branches' },
                            ...branches
                                .filter(b => districtFilter === 'all' || b.districtId === districtFilter)
                                .map(b => ({ value: b.id, label: b.name }))
                        ]}
                        value={branchFilter}
                        onChange={(v) => { setBranchFilter(v); setCurrentPage(1); }}
                        placeholder="Filter by Branch"
                        searchPlaceholder="Search branches..."
                    />
                </div>

                <div className="flex justify-end">
                    {(searchQuery || statusFilter !== 'all' || roleFilter !== 'all' || officeFilter !== 'all' || deptFilter !== 'all' || districtFilter !== 'all' || branchFilter !== 'all') && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground h-8 px-2 lg:px-3">
                            Reset Filters
                            <FilterX className="ml-2 h-4 w-4" />
                        </Button>
                    )}
                </div>

                <div className="border rounded-md">
                    <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead className="w-12">
                            <Checkbox
                                checked={selectedUsers.length === users.length && users.length > 0}
                                onCheckedChange={(checked) => {
                                    setSelectedUsers(checked ? users.map(u => u.id) : []);
                                }}
                            />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Assignment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right w-20">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            Array.from({ length: limit }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={6}><Skeleton className="h-12 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : users.length > 0 ? (
                            users.map((user) => (
                                <TableRow key={user.id} data-state={selectedUsers.includes(user.id) ? 'selected' : ''} className="group">
                                    <TableCell>
                                        <div className="relative h-10 w-10 flex items-center justify-center">
                                            <Avatar className={cn("h-9 w-9 absolute transition-all duration-300", selectedUsers.includes(user.id) ? "opacity-0 scale-50" : "group-hover:opacity-0 group-hover:scale-50")}>
                                                <AvatarImage src={user.avatar ?? undefined} alt={user.name ?? ''} />
                                                <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <Checkbox
                                                checked={selectedUsers.includes(user.id)}
                                                onCheckedChange={(checked) => {
                                                    setSelectedUsers(prev => checked ? [...prev, user.id] : prev.filter(id => id !== user.id));
                                                }}
                                                className={cn("absolute transition-all duration-300", selectedUsers.includes(user.id) ? "opacity-100 scale-100" : "opacity-0 scale-50 group-hover:opacity-100 group-hover:scale-100")}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <div className="font-medium">{user.name}</div>
                                                <div className="text-sm text-muted-foreground">{user.email}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>{user.role?.name}</TableCell>
                                    <TableCell className="max-w-[200px] truncate">{getUserAssignment(user)}</TableCell>
                                    <TableCell>
                                        {user.lockoutUntil && new Date(user.lockoutUntil) > new Date() ? (
                                            <Badge variant="destructive" className="gap-1.5 font-medium animate-pulse">
                                                <Lock className="h-3 w-3" />
                                                Locked
                                            </Badge>
                                        ) : (
                                            <Badge variant={user.status === 'active' ? 'secondary' : user.status === 'pending' ? 'outline' : 'destructive'} className={cn(
                                                user.status === 'active' && 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
                                                user.status === 'pending' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200 border-yellow-200/80',
                                            )}>
                                                {user.status.charAt(0).toUpperCase() + user.status.slice(1)}
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon">
                                                    <MoreHorizontal />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent>
                                                <DropdownMenuItem onSelect={() => handleViewDetails(user)}>
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    View Details
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleEdit(user)}>
                                                    <Pencil className="mr-2 h-4 w-4" />
                                                    Edit
                                                </DropdownMenuItem>
                                                {canResetPassword && (
                                                    <DropdownMenuItem onSelect={() => {
                                                        setResettingPasswordUser(user);
                                                        setIsResetPasswordDialogOpen(true);
                                                    }}>
                                                        <KeyRound className="mr-2 h-4 w-4" />
                                                        Reset Password
                                                    </DropdownMenuItem>
                                                )}
                                                {user.lockoutUntil && new Date(user.lockoutUntil) > new Date() ? (
                                                    <DropdownMenuItem onSelect={() => handleUnlock(user)}>
                                                        <Lock className="mr-2 h-4 w-4" />
                                                        Unlock
                                                    </DropdownMenuItem>
                                                ) : (
                                                    <DropdownMenuItem onSelect={() => {
                                                        setLockingUser(user);
                                                        setIsLockDialogOpen(true);
                                                    }}>
                                                        <Lock className="mr-2 h-4 w-4" />
                                                        Lock
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuItem onSelect={() => {
                                                    setDeletingUser(user);
                                                    setIsDeleteDialogOpen(true);
                                                }} className="text-destructive">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    No users found matching your criteria.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                    </Table>
                </div>

                <div className="flex justify-between items-center mt-4">
                    <div className="text-sm text-muted-foreground">
                        Showing {Math.min(totalUsers, (currentPage - 1) * limit + 1)}-{Math.min(totalUsers, currentPage * limit)} of {totalUsers} users
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1 || loading}>
                            <ChevronsLeft className="mr-2 h-4 w-4" /> Previous
                        </Button>
                        <div className="flex items-center gap-1 text-sm font-medium">
                            Page {currentPage} of {totalPages || 1}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0 || loading}>
                            Next <ChevronsRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>

        {/* User Details Dialog */}
        <Dialog open={isDetailsDialogOpen} onOpenChange={handleDetailsDialogChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserIcon className="h-5 w-5 text-primary" />
                        User Account Details
                    </DialogTitle>
                    <DialogDescription>Comprehensive profile overview and account health metadata.</DialogDescription>
                </DialogHeader>
                {viewingUser && (
                    <div className="grid gap-6 py-4">
                        {/* Header Profile Info */}
                        <div className="flex items-start gap-6 bg-muted/30 p-4 rounded-lg border">
                            <Avatar className="h-20 w-20 border-2 border-primary/20">
                                <AvatarImage src={viewingUser.avatar ?? undefined} alt={viewingUser.name ?? ''} />
                                <AvatarFallback className="text-2xl">{viewingUser.name?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 space-y-1">
                                <h3 className="text-2xl font-bold">{viewingUser.name}</h3>
                                <div className="flex items-center text-muted-foreground gap-2 text-sm">
                                    <Mail className="h-4 w-4" />
                                    <span>{viewingUser.email}</span>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <Badge variant="secondary" className="gap-1.5 font-medium">
                                        <Shield className="h-3 w-3" />
                                        {viewingUser.role?.name}
                                    </Badge>
                                    {/* Calculated Lock Status */}
                                    {viewingUser.lockoutUntil && new Date(viewingUser.lockoutUntil) > new Date() ? (
                                        <Badge variant="destructive" className="gap-1.5 font-medium animate-pulse">
                                            <Lock className="h-3 w-3" />
                                            Locked (Ends {formatDistanceToNow(new Date(viewingUser.lockoutUntil), { addSuffix: true })})
                                        </Badge>
                                    ) : (
                                        <Badge variant={viewingUser.status === 'active' ? 'secondary' : viewingUser.status === 'pending' ? 'outline' : 'destructive'} className={cn(
                                            "gap-1.5 font-medium",
                                            viewingUser.status === 'active' && 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
                                            viewingUser.status === 'pending' && 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200 border-yellow-200/80',
                                        )}>
                                            <div className={cn("h-1.5 w-1.5 rounded-full", viewingUser.status === 'active' ? 'bg-green-500' : viewingUser.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500')} />
                                            {viewingUser.status.charAt(0).toUpperCase() + viewingUser.status.slice(1)}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Organizational Assignment */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                    <Building className="h-4 w-4" />
                                    Organizational Assignment
                                </div>
                                <div className="space-y-3 pl-6 border-l-2 border-muted">
                                    <div className="space-y-0.5">
                                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Office</Label>
                                        <p className="text-sm font-medium">{viewingUser.office?.name || 'Not Assigned'}</p>
                                    </div>
                                    {viewingUser.department && (
                                        <div className="space-y-0.5">
                                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Department</Label>
                                            <p className="text-sm font-medium">{viewingUser.department.name}</p>
                                        </div>
                                    )}
                                    {viewingUser.division && (
                                        <div className="space-y-0.5">
                                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Division</Label>
                                            <p className="text-sm font-medium">{viewingUser.division.name}</p>
                                        </div>
                                    )}
                                    {viewingUser.district && (
                                        <div className="space-y-0.5">
                                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">District</Label>
                                            <p className="text-sm font-medium">{viewingUser.district.name}</p>
                                        </div>
                                    )}
                                    {viewingUser.branch && (
                                        <div className="space-y-0.5">
                                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Branch</Label>
                                            <p className="text-sm font-medium">{viewingUser.branch.name}</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Account & Security Metadata */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                    <History className="h-4 w-4" />
                                    Account & Security Metadata
                                </div>
                                <div className="grid grid-cols-1 gap-y-4 text-sm pl-6 border-l-2 border-muted">
                                    <div className="grid grid-cols-2 items-center gap-4">
                                        <span className="text-muted-foreground flex items-center gap-1.5">
                                            <AlertCircle className="h-3.5 w-3.5" /> Email Verified:
                                        </span>
                                        <Badge variant={viewingUser.status !== 'pending' ? 'secondary' : 'outline'} className="w-fit">
                                            {viewingUser.status !== 'pending' ? 'Verified' : 'Pending Verification'}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-2 items-center gap-4">
                                        <span className="text-muted-foreground flex items-center gap-1.5">
                                            <ShieldOff className="h-3.5 w-3.5" /> Failed Logins:
                                        </span>
                                        <span className={cn("font-medium", (viewingUser.failedLoginAttempts || 0) > 0 && "text-destructive")}>
                                            {viewingUser.failedLoginAttempts || 0} attempts
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 items-center gap-4">
                                        <span className="text-muted-foreground flex items-center gap-1.5">
                                            <MousePointer2 className="h-3.5 w-3.5" /> Onboarding:
                                        </span>
                                        <Badge variant={viewingUser.onboardingCompleted ? 'secondary' : 'outline'} className="w-fit">
                                            {viewingUser.onboardingCompleted ? 'Completed' : 'Not Started'}
                                        </Badge>
                                    </div>

                                    <Separator className="my-1" />

                                    <div className="space-y-2">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Account Created</span>
                                            <span className="text-xs font-medium flex items-center gap-1.5">
                                                <Calendar className="h-3 w-3" />
                                                {viewingUser.createdAt ? formatTimestamp(viewingUser.createdAt) : 'N/A'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Last Profile Update</span>
                                            <span className="text-xs font-medium flex items-center gap-1.5">
                                                <Globe className="h-3 w-3" />
                                                {viewingUser.updatedAt ? formatTimestamp(viewingUser.updatedAt) : 'N/A'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <DialogFooter className="bg-muted/30 p-4 -mx-6 -mb-6 rounded-b-lg border-t">
                    <Button variant="outline" onClick={() => handleDetailsDialogChange(false)}>Close</Button>
                    <Button onClick={() => { handleDetailsDialogChange(false); handleEdit(viewingUser!); }}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Profile
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* User Form Dialog */}
        <Dialog open={isFormDialogOpen} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{editingUser ? 'Edit User' : 'Create New User'}</DialogTitle>
                    <DialogDescription>
                        {editingUser
                            ? 'Update user details, role, and organizational assignment.'
                            : 'Create a new user account and assign them to the appropriate role and organization.'}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSave}>
                    <fieldset disabled={isSaving}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="name">Full Name</Label>
                                <Input
                                    id="name"
                                    name="name"
                                    value={formState.name}
                                    onChange={e => handleFormChange('name', e.target.value)}
                                    placeholder="Enter full name"
                                    required
                                />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    name="email"
                                    type="email"
                                    value={formState.email}
                                    onChange={e => handleFormChange('email', e.target.value)}
                                    placeholder="Enter email address"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="roleId">Application Role</Label>
                                <Combobox
                                    options={roleOptions}
                                    value={formState.roleId}
                                    onChange={v => handleFormChange('roleId', v)}
                                    placeholder="Select a role"
                                    searchPlaceholder="Search roles..."
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="status">Status</Label>
                                <Select
                                    value={formState.status}
                                    onValueChange={v => handleFormChange('status', v)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="inactive">Inactive</SelectItem>
                                        <SelectItem value="pending">Pending</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {scopeWarnings.length > 0 && (
                                <div className="md:col-span-2 flex items-start gap-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/30">
                                    <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                                    <div className="text-sm">
                                        <p className="font-medium text-yellow-800 dark:text-yellow-200">Scope Inconsistency Detected</p>
                                        <p className="text-yellow-700 dark:text-yellow-300 mt-0.5">{scopeWarnings[0]}</p>
                                    </div>
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="officeId">Office</Label>
                                <Combobox
                                    options={officeOptions}
                                    value={formState.officeId}
                                    onChange={v => {
                                        handleFormChange('officeId', v);
                                        handleFormChange('departmentId', '');
                                        handleFormChange('divisionId', '');
                                        handleFormChange('districtId', '');
                                        handleFormChange('branchId', '');
                                    }}
                                    placeholder="Select office"
                                    searchPlaceholder="Search offices..."
                                    required
                                />
                            </div>
                            {!formState.districtId && (
                                <>
                                    <div className="space-y-2">
                                        <Label htmlFor="departmentId">Department</Label>
                                        <Combobox
                                            options={[
                                                { value: '', label: 'No Department' },
                                                ...departmentOptions
                                            ]}
                                            value={formState.departmentId}
                                            onChange={v => {
                                                handleFormChange('departmentId', v);
                                                handleFormChange('divisionId', '');
                                            }}
                                            placeholder="Select department"
                                            searchPlaceholder="Search departments..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="divisionId">Division</Label>
                                        <Combobox
                                            options={[
                                                { value: '', label: 'No Division' },
                                                ...divisionOptions
                                            ]}
                                            value={formState.divisionId}
                                            onChange={v => handleFormChange('divisionId', v)}
                                            placeholder="Select division"
                                            searchPlaceholder="Search divisions..."
                                        />
                                    </div>
                                </>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="districtId">District</Label>
                                <Combobox
                                    options={[
                                        { value: '', label: 'No District' },
                                        ...districts
                                            .filter(d => d.officeId === formState.officeId)
                                            .map(d => ({ value: d.id, label: d.name }))
                                    ]}
                                    value={formState.districtId}
                                    disabled={isScopedManager}
                                    onChange={v => {
                                        handleFormChange('districtId', v);
                                        handleFormChange('branchId', '');
                                        handleFormChange('departmentId', '');
                                        handleFormChange('divisionId', '');
                                    }}
                                    placeholder="Select district"
                                    searchPlaceholder="Search districts..."
                                />
                                {isScopedManager && (
                                    <p className="text-xs text-muted-foreground">Fixed to your assigned district.</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="branchId">Branch</Label>
                                <Combobox
                                    options={[
                                        { value: '', label: 'No Branch' },
                                        ...branchOptions
                                    ]}
                                    value={formState.branchId}
                                    disabled={scopeLevel === 'branch'}
                                    onChange={v => handleFormChange('branchId', v)}
                                    placeholder="Select branch"
                                    searchPlaceholder="Search branches..."
                                />
                                {scopeLevel === 'branch' && (
                                    <p className="text-xs text-muted-foreground">Fixed to your assigned branch.</p>
                                )}
                            </div>
                        </div>
                    </fieldset>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={isSaving}>Cancel</Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {editingUser ? 'Save Changes' : 'Create User'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>

        {/* Lock User Dialog */}
        <Dialog open={isLockDialogOpen} onOpenChange={(open) => {
            if (!open) {
                setLockingUser(null);
                setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
            }
            setIsLockDialogOpen(open);
        }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Lock User</DialogTitle>
                    <DialogDescription>
                        Select how long you want to lock {lockingUser?.name}'s account.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <Label htmlFor="lockDuration">Duration</Label>
                    <Select
                        value={lockDuration}
                        onValueChange={setLockDuration}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1h">1 Hour</SelectItem>
                            <SelectItem value="1d">1 Day</SelectItem>
                            <SelectItem value="7d">7 Days</SelectItem>
                            <SelectItem value="30d">30 Days</SelectItem>
                            <SelectItem value="permanent">Permanent</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setIsLockDialogOpen(false);
                            setLockingUser(null);
                            setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
                        }}
                        disabled={isLocking}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={handleLock}
                        disabled={isLocking}
                    >
                        {isLocking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Lock
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Reset Password Confirmation Dialog */}
        <Dialog open={isResetPasswordDialogOpen} onOpenChange={(open) => {
            if (!open) {
                setResettingPasswordUser(null);
                setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
            }
            setIsResetPasswordDialogOpen(open);
        }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Reset Password</DialogTitle>
                    <DialogDescription>
                        This will send a password reset link to {resettingPasswordUser?.email}. They will be able to set a new password using this link.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setIsResetPasswordDialogOpen(false);
                            setResettingPasswordUser(null);
                            setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
                        }}
                        disabled={isResettingPassword}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={isResettingPassword}
                    >
                        {isResettingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send Reset Link
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => {
            if (!open) {
                setDeletingUser(null);
                setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
            }
            setIsDeleteDialogOpen(open);
        }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Delete User</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to delete {deletingUser?.name}? This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setIsDeleteDialogOpen(false);
                            setDeletingUser(null);
                            setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 500);
                        }}
                        disabled={isDeleting}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
  );
}

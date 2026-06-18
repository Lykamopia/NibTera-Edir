
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { deleteRole, saveRole } from "@/app/actions/admin";
import type { Role, Permission } from "@/lib/types";
import { toast } from "sonner";
import { pagePermissions, PAGE_SECTIONS, type PagePermissionDef } from "@/lib/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoles } from "../hooks";
import {
  ChevronsLeft, ChevronsRight, PlusCircle, Trash2, Edit, Loader2,
  Key, ChevronDown, ChevronRight,
  LayoutDashboard, BarChart3, Target, CalendarCheck, ClipboardCheck,
  TrendingUp, Briefcase, Users2, UsersRound, Building2, FileBarChart2,
  BarChart2, Users, ShieldCheck, Building, Network, MapPin, Store,
  Settings, Mail, Calendar, ScrollText, ShieldAlert, Map, Crosshair,
} from "lucide-react";

const ITEMS_PER_PAGE = 5;

type RoleScope = "BRANCH" | "DISTRICT" | "HEAD_OFFICE";
const SCOPE_OPTIONS: { value: RoleScope; label: string; hint: string }[] = [
  { value: "BRANCH", label: "Branch", hint: "Assignable by branch, district and head-office managers" },
  { value: "DISTRICT", label: "District", hint: "Assignable by district and head-office managers" },
  { value: "HEAD_OFFICE", label: "Head Office", hint: "Assignable by head-office managers only" },
];
const SCOPE_BADGE: Record<RoleScope, string> = {
  BRANCH: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  DISTRICT: "border-blue-300 text-blue-700 dark:text-blue-400",
  HEAD_OFFICE: "border-amber-300 text-amber-700 dark:text-amber-400",
};
const scopeLabel = (s: RoleScope) => SCOPE_OPTIONS.find((o) => o.value === s)?.label ?? s;

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, BarChart3, Target, CalendarCheck, ClipboardCheck,
  TrendingUp, Briefcase, Users2, UsersRound, Building2, FileBarChart2,
  BarChart2, Users, ShieldCheck, Building, Network, MapPin, Store,
  Settings, Mail, Calendar, ScrollText, ShieldAlert, Map, Crosshair,
};

// ─── Page permission card ────────────────────────────────────────────────────

function PageCard({
  page,
  selectedPermissions,
  onToggle,
  disabled,
}: {
  page: PagePermissionDef;
  selectedPermissions: Permission[];
  onToggle: (id: Permission, checked: boolean) => void;
  disabled: boolean;
}) {
  const pagePermIds = page.actions.map((a) => a.id);
  const selectedCount = pagePermIds.filter((id) => selectedPermissions.includes(id)).length;
  const allSelected = selectedCount === pagePermIds.length && pagePermIds.length > 0;
  const indeterminate = selectedCount > 0 && selectedCount < pagePermIds.length;
  const hasAccess = page.accessPermissions.some((p) => selectedPermissions.includes(p));

  const IconComp = iconMap[page.icon];

  const togglePage = (checked: boolean) => {
    pagePermIds.forEach((id) => onToggle(id, checked));
  };

  return (
    <div className={cn(
      "rounded-lg border bg-card transition-colors",
      hasAccess ? "border-primary/30" : "border-border",
    )}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <Checkbox
          checked={indeterminate ? "indeterminate" : allSelected}
          onCheckedChange={(v) => togglePage(v === true)}
          disabled={disabled}
          className="shrink-0"
        />
        {IconComp && <IconComp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="text-xs font-semibold truncate flex-1">{page.label}</span>
        {hasAccess && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/50 text-primary shrink-0">
            Active
          </Badge>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
        {page.actions.map((action) => (
          <div
            key={action.id}
            className={cn(
              "flex items-start gap-2 rounded px-2 py-1.5 transition-colors",
              selectedPermissions.includes(action.id) ? "bg-primary/5" : "hover:bg-muted/50",
            )}
          >
            <Checkbox
              id={`perm-${action.id}`}
              checked={selectedPermissions.includes(action.id)}
              onCheckedChange={(v) => onToggle(action.id, !!v)}
              disabled={disabled}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0">
              <label
                htmlFor={`perm-${action.id}`}
                className="text-xs font-medium leading-none cursor-pointer flex items-center gap-1"
              >
                {action.isAccess && (
                  <Key className="h-2.5 w-2.5 text-primary shrink-0" aria-label="Page access" />
                )}
                {action.label}
              </label>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                {action.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section group (collapsible) ─────────────────────────────────────────────

function SectionGroup({
  section,
  pages,
  selectedPermissions,
  onToggle,
  disabled,
}: {
  section: { id: string; label: string };
  pages: PagePermissionDef[];
  selectedPermissions: Permission[];
  onToggle: (id: Permission, checked: boolean) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(true);

  const allIds = pages.flatMap((p) => p.actions.map((a) => a.id));
  const selectedCount = allIds.filter((id) => selectedPermissions.includes(id)).length;
  const allSelected = selectedCount === allIds.length && allIds.length > 0;
  const indeterminate = selectedCount > 0 && selectedCount < allIds.length;
  const accessiblePageCount = pages.filter((p) =>
    p.accessPermissions.some((ap) => selectedPermissions.includes(ap)),
  ).length;

  const toggleSection = (checked: boolean) => {
    allIds.forEach((id) => onToggle(id, checked));
  };

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <Checkbox
          checked={indeterminate ? "indeterminate" : allSelected}
          onCheckedChange={(v) => { toggleSection(v === true); }}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0"
        />
        <span className="text-sm font-semibold text-foreground flex-1">{section.label}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {accessiblePageCount}/{pages.length} pages
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </div>

      {/* Pages grid */}
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-5">
          {pages.map((page) => (
            <PageCard
              key={page.id}
              page={page}
              selectedPermissions={selectedPermissions}
              onToggle={onToggle}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function RolesLoadingSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row justify-between items-center">
        <CardTitle>Role Management</CardTitle>
        <Skeleton className="h-10 w-[150px]" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RoleManagementPage() {
  const { data: roles, loading: loadingRoles, mutate: mutateRoles } = useRoles();

  const [editingRole, setEditingRole] = useState<Partial<Role> | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [roleScope, setRoleScope] = useState<RoleScope>("BRANCH");
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const paginatedRoles = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return roles.slice(start, start + ITEMS_PER_PAGE);
  }, [roles, currentPage]);

  const totalPages = Math.max(1, Math.ceil(roles.length / ITEMS_PER_PAGE));

  useEffect(() => {
    if (isDialogOpen && editingRole) {
      setRoleName(editingRole.name || "");
      setRoleScope(((editingRole as any).scope as RoleScope) || "BRANCH");
      setSelectedPermissions((editingRole.permissions?.split(",") as Permission[]) || []);
    } else if (isDialogOpen) {
      setRoleName("");
      setRoleScope("BRANCH");
      setSelectedPermissions([]);
    }
  }, [isDialogOpen, editingRole]);

  const handleAddNew = () => { setEditingRole(null); setIsDialogOpen(true); };
  const handleEdit = (role: Role) => { setEditingRole(role); setIsDialogOpen(true); };
  const handleDelete = (role: Role) => { setDeletingRole(role); setIsAlertOpen(true); };

  const handleConfirmDelete = async () => {
    if (!deletingRole) return;
    setIsSaving(true);
    try {
      const result = await deleteRole(deletingRole.id);
      if (result?.error) {
        toast.error("Cannot delete role", { description: result.error });
      } else {
        await mutateRoles();
        toast.success("Role Deleted", { description: "The role has been successfully deleted." });
      }
    } catch (err: any) {
      toast.error("Error", { description: err?.message || "Failed to delete role." });
    } finally {
      setIsSaving(false);
      handleAlertChange(false);
    }
  };

  const handleSave = async () => {
    if (!roleName.trim()) {
      toast.error("Invalid name", { description: "Role name cannot be empty." });
      return;
    }
    setIsSaving(true);
    try {
      await saveRole({ id: editingRole?.id, name: roleName, permissions: selectedPermissions, scope: roleScope });
      await mutateRoles();
      toast.success("Success", { description: `Role ${editingRole?.id ? "updated" : "created"}.` });
      handleDialogChange(false);
    } catch (err: any) {
      toast.error("Error", { description: err?.message || "Failed to save role." });
    } finally {
      setIsSaving(false);
    }
  };

  const onPermissionChange = (permission: Permission, checked: boolean) => {
    setSelectedPermissions((prev) =>
      checked ? [...prev, permission] : prev.filter((p) => p !== permission),
    );
  };

  const handleDialogChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = "auto"; }, 500);
      setEditingRole(null);
    }
  };

  const handleAlertChange = (open: boolean) => {
    setIsAlertOpen(open);
    if (!open) {
      setTimeout(() => { document.body.style.pointerEvents = "auto"; }, 500);
      setDeletingRole(null);
    }
  };

  const allPermIds = pagePermissions.flatMap((p) => p.actions.map((a) => a.id));

  if (loadingRoles) return <RolesLoadingSkeleton />;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <CardTitle>Role Management</CardTitle>
          <Button onClick={handleAddNew}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add New Role
          </Button>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Role Name</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Accessible Pages</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRoles.map((role, index) => {
                  const rolePerms = (role.permissions || "").split(",") as Permission[];
                  const pageCount = pagePermissions.filter((p) =>
                    p.accessPermissions.some((ap) => rolePerms.includes(ap)),
                  ).length;
                  return (
                    <TableRow key={role.id}>
                      <TableCell>{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</TableCell>
                      <TableCell className="font-medium">{role.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", SCOPE_BADGE[((role as any).scope as RoleScope) ?? "BRANCH"])}>
                          {scopeLabel(((role as any).scope as RoleScope) ?? "BRANCH")}
                        </Badge>
                      </TableCell>
                      <TableCell>{(role as any)._count?.users ?? 0}</TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {pageCount} / {pagePermissions.length} pages
                        </span>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(role)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={role.name === "Admin" || ((role as any)._count?.users ?? 0) > 0}
                          onClick={() => handleDelete(role)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between items-center mt-4">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                <ChevronsLeft /> Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                Next <ChevronsRight />
              </Button>
            </div>
          </div>

          {/* Edit / Create dialog */}
          <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col gap-0 p-0">
              {/* Fixed: dialog title */}
              <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
                <DialogTitle>{editingRole?.id ? "Edit Role" : "Add New Role"}</DialogTitle>
              </DialogHeader>

              {/* Fixed: role name + matrix controls */}
              <div className={`shrink-0 px-6 py-3 border-b space-y-3${isSaving ? " pointer-events-none opacity-60" : ""}`}>
                <div className="flex items-center gap-4">
                  <Label htmlFor="role-name" className="shrink-0 w-24 text-right">
                    Role Name
                  </Label>
                  <Input
                    id="role-name"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    className="max-w-xs"
                    disabled={editingRole?.name === "Admin" || isSaving}
                    placeholder="Enter role name"
                  />
                  {editingRole?.name === "Admin" && (
                    <span className="text-xs text-muted-foreground">Admin role has all permissions</span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <Label htmlFor="role-scope" className="shrink-0 w-24 text-right">
                    Scope
                  </Label>
                  <Select
                    value={roleScope}
                    onValueChange={(v) => setRoleScope(v as RoleScope)}
                    disabled={editingRole?.name === "Admin" || isSaving}
                  >
                    <SelectTrigger id="role-scope" className="max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {SCOPE_OPTIONS.find((o) => o.value === roleScope)?.hint}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-base font-semibold">Permission Matrix</Label>
                    <span className="text-xs text-muted-foreground">
                      ({selectedPermissions.length} of {allPermIds.length} permissions selected)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Key className="h-2.5 w-2.5 text-primary" /> = page access
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedPermissions(allPermIds)}
                      disabled={editingRole?.name === "Admin" || isSaving}
                      className="h-7 text-xs"
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedPermissions([])}
                      disabled={editingRole?.name === "Admin" || isSaving}
                      className="h-7 text-xs"
                    >
                      Clear All
                    </Button>
                  </div>
                </div>
              </div>

              {/* Scrollable permission matrix — direct flex child of DialogContent so height constraint works */}
              <div className={`flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-5${isSaving ? " pointer-events-none opacity-60" : ""}`}>
                {PAGE_SECTIONS.map((section) => {
                  const sectionPages = pagePermissions.filter((p) => p.section === section.id);
                  if (sectionPages.length === 0) return null;
                  return (
                    <SectionGroup
                      key={section.id}
                      section={section}
                      pages={sectionPages}
                      selectedPermissions={selectedPermissions}
                      onToggle={onPermissionChange}
                      disabled={editingRole?.name === "Admin"}
                    />
                  );
                })}
              </div>

              {/* Fixed: footer */}
              <DialogFooter className="shrink-0 px-6 py-4 border-t">
                <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving || editingRole?.name === "Admin"}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Role
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <AlertDialog open={isAlertOpen} onOpenChange={handleAlertChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the role &apos;{deletingRole?.name}&apos;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isSaving}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

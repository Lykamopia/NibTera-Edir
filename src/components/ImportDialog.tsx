"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ImportPreviewRow {
  cells: Record<string, string | number | undefined>;
  data: Record<string, any>;
  errors: string[];
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  columns: string[];
  rows: ImportPreviewRow[];
  isImporting: boolean;
  onConfirm: () => void;
}

export default function ImportDialog({
  open,
  onOpenChange,
  title,
  columns,
  rows,
  isImporting,
  onConfirm,
}: ImportDialogProps) {
  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const errorCount = rows.filter((r) => r.errors.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col" style={{ maxHeight: "85vh" }}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 shrink-0">
          <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {validCount} valid
          </Badge>
          {errorCount > 0 && (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 mr-1" />
              {errorCount} with errors
            </Badge>
          )}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No rows found in file.</p>
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex-1 overflow-hidden border rounded-lg">
            <ScrollArea className="h-[380px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted z-10">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      className={cn("border-t", row.errors.length > 0 && "bg-red-50 dark:bg-red-950/20")}
                    >
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-2 whitespace-nowrap">
                          {row.cells[col] !== undefined && row.cells[col] !== "" ? String(row.cells[col]) : <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {row.errors.length === 0 ? (
                          <span className="text-green-600 font-medium">✓</span>
                        ) : (
                          <span className="text-red-600">{row.errors.join("; ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="shrink-0 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isImporting || validCount === 0}>
            {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {validCount} Row{validCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

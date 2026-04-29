"use client";

import { useRef, useState } from "react";
import { Download, Upload, Trash2, Loader2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateCSVTemplate, parseCSV } from "@/lib/csvParser";
import { batchCreateMenuItems } from "@/lib/batchCreateMenuItems";
import type { DraftRow, FoodCategory, FoodTag } from "@/types/database";

interface Props {
  restaurantId: string;
  categories: FoodCategory[];
  tags: FoodTag[];
  remainingSlots: number;
  onImportComplete: () => void;
}

export default function CSVUploadTab({ restaurantId, categories, tags, remainingSlots, onImportComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ saved: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ succeeded: number; failed: number; errors: Array<{ rowIndex: number; message: string }> } | null>(null);

  const validRows = rows.filter((r) => Object.keys(r._errors).length === 0);
  const hasErrors = rows.some((r) => Object.keys(r._errors).length > 0);
  const overLimit = remainingSlots < validRows.length;
  const canImport = validRows.length > 0 && !hasErrors && !overLimit && !progress;

  function handleDownloadTemplate() {
    const csv = generateCSVTemplate(categories, tags);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "menu_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setSummary(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const result = parseCSV(text, categories, tags);
        if (result.rows.length === 0) {
          setParseError("No data rows found. Please use the downloaded template.");
          setRows([]);
        } else {
          setRows(result.rows);
        }
      } catch {
        setParseError("Could not parse file. Please use the downloaded template.");
        setRows([]);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }

  function handleDeleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r._id !== id));
  }

  async function handleImport() {
    if (!canImport) return;
    setProgress({ saved: 0, total: validRows.length });
    setSummary(null);

    const result = await batchCreateMenuItems({
      restaurantId,
      rows: validRows,
      categories,
      tags,
      onProgress: (saved, total) => setProgress({ saved, total }),
    });

    // Mark rows with their result status
    setRows((prev) =>
      prev.map((row, i) => {
        const err = result.errors.find((e) => e.rowIndex === validRows.indexOf(row));
        if (err) return { ...row, _status: "error" as const, _errors: { save: err.message } };
        if (validRows.includes(row)) return { ...row, _status: "saved" as const };
        return row;
      })
    );

    setProgress(null);
    setSummary(result);

    if (result.succeeded > 0) onImportComplete();

    // Remove successfully saved rows
    setRows((prev) => prev.filter((r) => r._status !== "saved"));
  }

  return (
    <div className="space-y-5">
      {/* Step 1 — Download template */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 flex items-start gap-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
          <FileText className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Step 1 — Download the template</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fill it in Excel or Google Sheets, then upload below.
            {categories.length > 0 && ` Available categories: ${categories.map((c) => c.name).join(", ")}.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="shrink-0">
          <Download className="h-3.5 w-3.5 mr-1.5" /> Download Template
        </Button>
      </div>

      {/* Step 2 — Upload */}
      <div>
        <p className="text-sm font-medium mb-2">Step 2 — Upload your filled CSV</p>
        <label className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
          "hover:border-primary/50 hover:bg-primary/5"
        )}>
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Click to select a CSV file</span>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </label>
        {parseError && (
          <p className="mt-2 text-sm text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {parseError}
          </p>
        )}
      </div>

      {/* Plan limit warning */}
      {overLimit && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          You can only add {remainingSlots} more item{remainingSlots !== 1 ? "s" : ""} on your current plan.
          Remove rows or upgrade to Pro.
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className={cn(
          "rounded-lg border px-4 py-3 text-sm",
          summary.failed === 0
            ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300"
            : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
        )}>
          <p className="font-medium flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            {summary.succeeded} of {summary.succeeded + summary.failed} items imported successfully.
          </p>
          {summary.errors.map((e) => (
            <p key={e.rowIndex} className="text-xs mt-1 text-destructive">Row {e.rowIndex + 1}: {e.message}</p>
          ))}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{rows.length} row{rows.length !== 1 ? "s" : ""} ready to import</p>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!canImport}
            >
              {progress ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving {progress.saved} / {progress.total}…</>
              ) : (
                <>Import {validRows.length} Item{validRows.length !== 1 ? "s" : ""}</>
              )}
            </Button>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Price (₹)</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-16">Image</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Categories</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tags</th>
                  <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">Available</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const hasErr = Object.keys(row._errors).length > 0;
                  return (
                    <tr key={row._id} className={cn(
                      "transition-colors",
                      row._status === "saved" && "bg-green-50",
                      row._status === "error" && "bg-red-50",
                      hasErr && row._status === "idle" && "bg-amber-50/50"
                    )}>
                      <td className="px-3 py-2">
                        <span className={cn(row._errors.name && "text-destructive font-medium")}>
                          {row.name || <span className="text-muted-foreground italic">empty</span>}
                        </span>
                        {row._errors.name && <p className="text-xs text-destructive">{row._errors.name}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn(row._errors.price && "text-destructive font-medium")}>
                          {row.price || <span className="text-muted-foreground italic">—</span>}
                        </span>
                        {row._errors.price && <p className="text-xs text-destructive">{row._errors.price}</p>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{row.description || "—"}</td>
                      <td className="px-3 py-2">
                        {row.imageUrl
                          ? <img src={row.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {row.categoryNames.length > 0
                          ? row.categoryNames.map((n) => (
                              <span key={n} className="inline-block text-xs bg-muted rounded px-1.5 py-0.5 mr-1">{n}</span>
                            ))
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {row.tagNames.length > 0
                          ? row.tagNames.map((n) => (
                              <span key={n} className="inline-block text-xs bg-muted rounded px-1.5 py-0.5 mr-1">{n}</span>
                            ))
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={cn("text-xs font-medium", row.is_available ? "text-green-600" : "text-muted-foreground")}>
                          {row.is_available ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {row._status !== "saved" && (
                          <button onClick={() => handleDeleteRow(row._id)} className="text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

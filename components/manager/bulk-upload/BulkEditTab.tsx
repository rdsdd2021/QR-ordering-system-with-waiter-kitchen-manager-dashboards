"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { batchCreateMenuItems } from "@/lib/batchCreateMenuItems";
import type { DraftRow, FoodCategory, FoodTag } from "@/types/database";

interface Props {
  restaurantId: string;
  categories: FoodCategory[];
  tags: FoodTag[];
  remainingSlots: number;
  onImportComplete: () => void;
}

function newRow(): DraftRow {
  return {
    name: "", price: "", description: "", imageUrl: "",
    categoryNames: [], tagNames: [],
    is_available: true,
    _id: crypto.randomUUID(),
    _errors: {},
    _status: "idle",
  };
}

function validateRow(row: DraftRow): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!row.name.trim()) errors.name = "Required";
  const p = parseFloat(row.price);
  if (!row.price || isNaN(p) || p <= 0) errors.price = "Must be > 0";
  return errors;
}

// Simple multi-select popover for categories/tags
function MultiSelect({
  options, selected, onChange, placeholder,
}: {
  options: Array<{ id: string; name: string; color?: string | null }>;
  selected: string[];
  onChange: (names: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[32px] text-left text-xs border border-input rounded-md px-2 py-1 bg-background hover:bg-muted/50 transition-colors flex flex-wrap gap-1"
      >
        {selected.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : (
          selected.map((n) => (
            <span key={n} className="inline-flex items-center gap-0.5 bg-muted rounded px-1.5 py-0.5">
              {n}
              <X className="h-2.5 w-2.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); toggle(n); }} />
            </span>
          ))
        )}
      </button>
      {open && options.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-48 rounded-md border border-border bg-card shadow-md py-1 max-h-40 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.name)}
              className={cn(
                "w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2",
                selected.includes(opt.name) && "bg-primary/10 font-medium"
              )}
            >
              {opt.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />}
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BulkEditTab({ restaurantId, categories, tags, remainingSlots, onImportComplete }: Props) {
  const [rows, setRows] = useState<DraftRow[]>([newRow()]);
  const [progress, setProgress] = useState<{ saved: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ succeeded: number; failed: number } | null>(null);

  const pendingRows = rows.filter((r) => r._status === "idle" || r._status === "error");
  const savedRows = rows.filter((r) => r._status === "saved");
  const overLimit = remainingSlots < pendingRows.length;
  const atRowLimit = pendingRows.length >= remainingSlots;

  const allValid = pendingRows.every((r) => {
    const errs = validateRow(r);
    return Object.keys(errs).length === 0;
  });
  const canSave = pendingRows.length > 0 && allValid && !overLimit && !progress;

  function updateRow(id: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => {
      if (r._id !== id) return r;
      const updated = { ...r, ...patch };
      updated._errors = validateRow(updated);
      return updated;
    }));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r._id !== id));
  }

  function clearSaved() {
    setRows((prev) => prev.filter((r) => r._status !== "saved"));
    setSummary(null);
  }

  async function handleSaveAll() {
    if (!canSave) return;

    // Validate all rows first
    const toSave = pendingRows.map((r) => ({ ...r, _errors: validateRow(r) }));
    const invalid = toSave.filter((r) => Object.keys(r._errors).length > 0);
    if (invalid.length > 0) {
      setRows((prev) => prev.map((r) => {
        const updated = toSave.find((t) => t._id === r._id);
        return updated ?? r;
      }));
      return;
    }

    // Mark all as saving
    setRows((prev) => prev.map((r) =>
      r._status === "idle" || r._status === "error" ? { ...r, _status: "saving" as const } : r
    ));
    setProgress({ saved: 0, total: toSave.length });
    setSummary(null);

    const result = await batchCreateMenuItems({
      restaurantId,
      rows: toSave,
      categories,
      tags,
      onProgress: (saved, total) => setProgress({ saved, total }),
    });

    // Update row statuses
    setRows((prev) => prev.map((r) => {
      const idx = toSave.findIndex((t) => t._id === r._id);
      if (idx === -1) return r;
      const err = result.errors.find((e) => e.rowIndex === idx);
      if (err) return { ...r, _status: "error" as const, _errors: { save: err.message } };
      return { ...r, _status: "saved" as const, _errors: {} };
    }));

    setProgress(null);
    setSummary({ succeeded: result.succeeded, failed: result.failed });
    if (result.succeeded > 0) onImportComplete();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Add rows below and save them all at once.
        </p>
        <div className="flex items-center gap-2">
          {savedRows.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearSaved}>
              Clear Saved ({savedRows.length})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={addRow} disabled={atRowLimit || !!progress}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
          </Button>
          <Button size="sm" onClick={handleSaveAll} disabled={!canSave}>
            {progress ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving {progress.saved} / {progress.total}…</>
            ) : (
              <>Save All ({pendingRows.length} item{pendingRows.length !== 1 ? "s" : ""})</>
            )}
          </Button>
        </div>
      </div>

      {overLimit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You can only add {remainingSlots} more item{remainingSlots !== 1 ? "s" : ""} on your current plan. Remove rows or upgrade to Pro.
        </div>
      )}

      {summary && (
        <div className={cn(
          "rounded-lg border px-4 py-3 text-sm flex items-center gap-2",
          summary.failed === 0 ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800"
        )}>
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {summary.succeeded} of {summary.succeeded + summary.failed} items saved successfully.
          {summary.failed > 0 && " Failed rows are shown in red — fix and retry."}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Name *</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Price (₹) *</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Description</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Image URL</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[140px]">Categories</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[140px]">Tags</th>
              <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">Available</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const isSaved = row._status === "saved";
              const isError = row._status === "error";
              const isSaving = row._status === "saving";

              return (
                <tr key={row._id} className={cn(
                  "transition-colors",
                  isSaved && "bg-green-50",
                  isError && "bg-red-50/50",
                )}>
                  <td className="px-2 py-1.5">
                    {isSaved ? (
                      <span className="text-green-700 font-medium">{row.name}</span>
                    ) : (
                      <div>
                        <Input
                          value={row.name}
                          onChange={(e) => updateRow(row._id, { name: e.target.value })}
                          placeholder="Item name"
                          className={cn("h-8 text-xs", row._errors.name && "border-destructive")}
                          disabled={isSaving}
                        />
                        {row._errors.name && <p className="text-[10px] text-destructive mt-0.5">{row._errors.name}</p>}
                        {row._errors.save && <p className="text-[10px] text-destructive mt-0.5">{row._errors.save}</p>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isSaved ? (
                      <span className="text-green-700">₹{row.price}</span>
                    ) : (
                      <div>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.price}
                          onChange={(e) => updateRow(row._id, { price: e.target.value })}
                          placeholder="0.00"
                          className={cn("h-8 text-xs", row._errors.price && "border-destructive")}
                          disabled={isSaving}
                        />
                        {row._errors.price && <p className="text-[10px] text-destructive mt-0.5">{row._errors.price}</p>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isSaved ? (
                      <span className="text-muted-foreground text-xs">{row.description || "—"}</span>
                    ) : (
                      <Input
                        value={row.description}
                        onChange={(e) => updateRow(row._id, { description: e.target.value })}
                        placeholder="Optional"
                        className="h-8 text-xs"
                        disabled={isSaving}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isSaved ? (
                      row.imageUrl
                        ? <img src={row.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />
                        : <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <Input
                        value={row.imageUrl}
                        onChange={(e) => updateRow(row._id, { imageUrl: e.target.value })}
                        placeholder="https://…"
                        className="h-8 text-xs"
                        disabled={isSaving}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isSaved ? (
                      <span className="text-xs text-muted-foreground">{row.categoryNames.join(", ") || "—"}</span>
                    ) : (
                      <MultiSelect
                        options={categories}
                        selected={row.categoryNames}
                        onChange={(names) => updateRow(row._id, { categoryNames: names })}
                        placeholder="Select…"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {isSaved ? (
                      <span className="text-xs text-muted-foreground">{row.tagNames.join(", ") || "—"}</span>
                    ) : (
                      <MultiSelect
                        options={tags}
                        selected={row.tagNames}
                        onChange={(names) => updateRow(row._id, { tagNames: names })}
                        placeholder="Select…"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {isSaved ? (
                      <span className={cn("text-xs font-medium", row.is_available ? "text-green-600" : "text-muted-foreground")}>
                        {row.is_available ? "Yes" : "No"}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={row.is_available}
                        onChange={(e) => updateRow(row._id, { is_available: e.target.checked })}
                        className="h-4 w-4 accent-primary"
                        disabled={isSaving}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {!isSaved && !isSaving && (
                      <button onClick={() => deleteRow(row._id)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    {isSaved && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No rows yet. Click "Add Row" to start.
        </div>
      )}
    </div>
  );
}

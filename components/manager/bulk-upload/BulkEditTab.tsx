"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Trash2, Loader2, CheckCircle2, X, Upload, Image as ImageIcon, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { batchCreateMenuItems } from "@/lib/batchCreateMenuItems";
import { getSupabaseClient } from "@/lib/supabase";
import {
  updateMenuItem, deleteMenuItem,
  getMenuItemCategories, getMenuItemTags,
  setMenuItemCategories, setMenuItemTags,
} from "@/lib/api";
import type { DraftRow, FoodCategory, FoodTag, MenuItem } from "@/types/database";

// Extend DraftRow with an optional existing item ID for update vs create
type Row = DraftRow & { _existingId?: string };

interface Props {
  restaurantId: string;
  categories: FoodCategory[];
  tags: FoodTag[];
  remainingSlots: number;
  items: MenuItem[];
  onImportComplete: () => void;
}

function newRow(): Row {
  return {
    name: "", price: "", description: "", imageUrl: "",
    categoryNames: [], tagNames: [],
    is_available: true,
    _id: crypto.randomUUID(),
    _errors: {},
    _status: "idle",
  };
}

function validateRow(row: Row): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!row.name.trim()) errors.name = "Required";
  const p = parseFloat(row.price);
  if (!row.price || isNaN(p) || p <= 0) errors.price = "Must be > 0";
  return errors;
}

// ── Compact image cell ────────────────────────────────────────────────────────
function ImageCell({ value, onChange, disabled }: {
  value: string; onChange: (url: string) => void; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError("Not an image"); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Max 5 MB"); return; }
    setError(null);
    setUploading(true);
    try {
      const supabase = getSupabaseClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `menu-items/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("menu-images").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="Preview" className="h-9 w-9 rounded object-cover border" onError={e => { e.currentTarget.style.display = "none"; }} />
          {!disabled && (
            <button type="button" onClick={() => onChange("")}
              className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow">
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ) : (
        <div
          onClick={() => !disabled && inputRef.current?.click()}
          onDrop={disabled ? undefined : e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={disabled ? undefined : e => e.preventDefault()}
          className={cn("flex flex-col items-center justify-center gap-0.5 h-9 w-9 rounded border-2 border-dashed border-muted-foreground/30 transition-colors", !disabled && "cursor-pointer hover:border-muted-foreground/60")}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      )}
      {!value && !disabled && (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 whitespace-nowrap">
          <Upload className="h-2.5 w-2.5" />{uploading ? "Uploading…" : "Upload"}
        </button>
      )}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ── Multi-select with fixed-position dropdown ─────────────────────────────────
function MultiSelect({ options, selected, onChange, placeholder, disabled }: {
  options: Array<{ id: string; name: string; color?: string | null }>;
  selected: string[];
  onChange: (names: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  function toggle(name: string) {
    onChange(selected.includes(name) ? selected.filter(n => n !== name) : [...selected, name]);
  }

  const calcStyle = useCallback((): React.CSSProperties => {
    if (!triggerRef.current) return {};
    const rect = triggerRef.current.getBoundingClientRect();
    const dropH = Math.min(options.length * 32 + 8, 160);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
    return { position: "fixed", top, left: rect.left, width: Math.max(rect.width, 180), zIndex: 9999 };
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!dropdownRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function reposition() { setDropdownStyle(calcStyle()); }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [open, calcStyle]);

  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled}
        onClick={() => { if (open) { setOpen(false); } else { setDropdownStyle(calcStyle()); setOpen(true); } }}
        className="w-full min-h-[32px] text-left text-xs border border-input rounded-md px-2 py-1 bg-background hover:bg-muted/50 transition-colors flex flex-wrap gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {selected.length === 0 ? <span className="text-muted-foreground">{placeholder}</span> : selected.map(n => (
          <span key={n} className="inline-flex items-center gap-0.5 bg-muted rounded px-1.5 py-0.5">
            {n}<X className="h-2.5 w-2.5 cursor-pointer" onClick={e => { e.stopPropagation(); toggle(n); }} />
          </span>
        ))}
      </button>
      {open && options.length > 0 && (
        <div ref={dropdownRef} style={dropdownStyle} className="rounded-md border border-border bg-card shadow-lg py-1 max-h-40 overflow-y-auto">
          {options.map(opt => (
            <button key={opt.id} type="button" onPointerDown={e => { e.preventDefault(); toggle(opt.name); }}
              className={cn("w-full text-left text-xs px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-2", selected.includes(opt.name) && "bg-primary/10 font-medium")}
            >
              {opt.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />}
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Main BulkEditTab ──────────────────────────────────────────────────────────
export default function BulkEditTab({ restaurantId, categories, tags, remainingSlots, items, onImportComplete }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [progress, setProgress] = useState<{ saved: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ succeeded: number; failed: number } | null>(null);

  // ── Load existing items into rows on mount / when items change ──────────────
  useEffect(() => {
    if (items.length === 0) { setLoadingExisting(false); return; }
    setLoadingExisting(true);

    async function load() {
      const existingRows: Row[] = await Promise.all(
        items.map(async (item) => {
          const [catIds, tagIds] = await Promise.all([
            getMenuItemCategories(item.id),
            getMenuItemTags(item.id),
          ]);
          const catNames = catIds.map(id => categories.find(c => c.id === id)?.name).filter(Boolean) as string[];
          const tagNames = tagIds.map(id => tags.find(t => t.id === id)?.name).filter(Boolean) as string[];
          return {
            _id: item.id,
            _existingId: item.id,
            _errors: {},
            _status: "idle" as const,
            name: item.name,
            price: item.price.toString(),
            description: item.description ?? "",
            imageUrl: item.image_url ?? "",
            categoryNames: catNames,
            tagNames: tagNames,
            is_available: item.is_available,
          };
        })
      );
      setRows(existingRows);
      setLoadingExisting(false);
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const existingRows = rows.filter(r => !!r._existingId);
  const newRows = rows.filter(r => !r._existingId);
  const pendingNewRows = newRows.filter(r => r._status === "idle" || r._status === "error");
  const savedNewRows = newRows.filter(r => r._status === "saved");
  const overLimit = remainingSlots < pendingNewRows.length;
  const atRowLimit = pendingNewRows.length >= remainingSlots;

  const allNewValid = pendingNewRows.every(r => Object.keys(validateRow(r)).length === 0);
  const canSaveNew = pendingNewRows.length > 0 && allNewValid && !overLimit && !progress;

  function updateRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r;
      const updated = { ...r, ...patch };
      updated._errors = validateRow(updated);
      return updated;
    }));
  }

  function addRow() { setRows(prev => [...prev, newRow()]); }

  function deleteRow(id: string) {
    const row = rows.find(r => r._id === id);
    if (row?._existingId) {
      if (!confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
      deleteMenuItem(row._existingId).then(ok => { if (ok) onImportComplete(); });
    }
    setRows(prev => prev.filter(r => r._id !== id));
  }

  function clearSaved() {
    setRows(prev => prev.filter(r => r._status !== "saved" || !!r._existingId));
    setSummary(null);
  }

  // Save a single existing row
  async function saveExistingRow(id: string) {
    const row = rows.find(r => r._id === id);
    if (!row?._existingId) return;
    const errs = validateRow(row);
    if (Object.keys(errs).length > 0) { updateRow(id, { _errors: errs }); return; }

    updateRow(id, { _status: "saving" });
    const catIds = row.categoryNames.map(n => categories.find(c => c.name === n)?.id).filter(Boolean) as string[];
    const tagIds = row.tagNames.map(n => tags.find(t => t.name === n)?.id).filter(Boolean) as string[];

    const ok = await updateMenuItem(row._existingId, {
      name: row.name.trim(),
      price: parseFloat(row.price),
      description: row.description.trim() || null,
      image_url: row.imageUrl.trim() || null,
      is_available: row.is_available,
    });

    if (ok) {
      await Promise.all([
        setMenuItemCategories(row._existingId, catIds),
        setMenuItemTags(row._existingId, tagIds),
      ]);
      updateRow(id, { _status: "idle" });
      onImportComplete();
    } else {
      updateRow(id, { _status: "error", _errors: { save: "Save failed" } });
    }
  }

  // Save all new rows
  async function handleSaveNew() {
    if (!canSaveNew) return;
    const toSave = pendingNewRows.map(r => ({ ...r, _errors: validateRow(r) }));
    const invalid = toSave.filter(r => Object.keys(r._errors).length > 0);
    if (invalid.length > 0) {
      setRows(prev => prev.map(r => toSave.find(t => t._id === r._id) ?? r));
      return;
    }
    setRows(prev => prev.map(r =>
      !r._existingId && (r._status === "idle" || r._status === "error") ? { ...r, _status: "saving" as const } : r
    ));
    setProgress({ saved: 0, total: toSave.length });
    setSummary(null);

    const result = await batchCreateMenuItems({
      restaurantId, rows: toSave, categories, tags,
      onProgress: (saved, total) => setProgress({ saved, total }),
    });

    setRows(prev => prev.map(r => {
      const idx = toSave.findIndex(t => t._id === r._id);
      if (idx === -1) return r;
      const err = result.errors.find(e => e.rowIndex === idx);
      if (err) return { ...r, _status: "error" as const, _errors: { save: err.message } };
      return { ...r, _status: "saved" as const, _errors: {} };
    }));

    setProgress(null);
    setSummary({ succeeded: result.succeeded, failed: result.failed });
    if (result.succeeded > 0) onImportComplete();
  }

  const colHeaders = (
    <tr>
      <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Name *</th>
      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Price (₹) *</th>
      <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Description</th>
      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-24">Image</th>
      <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[140px]">Categories</th>
      <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[140px]">Tags</th>
      <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">Available</th>
      <th className="w-16" />
    </tr>
  );

  function renderRow(row: Row) {
    const isExisting = !!row._existingId;
    const isSaved = row._status === "saved";
    const isError = row._status === "error";
    const isSaving = row._status === "saving";

    return (
      <tr key={row._id} className={cn("transition-colors", isSaved && "bg-green-50", isError && "bg-red-50/50")}>
        {/* Name */}
        <td className="px-2 py-1.5">
          <div>
            <Input value={row.name} onChange={e => updateRow(row._id, { name: e.target.value })}
              placeholder="Item name" className={cn("h-8 text-xs", row._errors.name && "border-destructive")} disabled={isSaving} />
            {row._errors.name && <p className="text-[10px] text-destructive mt-0.5">{row._errors.name}</p>}
            {row._errors.save && <p className="text-[10px] text-destructive mt-0.5">{row._errors.save}</p>}
          </div>
        </td>
        {/* Price */}
        <td className="px-2 py-1.5">
          <div>
            <Input type="number" min="0" step="0.01" value={row.price}
              onChange={e => updateRow(row._id, { price: e.target.value })}
              placeholder="0.00" className={cn("h-8 text-xs", row._errors.price && "border-destructive")} disabled={isSaving} />
            {row._errors.price && <p className="text-[10px] text-destructive mt-0.5">{row._errors.price}</p>}
          </div>
        </td>
        {/* Description */}
        <td className="px-2 py-1.5">
          <Input value={row.description} onChange={e => updateRow(row._id, { description: e.target.value })}
            placeholder="Optional" className="h-8 text-xs" disabled={isSaving} />
        </td>
        {/* Image */}
        <td className="px-2 py-1.5">
          <ImageCell value={row.imageUrl} onChange={url => updateRow(row._id, { imageUrl: url })} disabled={isSaving} />
        </td>
        {/* Categories */}
        <td className="px-2 py-1.5">
          <MultiSelect options={categories} selected={row.categoryNames}
            onChange={names => updateRow(row._id, { categoryNames: names })} placeholder="Select…" disabled={isSaving} />
        </td>
        {/* Tags */}
        <td className="px-2 py-1.5">
          <MultiSelect options={tags} selected={row.tagNames}
            onChange={names => updateRow(row._id, { tagNames: names })} placeholder="Select…" disabled={isSaving} />
        </td>
        {/* Available */}
        <td className="px-2 py-1.5 text-center">
          <input type="checkbox" checked={row.is_available}
            onChange={e => updateRow(row._id, { is_available: e.target.checked })}
            className="h-4 w-4 accent-primary" disabled={isSaving} />
        </td>
        {/* Actions */}
        <td className="px-2 py-1.5 text-center">
          <div className="flex items-center justify-center gap-1">
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!isSaving && isSaved && !isExisting && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
            {!isSaving && isExisting && (
              <button onClick={() => saveExistingRow(row._id)}
                className="text-muted-foreground hover:text-primary transition-colors" title="Save changes">
                <Save className="h-3.5 w-3.5" />
              </button>
            )}
            {!isSaving && !isSaved && (
              <button onClick={() => deleteRow(row._id)} className="text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Edit existing items inline or add new rows below.
        </p>
        <div className="flex items-center gap-2">
          {savedNewRows.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearSaved}>
              Clear Saved ({savedNewRows.length})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={addRow} disabled={atRowLimit || !!progress}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
          </Button>
          <Button size="sm" onClick={handleSaveNew} disabled={!canSaveNew}>
            {progress
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving {progress.saved} / {progress.total}…</>
              : <>Save New ({pendingNewRows.length} item{pendingNewRows.length !== 1 ? "s" : ""})</>
            }
          </Button>
        </div>
      </div>

      {overLimit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You can only add {remainingSlots} more item{remainingSlots !== 1 ? "s" : ""} on your current plan. Remove rows or upgrade to Pro.
        </div>
      )}

      {summary && (
        <div className={cn("rounded-lg border px-4 py-3 text-sm flex items-center gap-2",
          summary.failed === 0 ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {summary.succeeded} of {summary.succeeded + summary.failed} new items saved.
          {summary.failed > 0 && " Failed rows are shown in red — fix and retry."}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">{colHeaders}</thead>
          <tbody className="divide-y">
            {/* ── Existing items ── */}
            {loadingExisting ? (
              <tr>
                <td colSpan={8} className="py-6 text-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
                </td>
              </tr>
            ) : existingRows.length > 0 ? (
              <>
                {existingRows.map(renderRow)}
                {/* Divider before new rows */}
                {newRows.length > 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-1.5 bg-muted/30 text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
                      New items
                    </td>
                  </tr>
                )}
              </>
            ) : null}

            {/* ── New rows ── */}
            {newRows.map(renderRow)}

            {/* ── Empty state ── */}
            {!loadingExisting && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground text-sm">
                  No items yet. Click "Add Row" to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

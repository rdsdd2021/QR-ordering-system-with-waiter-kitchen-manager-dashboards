"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Plus, Edit2, Trash2, Loader2, X, Image as ImageIcon,
  FolderOpen, Tag, Lock, Upload, Table2, Check, PencilLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUpload } from "@/components/ui/ImageUpload";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import CSVUploadTab from "@/components/manager/bulk-upload/CSVUploadTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAllMenuItems, createMenuItem, updateMenuItem, deleteMenuItem,
  getFoodCategories, getFoodTags,
  getMenuItemCategories, getMenuItemTags,
  setMenuItemCategories, setMenuItemTags,
} from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";
import { useSubscription } from "@/hooks/useSubscription";
import { cn } from "@/lib/utils";
import type { MenuItem, FoodCategory, FoodTag } from "@/types/database";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InlineEdit {
  name: string;
  price: string;
  description: string;
  imageUrl: string;
  categoryIds: string[];
  tagIds: string[];
  saving: boolean;
}

type Props = { restaurantId: string };
type FormMode = "add" | "edit" | null;
type MenuTab = "items" | "csv";

// ── Category/tag pill toggle (shared between inline & bulk) ───────────────────
function PillToggle({
  items, selected, onToggle, getLabel, disabled,
}: {
  items: Array<{ id: string; name: string; color?: string | null }>;
  selected: string[];
  onToggle: (id: string) => void;
  getLabel: (item: { id: string; name: string; color?: string | null }) => string;
  disabled?: boolean;
}) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => {
        const sel = selected.includes(item.id);
        return (
          <button key={item.id} type="button" disabled={disabled}
            onClick={() => onToggle(item.id)}
            className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors", sel ? "border-transparent text-white" : "hover:bg-accent")}
            style={sel ? { backgroundColor: item.color ?? "#6B7280" } : {}}
          >
            {!sel && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color ?? "#6B7280" }} />}
            {getLabel(item)}
            {sel && <X className="h-2.5 w-2.5 ml-0.5" />}
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MenuManager({ restaurantId }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog (add new item)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>([]);
  const [formTagIds, setFormTagIds] = useState<string[]>([]);
  const [formBusy, setFormBusy] = useState(false);

  const [allCategories, setAllCategories] = useState<FoodCategory[]>([]);
  const [allTags, setAllTags] = useState<FoodTag[]>([]);

  // Inline edit: single row
  const [inlineEdits, setInlineEdits] = useState<Map<string, InlineEdit>>(new Map());

  // Bulk edit mode: all rows editable at once
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkEdits, setBulkEdits] = useState<Map<string, InlineEdit>>(new Map());
  const [bulkSaving, setBulkSaving] = useState(false);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const { limits, isPro } = useSubscription(restaurantId);
  const atLimit = !isPro && items.length >= limits.max_menu_items;

  // ── Data loading ────────────────────────────────────────────────────────────

  async function loadItems() {
    setLoading(true);
    const [data, cats, tags] = await Promise.all([
      getAllMenuItems(restaurantId),
      getFoodCategories(restaurantId),
      getFoodTags(restaurantId),
    ]);
    setItems(data);
    setAllCategories(cats);
    setAllTags(tags);
    setLoading(false);
  }

  loadRef.current = loadItems;
  useEffect(() => { loadRef.current?.(); }, [restaurantId]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (channelRef.current) { client.removeChannel(channelRef.current); channelRef.current = null; }
    const channel = client
      .channel(`manager:${restaurantId}`)
      .on("broadcast", { event: "menu_changed" }, () => { loadRef.current?.(); })
      .on("postgres_changes" as any,
        { event: "*", schema: "public", table: "menu_items", filter: `restaurant_id=eq.${restaurantId}` },
        () => { loadRef.current?.(); })
      .subscribe();
    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  // ── Category helpers ────────────────────────────────────────────────────────

  const catMap = new Map<string, FoodCategory>();
  allCategories.forEach(c => catMap.set(c.id, c));
  function getCatLabel(c: { id: string; name: string; color?: string | null }) {
    const cat = catMap.get(c.id);
    return cat?.parent_id && catMap.has(cat.parent_id)
      ? `${catMap.get(cat.parent_id)!.name} / ${cat.name}`
      : c.name;
  }

  // ── Add dialog ──────────────────────────────────────────────────────────────

  function openAddDialog() {
    setFormMode("add"); setEditingItem(null);
    setFormName(""); setFormPrice(""); setFormDescription(""); setFormImageUrl("");
    setFormCategoryIds([]); setFormTagIds([]);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false); setFormMode(null); setEditingItem(null);
    setFormName(""); setFormPrice(""); setFormDescription(""); setFormImageUrl("");
    setFormCategoryIds([]); setFormTagIds([]);
  }

  async function handleSubmit() {
    if (!formName.trim() || !formPrice) return;
    setFormBusy(true);
    const itemData = {
      name: formName.trim(), price: parseFloat(formPrice),
      description: formDescription.trim() || null,
      image_url: formImageUrl.trim() || null,
      tags: null as string[] | null,
    };
    if (formMode === "add") {
      const newItem = await createMenuItem({ restaurantId, ...itemData });
      if (newItem) {
        await Promise.all([setMenuItemCategories(newItem.id, formCategoryIds), setMenuItemTags(newItem.id, formTagIds)]);
        closeDialog();
      }
    }
    setFormBusy(false);
  }

  // ── Availability toggle ─────────────────────────────────────────────────────

  async function handleToggleAvailability(item: MenuItem) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available: !i.is_available } : i));
    const ok = await updateMenuItem(item.id, { is_available: !item.is_available });
    if (!ok) setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available: item.is_available } : i));
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setItems(prev => prev.filter(i => i.id !== item.id));
    const ok = await deleteMenuItem(item.id);
    if (!ok) setItems(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  // ── Single inline edit ──────────────────────────────────────────────────────

  async function startInlineEdit(item: MenuItem) {
    const [catIds, tagIds] = await Promise.all([getMenuItemCategories(item.id), getMenuItemTags(item.id)]);
    setInlineEdits(prev => {
      const next = new Map(prev);
      next.set(item.id, { name: item.name, price: item.price.toString(), description: item.description || "", imageUrl: item.image_url || "", categoryIds: catIds, tagIds: tagIds, saving: false });
      return next;
    });
  }

  function cancelInlineEdit(itemId: string) {
    setInlineEdits(prev => { const next = new Map(prev); next.delete(itemId); return next; });
  }

  function patchInlineEdit(itemId: string, patch: Partial<InlineEdit>) {
    setInlineEdits(prev => {
      const next = new Map(prev);
      const cur = next.get(itemId);
      if (cur) next.set(itemId, { ...cur, ...patch });
      return next;
    });
  }

  async function saveInlineEdit(item: MenuItem) {
    const edit = inlineEdits.get(item.id);
    if (!edit) return;
    patchInlineEdit(item.id, { saving: true });
    const ok = await updateMenuItem(item.id, { name: edit.name.trim(), price: parseFloat(edit.price), description: edit.description.trim() || null, image_url: edit.imageUrl.trim() || null });
    if (ok) {
      await Promise.all([setMenuItemCategories(item.id, edit.categoryIds), setMenuItemTags(item.id, edit.tagIds)]);
      cancelInlineEdit(item.id);
    } else {
      patchInlineEdit(item.id, { saving: false });
    }
  }

  // ── Bulk edit mode ──────────────────────────────────────────────────────────

  async function enterBulkMode() {
    setBulkSaving(true);
    const entries = await Promise.all(
      items.map(async item => {
        const [catIds, tagIds] = await Promise.all([getMenuItemCategories(item.id), getMenuItemTags(item.id)]);
        return [item.id, { name: item.name, price: item.price.toString(), description: item.description || "", imageUrl: item.image_url || "", categoryIds: catIds, tagIds: tagIds, saving: false }] as [string, InlineEdit];
      })
    );
    setBulkEdits(new Map(entries));
    setBulkSaving(false);
    setBulkMode(true);
    setInlineEdits(new Map()); // clear any open single edits
  }

  function cancelBulkMode() {
    setBulkMode(false);
    setBulkEdits(new Map());
  }

  function patchBulkEdit(itemId: string, patch: Partial<InlineEdit>) {
    setBulkEdits(prev => {
      const next = new Map(prev);
      const cur = next.get(itemId);
      if (cur) next.set(itemId, { ...cur, ...patch });
      return next;
    });
  }

  async function saveAllBulk() {
    setBulkSaving(true);
    await Promise.all(
      items.map(async item => {
        const edit = bulkEdits.get(item.id);
        if (!edit) return;
        patchBulkEdit(item.id, { saving: true });
        const ok = await updateMenuItem(item.id, { name: edit.name.trim(), price: parseFloat(edit.price), description: edit.description.trim() || null, image_url: edit.imageUrl.trim() || null });
        if (ok) await Promise.all([setMenuItemCategories(item.id, edit.categoryIds), setMenuItemTags(item.id, edit.tagIds)]);
        patchBulkEdit(item.id, { saving: false });
      })
    );
    setBulkSaving(false);
    setBulkMode(false);
    setBulkEdits(new Map());
  }

  // ── Shared row renderer ─────────────────────────────────────────────────────

  function renderAvailabilityToggle(item: MenuItem) {
    return (
      <button type="button" role="switch" aria-checked={item.is_available} onClick={() => handleToggleAvailability(item)}
        className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none", item.is_available ? "bg-green-500" : "bg-gray-300")}
      >
        <span className={cn("pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform", item.is_available ? "translate-x-4" : "translate-x-0")} />
      </button>
    );
  }

  function renderEditRow(item: MenuItem, edit: InlineEdit, onPatch: (p: Partial<InlineEdit>) => void, onSave: () => void, onCancel: () => void) {
    return (
      <TableRow key={item.id} className="bg-muted/30 align-top">
        <TableCell className="py-2">
          <Input value={edit.name} onChange={e => onPatch({ name: e.target.value })} className="h-8 text-sm" disabled={edit.saving} autoFocus />
        </TableCell>
        <TableCell className="py-2">
          <Input type="number" min="0" step="0.01" value={edit.price} onChange={e => onPatch({ price: e.target.value })} className="h-8 text-sm" disabled={edit.saving} />
        </TableCell>
        <TableCell className="py-2">
          <Input value={edit.description} onChange={e => onPatch({ description: e.target.value })} placeholder="Optional" className="h-8 text-sm" disabled={edit.saving} />
        </TableCell>
        <TableCell className="py-2">
          <ImageUpload value={edit.imageUrl} onChange={url => onPatch({ imageUrl: url })} folder="menu-items" />
        </TableCell>
        <TableCell className="py-2">
          <PillToggle items={allCategories} selected={edit.categoryIds}
            onToggle={id => onPatch({ categoryIds: edit.categoryIds.includes(id) ? edit.categoryIds.filter(x => x !== id) : [...edit.categoryIds, id] })}
            getLabel={getCatLabel} disabled={edit.saving} />
        </TableCell>
        <TableCell className="py-2">
          <PillToggle items={allTags} selected={edit.tagIds}
            onToggle={id => onPatch({ tagIds: edit.tagIds.includes(id) ? edit.tagIds.filter(x => x !== id) : [...edit.tagIds, id] })}
            getLabel={i => i.name} disabled={edit.saving} />
        </TableCell>
        <TableCell className="py-2">{renderAvailabilityToggle(item)}</TableCell>
        <TableCell className="py-2 text-right">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={onSave} disabled={edit.saving || !edit.name.trim() || !edit.price}>
              {edit.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-green-600" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onCancel} disabled={edit.saving}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  function renderReadRow(item: MenuItem) {
    return (
      <TableRow key={item.id} className="group">
        <TableCell>
          <div className="flex items-center gap-3">
            {item.image_url
              ? <img src={item.image_url} alt={item.name} className="h-10 w-10 rounded object-cover shrink-0" />
              : <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0"><ImageIcon className="h-5 w-5 text-muted-foreground" /></div>
            }
            <p className="font-medium">{item.name}</p>
          </div>
        </TableCell>
        <TableCell>₹{item.price.toFixed(2)}</TableCell>
        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{item.description || "—"}</TableCell>
        <TableCell>
          {item.image_url ? <img src={item.image_url} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-muted-foreground text-xs">—</span>}
        </TableCell>
        <TableCell><span className="text-xs text-muted-foreground">—</span></TableCell>
        <TableCell>
          {item.tags && item.tags.length > 0
            ? <div className="flex flex-wrap gap-1">{item.tags.map(t => <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-muted">{t}</span>)}</div>
            : <span className="text-xs text-muted-foreground">—</span>}
        </TableCell>
        <TableCell>{renderAvailabilityToggle(item)}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="icon" onClick={() => startInlineEdit(item)} title="Edit"><Edit2 className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const tableHeaders = (
    <TableRow>
      <TableHead className="min-w-[180px]">Item</TableHead>
      <TableHead className="w-[110px]">Price</TableHead>
      <TableHead className="min-w-[180px]">Description</TableHead>
      <TableHead className="w-[90px]">Image</TableHead>
      <TableHead className="min-w-[160px]">Categories</TableHead>
      <TableHead className="min-w-[160px]">Tags</TableHead>
      <TableHead className="w-[90px]">Available</TableHead>
      <TableHead className="w-[90px] text-right">Actions</TableHead>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="items">
        <TabsList className="mb-2">
          <TabsTrigger value="items" className="gap-1.5">
            <Table2 className="h-3.5 w-3.5" /> Menu Items
          </TabsTrigger>
          <TabsTrigger value="csv" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> CSV Upload
          </TabsTrigger>
        </TabsList>

        {/* ── Menu Items tab ── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Menu Items</h2>
              <p className="text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? "item" : "items"}
                {!isPro && (
                  <span className={cn("ml-1.5", atLimit ? "text-destructive font-medium" : "text-muted-foreground")}>
                    · {items.length}/{limits.max_menu_items} free limit
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {bulkMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={cancelBulkMode} disabled={bulkSaving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveAllBulk} disabled={bulkSaving}>
                    {bulkSaving
                      ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving…</>
                      : <><Check className="h-3.5 w-3.5 mr-1.5" /> Save All</>
                    }
                  </Button>
                </>
              ) : (
                <>
                  {items.length > 0 && (
                    <Button variant="outline" size="sm" onClick={enterBulkMode} disabled={bulkSaving}>
                      {bulkSaving
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        : <PencilLine className="h-3.5 w-3.5 mr-1.5" />
                      }
                      Bulk Edit
                    </Button>
                  )}
                  <Button size="sm" onClick={openAddDialog} disabled={atLimit}
                    title={atLimit ? `Free plan limit reached (${limits.max_menu_items} items). Upgrade to Pro.` : undefined}>
                    {atLimit ? <Lock className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                    {atLimit ? "Limit Reached" : "Add Item"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {atLimit && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              Free plan is limited to {limits.max_menu_items} menu items. Upgrade to Pro for unlimited items.
            </div>
          )}

          {bulkMode && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
              Bulk edit mode — edit any field across all rows, then hit "Save All" to commit.
            </div>
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>{tableHeaders}</TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      No menu items yet. Add your first item to get started.
                    </TableCell>
                  </TableRow>
                ) : items.map(item => {
                  // Bulk mode: all rows editable, with per-row save
                  if (bulkMode) {
                    const edit = bulkEdits.get(item.id);
                    if (!edit) return null;
                    return renderEditRow(
                      item, edit,
                      p => patchBulkEdit(item.id, p),
                      async () => {
                        patchBulkEdit(item.id, { saving: true });
                        const ok = await updateMenuItem(item.id, { name: edit.name.trim(), price: parseFloat(edit.price), description: edit.description.trim() || null, image_url: edit.imageUrl.trim() || null });
                        if (ok) await Promise.all([setMenuItemCategories(item.id, edit.categoryIds), setMenuItemTags(item.id, edit.tagIds)]);
                        patchBulkEdit(item.id, { saving: false });
                      },
                      () => {}, // cancel does nothing in bulk mode — use the global Cancel button
                    );
                  }
                  // Single inline edit
                  const edit = inlineEdits.get(item.id);
                  if (edit) {
                    return renderEditRow(item, edit, p => patchInlineEdit(item.id, p), () => saveInlineEdit(item), () => cancelInlineEdit(item.id));
                  }
                  // Read-only
                  return renderReadRow(item);
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── CSV Upload tab ── */}
        <TabsContent value="csv">
          <CSVUploadTab
            restaurantId={restaurantId}
            categories={allCategories}
            tags={allTags}
            remainingSlots={isPro ? 9999 : Math.max(0, limits.max_menu_items - items.length)}
            onImportComplete={loadItems}
          />
        </TabsContent>
      </Tabs>

      {/* ── Add Item dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Menu Item</DialogTitle>
            <DialogDescription>Add a new item to your menu.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Margherita Pizza" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price (₹) *</Label>
              <Input id="price" type="number" step="0.01" min="0" value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea id="description" value={formDescription} onChange={e => setFormDescription(e.target.value)}
                placeholder="Brief description of the item..."
                className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" />
            </div>
            <div className="space-y-2">
              <Label>Image</Label>
              <ImageUpload value={formImageUrl} onChange={setFormImageUrl} folder="menu-items" />
            </div>
            {allCategories.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" /> Categories</Label>
                <PillToggle items={allCategories} selected={formCategoryIds}
                  onToggle={id => setFormCategoryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                  getLabel={getCatLabel} />
              </div>
            )}
            {allTags.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Tags</Label>
                <PillToggle items={allTags} selected={formTagIds}
                  onToggle={id => setFormTagIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                  getLabel={i => i.name} />
              </div>
            )}
            {allCategories.length === 0 && allTags.length === 0 && (
              <p className="text-xs text-muted-foreground">No categories or tags set up yet. Add them in <span className="font-medium">Categories &amp; Tags</span>.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={formBusy}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={formBusy || !formName.trim() || !formPrice}>
              {formBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

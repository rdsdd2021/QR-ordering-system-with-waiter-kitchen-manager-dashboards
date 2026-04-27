"use client";

import { useEffect, useState, useRef } from "react";
import { Plus, Edit2, Trash2, Loader2, X, Image as ImageIcon, FolderOpen, Tag } from "lucide-react";
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
import {
  getAllMenuItems, createMenuItem, updateMenuItem, deleteMenuItem,
  getFoodCategories, getFoodTags,
  getMenuItemCategories, getMenuItemTags,
  setMenuItemCategories, setMenuItemTags,
} from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { MenuItem, FoodCategory, FoodTag } from "@/types/database";

type Props = { restaurantId: string };
type FormMode = "add" | "edit" | null;

export default function MenuManager({ restaurantId }: Props) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [allCategories, setAllCategories] = useState<FoodCategory[]>([]);
  const [allTags, setAllTags] = useState<FoodTag[]>([]);
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>([]);
  const [formTagIds, setFormTagIds] = useState<string[]>([]);
  const [formBusy, setFormBusy] = useState(false);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

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
        () => { loadRef.current?.(); }
      )
      .subscribe();
    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  function openAddDialog() {
    setFormMode("add"); setEditingItem(null);
    setFormName(""); setFormPrice(""); setFormDescription(""); setFormImageUrl("");
    setFormCategoryIds([]); setFormTagIds([]);
    setDialogOpen(true);
  }

  async function openEditDialog(item: MenuItem) {
    setFormMode("edit"); setEditingItem(item);
    setFormName(item.name); setFormPrice(item.price.toString());
    setFormDescription(item.description || ""); setFormImageUrl(item.image_url || "");
    const [catIds, tagIds] = await Promise.all([
      getMenuItemCategories(item.id),
      getMenuItemTags(item.id),
    ]);
    setFormCategoryIds(catIds); setFormTagIds(tagIds);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false); setFormMode(null); setEditingItem(null);
    setFormName(""); setFormPrice(""); setFormDescription(""); setFormImageUrl("");
    setFormCategoryIds([]); setFormTagIds([]);
  }

  function toggleCategoryId(id: string) {
    setFormCategoryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleTagId(id: string) {
    setFormTagIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!formName.trim() || !formPrice) return;
    setFormBusy(true);
    const itemData = {
      name: formName.trim(),
      price: parseFloat(formPrice),
      description: formDescription.trim() || null,
      image_url: formImageUrl.trim() || null,
      tags: null as string[] | null,
    };

    if (formMode === "add") {
      const newItem = await createMenuItem({ restaurantId, ...itemData });
      if (newItem) {
        await Promise.all([
          setMenuItemCategories(newItem.id, formCategoryIds),
          setMenuItemTags(newItem.id, formTagIds),
        ]);
        // Realtime postgres_changes subscription will reload the list
        closeDialog();
      }
    } else if (formMode === "edit" && editingItem) {
      const success = await updateMenuItem(editingItem.id, itemData);
      if (success) {
        await Promise.all([
          setMenuItemCategories(editingItem.id, formCategoryIds),
          setMenuItemTags(editingItem.id, formTagIds),
        ]);
        // Realtime postgres_changes subscription will reload the list
        closeDialog();
      }
    }
    setFormBusy(false);
  }

  async function handleToggleAvailability(item: MenuItem) {
    // Optimistic update for instant feedback; realtime will confirm
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available: !i.is_available } : i));
    const success = await updateMenuItem(item.id, { is_available: !item.is_available });
    if (!success) {
      // Revert on failure
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_available: item.is_available } : i));
    }
  }

  async function handleDelete(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    // Optimistic removal; realtime will confirm
    setItems(prev => prev.filter(i => i.id !== item.id));
    const success = await deleteMenuItem(item.id);
    if (!success) {
      // Revert on failure
      setItems(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
    }
  }

  // Build label for category (shows "Parent / Child" for sub-categories)
  const catMap = new Map<string, FoodCategory>();
  allCategories.forEach(c => catMap.set(c.id, c));
  function getCatLabel(c: FoodCategory) {
    return c.parent_id && catMap.has(c.parent_id)
      ? `${catMap.get(c.parent_id)!.name} / ${c.name}`
      : c.name;
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Menu Items</h2>
          <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "item" : "items"}</p>
        </div>
        <Button onClick={openAddDialog} size="sm">
          <Plus className="mr-2 h-4 w-4" /> Add Item
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-[120px]">Price</TableHead>
              <TableHead className="w-[100px]">Available</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No menu items yet. Add your first item to get started.
                </TableCell>
              </TableRow>
            ) : items.map((item) => (
              <TableRow key={item.id} className="group">
                <TableCell>
                  <div className="flex items-center gap-3">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium">{item.name}</p>
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.tags.map(tag => (
                            <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-muted">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>₹{item.price.toFixed(2)}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.is_available}
                    onClick={() => handleToggleAvailability(item)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                      item.is_available ? "bg-green-500" : "bg-gray-300"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
                        item.is_available ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)}><Edit2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{formMode === "add" ? "Add Menu Item" : "Edit Menu Item"}</DialogTitle>
            <DialogDescription>
              {formMode === "add" ? "Add a new item to your menu." : "Update the item details."}
            </DialogDescription>
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
              <textarea
                id="description"
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="Brief description of the item..."
                className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <Label>Image</Label>
              <ImageUpload
                value={formImageUrl}
                onChange={setFormImageUrl}
                folder="menu-items"
              />
            </div>

            {/* Categories */}
            {allCategories.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" /> Categories</Label>
                <div className="flex flex-wrap gap-2">
                  {allCategories.map(cat => {
                    const selected = formCategoryIds.includes(cat.id);
                    return (
                      <button key={cat.id} type="button" onClick={() => toggleCategoryId(cat.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                          selected ? "border-transparent text-white" : "hover:bg-accent"
                        )}
                        style={selected ? { backgroundColor: cat.color ?? "#6B7280" } : {}}
                      >
                        {!selected && <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color ?? "#6B7280" }} />}
                        {getCatLabel(cat)}
                        {selected && <X className="h-3 w-3 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tags */}
            {allTags.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => {
                    const selected = formTagIds.includes(tag.id);
                    return (
                      <button key={tag.id} type="button" onClick={() => toggleTagId(tag.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                          selected ? "border-transparent text-white" : "hover:bg-accent"
                        )}
                        style={selected ? { backgroundColor: tag.color ?? "#6B7280" } : {}}
                      >
                        {!selected && <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color ?? "#6B7280" }} />}
                        {tag.name}
                        {selected && <X className="h-3 w-3 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {allCategories.length === 0 && allTags.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No categories or tags set up yet. Add them in <span className="font-medium">Menu → Categories &amp; Tags</span>.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={formBusy}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={formBusy || !formName.trim() || !formPrice}>
              {formBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {formMode === "add" ? "Add Item" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

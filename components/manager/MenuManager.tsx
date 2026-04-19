"use client";

import { useEffect, useState, useRef } from "react";
import { Plus, Edit2, Trash2, Loader2, X, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getAllMenuItems,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/types/database";

type Props = {
  restaurantId: string;
};

type FormMode = "add" | "edit" | null;

const AVAILABLE_TAGS = [
  { value: "veg", label: "Veg", color: "bg-green-100 text-green-800" },
  { value: "non_veg", label: "Non-Veg", color: "bg-red-100 text-red-800" },
  { value: "spicy", label: "Spicy", color: "bg-orange-100 text-orange-800" },
  { value: "bestseller", label: "Bestseller", color: "bg-yellow-100 text-yellow-800" },
  { value: "new", label: "New", color: "bg-blue-100 text-blue-800" },
];

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
  const [formTags, setFormTags] = useState<string[]>([]);
  const [formBusy, setFormBusy] = useState(false);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  async function loadItems() {
    setLoading(true);
    const data = await getAllMenuItems(restaurantId);
    setItems(data);
    setLoading(false);
  }

  loadRef.current = loadItems;

  useEffect(() => {
    loadRef.current?.();
  }, [restaurantId]);

  // Real-time: reload when any menu item changes
  useEffect(() => {
    const client = getSupabaseClient();

    if (channelRef.current) {
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = client
      .channel(`manager:${restaurantId}`)
      .on("broadcast", { event: "menu_changed" }, () => { loadRef.current?.(); })
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "menu_items", filter: `restaurant_id=eq.${restaurantId}` },
        () => { loadRef.current?.(); }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") loadRef.current?.();
      });

    channelRef.current = channel;
    return () => {
      client.removeChannel(channel);
      channelRef.current = null;
    };
  }, [restaurantId]);

  function openAddDialog() {
    setFormMode("add");
    setEditingItem(null);
    setFormName("");
    setFormPrice("");
    setFormDescription("");
    setFormImageUrl("");
    setFormTags([]);
    setDialogOpen(true);
  }

  function openEditDialog(item: MenuItem) {
    setFormMode("edit");
    setEditingItem(item);
    setFormName(item.name);
    setFormPrice(item.price.toString());
    setFormDescription(item.description || "");
    setFormImageUrl(item.image_url || "");
    setFormTags(item.tags || []);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setFormMode(null);
    setEditingItem(null);
    setFormName("");
    setFormPrice("");
    setFormDescription("");
    setFormImageUrl("");
    setFormTags([]);
  }

  function toggleTag(tag: string) {
    setFormTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (!formName.trim() || !formPrice) return;

    setFormBusy(true);

    const itemData = {
      name: formName.trim(),
      price: parseFloat(formPrice),
      description: formDescription.trim() || null,
      image_url: formImageUrl.trim() || null,
      tags: formTags.length > 0 ? formTags : null,
    };

    if (formMode === "add") {
      const newItem = await createMenuItem({
        restaurantId,
        ...itemData,
      });

      if (newItem) {
        setItems((prev) => [...prev, newItem].sort((a, b) => a.name.localeCompare(b.name)));
        closeDialog();
      }
    } else if (formMode === "edit" && editingItem) {
      const success = await updateMenuItem(editingItem.id, itemData);

      if (success) {
        setItems((prev) =>
          prev
            .map((item) =>
              item.id === editingItem.id
                ? { 
                    ...item, 
                    name: itemData.name,
                    price: itemData.price,
                    description: itemData.description || undefined,
                    image_url: itemData.image_url || undefined,
                    tags: itemData.tags || undefined,
                  } as MenuItem
                : item
            )
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        closeDialog();
      }
    }

    setFormBusy(false);
  }

  async function handleToggleAvailability(item: MenuItem) {
    const success = await updateMenuItem(item.id, {
      is_available: !item.is_available,
    });

    if (success) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, is_available: !i.is_available } : i
        )
      );
    }
  }

  async function handleDelete(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

    const success = await deleteMenuItem(item.id);
    if (success) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Menu Items</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
        </div>
        <Button onClick={openAddDialog} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Item
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
            ) : (
              items.map((item) => (
                <TableRow key={item.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{item.name}</p>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {item.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-xs px-1.5 py-0.5 rounded bg-muted"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>₹{item.price.toFixed(2)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={item.is_available}
                      onCheckedChange={() => handleToggleAvailability(item)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(item)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {formMode === "add" ? "Add Menu Item" : "Edit Menu Item"}
            </DialogTitle>
            <DialogDescription>
              {formMode === "add"
                ? "Add a new item to your menu."
                : "Update the item details."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Margherita Pizza"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Price (₹) *</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                min="0"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Brief description of the item..."
                className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="image">Image URL</Label>
              <Input
                id="image"
                value={formImageUrl}
                onChange={(e) => setFormImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
              />
              {formImageUrl && (
                <div className="mt-2">
                  <img
                    src={formImageUrl}
                    alt="Preview"
                    className="h-32 w-32 rounded object-cover border"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_TAGS.map((tag) => (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => toggleTag(tag.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      formTags.includes(tag.value)
                        ? tag.color + " ring-2 ring-offset-2 ring-primary"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {tag.label}
                    {formTags.includes(tag.value) && (
                      <X className="inline-block ml-1 h-3 w-3" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={formBusy}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={formBusy || !formName.trim() || !formPrice}
            >
              {formBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {formMode === "add" ? "Add Item" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Plus, Edit2, Trash2, Loader2, ChevronRight, ChevronDown,
  Tag, FolderOpen, Sparkles, Image as ImageIcon, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ImageUpload } from "@/components/ui/ImageUpload";
import {
  getFoodCategories, createFoodCategory, updateFoodCategory, deleteFoodCategory,
  getFoodTags, createFoodTag, updateFoodTag, deleteFoodTag,
  getCategorySuggestions, getTagSuggestions,
} from "@/lib/api";
import type { FoodCategory, FoodTag, CategorySuggestion, TagSuggestion } from "@/types/database";
import { cn } from "@/lib/utils";

// ── Color Picker ──────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#EAB308", "#84CC16",
  "#22C55E", "#10B981", "#14B8A6", "#06B6D4", "#3B82F6",
  "#6366F1", "#8B5CF6", "#A855F7", "#EC4899", "#F43F5E",
  "#78716C", "#6B7280", "#374151",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
              value === c ? "border-foreground scale-110" : "border-transparent"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full border" style={{ backgroundColor: value || "#6B7280" }} />
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="#6B7280"
          className="h-8 w-32 font-mono text-xs"
        />
      </div>
    </div>
  );
}

// ── Category Form Dialog ──────────────────────────────────────────────────────

type CategoryFormProps = {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  restaurantId: string;
  editing: FoodCategory | null;
  categories: FoodCategory[]; // for parent selector
};

function CategoryFormDialog({ open, onClose, onSave, restaurantId, editing, categories }: CategoryFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [color, setColor] = useState("#F97316");
  const [parentId, setParentId] = useState<string>("none");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setDescription(editing?.description ?? "");
      setImageUrl(editing?.image_url ?? "");
      setColor(editing?.color ?? "#F97316");
      setParentId(editing?.parent_id ?? "none");
    }
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      image_url: imageUrl.trim() || null,
      color: color || null,
      parent_id: parentId === "none" ? null : parentId,
    };
    if (editing) {
      await updateFoodCategory(editing.id, payload);
    } else {
      await createFoodCategory({ restaurantId, ...payload });
    }
    setBusy(false);
    onSave();
    onClose();
  }

  // Exclude self and its descendants from parent options
  const parentOptions = categories.filter(c => c.id !== editing?.id);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Category" : "New Category"}</DialogTitle>
          <DialogDescription>
            Categories help organise your menu. You can nest sub-categories under a parent.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Starters" required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short description shown to customers"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Parent Category</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger>
                <SelectValue placeholder="None (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (top-level)</SelectItem>
                {parentOptions.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Image</Label>
            <ImageUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="categories"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Tag Form Dialog ───────────────────────────────────────────────────────────

type TagFormProps = {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  restaurantId: string;
  editing: FoodTag | null;
};

function TagFormDialog({ open, onClose, onSave, restaurantId, editing }: TagFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [color, setColor] = useState("#22C55E");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setDescription(editing?.description ?? "");
      setImageUrl(editing?.image_url ?? "");
      setColor(editing?.color ?? "#22C55E");
    }
  }, [open, editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      image_url: imageUrl.trim() || null,
      color: color || null,
    };
    if (editing) {
      await updateFoodTag(editing.id, payload);
    } else {
      await createFoodTag({ restaurantId, ...payload });
    }
    setBusy(false);
    onSave();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Tag" : "New Tag"}</DialogTitle>
          <DialogDescription>
            Tags are labels like "Veg", "Spicy", "Bestseller" that appear on menu items.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spicy" required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this tag mean?"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Image</Label>
            <ImageUpload
              value={imageUrl}
              onChange={setImageUrl}
              folder="tags"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Suggestions Panel ─────────────────────────────────────────────────────────

function SuggestionsPanel({
  restaurantId,
  existingCategoryNames,
  existingTagNames,
  existingCategories,
  onAdded,
}: {
  restaurantId: string;
  existingCategoryNames: Set<string>;
  existingTagNames: Set<string>;
  existingCategories: FoodCategory[];
  onAdded: () => void;
}) {
  const [catSuggestions, setCatSuggestions] = useState<CategorySuggestion[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getCategorySuggestions(), getTagSuggestions()]).then(([cats, tags]) => {
      setCatSuggestions(cats);
      setTagSuggestions(tags);
      setLoading(false);
    });
  }, []);

  async function addCategory(s: CategorySuggestion) {
    setAdding(prev => new Set(prev).add(s.id));
    // Auto-link to parent if it already exists in the restaurant's categories
    let parentId: string | null = null;
    if (s.parent_name) {
      const parent = existingCategories.find(
        c => c.name.toLowerCase() === s.parent_name!.toLowerCase()
      );
      if (parent) parentId = parent.id;
    }
    await createFoodCategory({
      restaurantId,
      name: s.name,
      description: s.description,
      image_url: s.image_url,
      color: s.color,
      parent_id: parentId,
      is_suggestion: true,
    });
    setAdding(prev => { const n = new Set(prev); n.delete(s.id); return n; });
    onAdded();
  }

  async function addTag(s: TagSuggestion) {
    setAdding(prev => new Set(prev).add(s.id));
    await createFoodTag({
      restaurantId,
      name: s.name,
      description: s.description,
      image_url: s.image_url,
      color: s.color,
      is_suggestion: true,
    });
    setAdding(prev => { const n = new Set(prev); n.delete(s.id); return n; });
    onAdded();
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const topLevel = catSuggestions.filter(c => !c.parent_name);
  const subLevel = catSuggestions.filter(c => c.parent_name);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FolderOpen className="h-4 w-4" /> Category Suggestions
        </h3>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Top-level</p>
          <div className="flex flex-wrap gap-2">
            {topLevel.map(s => {
              const already = existingCategoryNames.has(s.name.toLowerCase());
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={already || adding.has(s.id)}
                  onClick={() => addCategory(s)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                    already
                      ? "cursor-default opacity-40"
                      : "hover:bg-accent cursor-pointer"
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color ?? "#6B7280" }} />
                  {adding.has(s.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {s.name}
                  {already && <span className="text-xs text-muted-foreground ml-1">✓</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Sub-categories</p>
          <div className="flex flex-wrap gap-2">
            {subLevel.map(s => {
              const already = existingCategoryNames.has(s.name.toLowerCase());
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={already || adding.has(s.id)}
                  onClick={() => addCategory(s)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                    already ? "cursor-default opacity-40" : "hover:bg-accent cursor-pointer"
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color ?? "#6B7280" }} />
                  {adding.has(s.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  <span className="text-muted-foreground text-xs">{s.parent_name} /</span>
                  {s.name}
                  {already && <span className="text-xs text-muted-foreground ml-1">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Tag className="h-4 w-4" /> Tag Suggestions
        </h3>
        <div className="flex flex-wrap gap-2">
          {tagSuggestions.map(s => {
            const already = existingTagNames.has(s.name.toLowerCase());
            return (
              <button
                key={s.id}
                type="button"
                disabled={already || adding.has(s.id)}
                onClick={() => addTag(s)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  already ? "cursor-default opacity-40" : "hover:bg-accent cursor-pointer"
                )}
                style={already ? {} : { borderColor: s.color ?? undefined }}
              >
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color ?? "#6B7280" }} />
                {adding.has(s.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {s.name}
                {already && <span className="text-xs text-muted-foreground ml-1">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Category Row ──────────────────────────────────────────────────────────────

function CategoryRow({
  category,
  depth = 0,
  onEdit,
  onDelete,
}: {
  category: FoodCategory;
  depth?: number;
  onEdit: (c: FoodCategory) => void;
  onDelete: (c: FoodCategory) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (category.children?.length ?? 0) > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 group"
        style={{ paddingLeft: `${12 + depth * 20}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className={cn("h-4 w-4 text-muted-foreground", !hasChildren && "invisible")}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {category.image_url ? (
          <img src={category.image_url} alt={category.name} className="h-7 w-7 rounded object-cover flex-shrink-0" />
        ) : (
          <span
            className="h-7 w-7 rounded flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: category.color ?? "#6B7280" }}
          >
            {category.name[0].toUpperCase()}
          </span>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{category.name}</p>
          {category.description && (
            <p className="text-xs text-muted-foreground truncate">{category.description}</p>
          )}
        </div>

        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(category)}>
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(category)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && hasChildren && category.children!.map(child => (
        <CategoryRow key={child.id} category={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function CategoryTagManager({ restaurantId }: { restaurantId: string }) {
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [tags, setTags] = useState<FoodTag[]>([]);
  const [loading, setLoading] = useState(true);

  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<FoodCategory | null>(null);

  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<FoodTag | null>(null);

  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  async function load() {
    const [cats, tgs] = await Promise.all([
      getFoodCategories(restaurantId),
      getFoodTags(restaurantId),
    ]);
    setCategories(cats);
    setTags(tgs);
    setLoading(false);
  }

  useEffect(() => { load(); }, [restaurantId]);

  // Build tree for display
  const catMap = new Map<string, FoodCategory>();
  categories.forEach(c => catMap.set(c.id, { ...c, children: [] }));
  const catTree: FoodCategory[] = [];
  catMap.forEach(c => {
    if (c.parent_id && catMap.has(c.parent_id)) {
      catMap.get(c.parent_id)!.children!.push(c);
    } else {
      catTree.push(c);
    }
  });

  const existingCategoryNames = new Set(categories.map(c => c.name.toLowerCase()));
  const existingTagNames = new Set(tags.map(t => t.name.toLowerCase()));

  async function handleDeleteCategory(cat: FoodCategory) {
    if (!confirm(`Delete "${cat.name}"? Sub-categories will also be deleted.`)) return;
    await deleteFoodCategory(cat.id);
    load();
  }

  async function handleDeleteTag(tag: FoodTag) {
    if (!confirm(`Delete tag "${tag.name}"?`)) return;
    await deleteFoodTag(tag.id);
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Categories &amp; Tags</h2>
          <p className="text-sm text-muted-foreground">
            Organise your menu with categories and labels
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSuggestionsOpen(true)}>
          <Sparkles className="mr-2 h-4 w-4" />
          Suggestions
        </Button>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">
            <FolderOpen className="mr-2 h-4 w-4" />
            Categories ({categories.length})
          </TabsTrigger>
          <TabsTrigger value="tags">
            <Tag className="mr-2 h-4 w-4" />
            Tags ({tags.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Categories Tab ── */}
        <TabsContent value="categories" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setEditingCat(null); setCatDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add Category
            </Button>
          </div>

          {catTree.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              <FolderOpen className="mx-auto h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No categories yet.</p>
              <p className="text-xs mt-1">Add your own or pick from suggestions.</p>
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              {catTree.map(cat => (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  onEdit={c => { setEditingCat(c); setCatDialogOpen(true); }}
                  onDelete={handleDeleteCategory}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tags Tab ── */}
        <TabsContent value="tags" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setEditingTag(null); setTagDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add Tag
            </Button>
          </div>

          {tags.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              <Tag className="mx-auto h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No tags yet.</p>
              <p className="text-xs mt-1">Add your own or pick from suggestions.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 p-4 rounded-lg border">
              {tags.map(tag => (
                <div
                  key={tag.id}
                  className="group flex items-center gap-2 rounded-full border px-3 py-1.5"
                  style={{ borderColor: tag.color ?? undefined }}
                >
                  {tag.image_url ? (
                    <img src={tag.image_url} alt={tag.name} className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color ?? "#6B7280" }} />
                  )}
                  <span className="text-sm font-medium">{tag.name}</span>
                  {tag.description && (
                    <span className="text-xs text-muted-foreground hidden group-hover:inline">{tag.description}</span>
                  )}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => { setEditingTag(tag); setTagDialogOpen(true); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTag(tag)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CategoryFormDialog
        open={catDialogOpen}
        onClose={() => setCatDialogOpen(false)}
        onSave={load}
        restaurantId={restaurantId}
        editing={editingCat}
        categories={categories}
      />

      <TagFormDialog
        open={tagDialogOpen}
        onClose={() => setTagDialogOpen(false)}
        onSave={load}
        restaurantId={restaurantId}
        editing={editingTag}
      />

      {/* Suggestions Dialog */}
      <Dialog open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" /> Common Suggestions
            </DialogTitle>
            <DialogDescription>
              Click any suggestion to add it to your restaurant. Already-added items are greyed out.
            </DialogDescription>
          </DialogHeader>
          <SuggestionsPanel
            restaurantId={restaurantId}
            existingCategoryNames={existingCategoryNames}
            existingTagNames={existingTagNames}
            existingCategories={categories}
            onAdded={load}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

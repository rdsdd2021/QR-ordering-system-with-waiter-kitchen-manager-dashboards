"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Layers, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Plan } from "@/hooks/usePlans";

const CTA_OPTIONS = [
  { value: "choose",                label: "Choose (self-serve purchase)" },
  { value: "contact",               label: "Contact Sales" },
  { value: "downgrade_unsupported", label: "Contact Support (downgrade)" },
];

const EMPTY_FORM = {
  id: "",
  name: "",
  tagline: "",
  monthly_paise: "",
  yearly_paise: "",
  features: "",       // newline-separated
  unavailable: "",    // newline-separated
  is_active: true,
  is_highlighted: false,
  cta: "choose" as Plan["cta"],
  sort_order: "0",
};

export default function PlanManager() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/plans");
    const data = await res.json();
    setPlans(Array.isArray(data) ? data : []);
    setLoaded(true);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, sort_order: String(plans.length + 1) });
    setError("");
    setDialogOpen(true);
  }

  function openEdit(p: Plan) {
    setEditing(p);
    setForm({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      monthly_paise: String(p.monthly_paise),
      yearly_paise: String(p.yearly_paise),
      features: p.features.join("\n"),
      unavailable: p.unavailable.join("\n"),
      is_active: p.is_active,
      is_highlighted: p.is_highlighted,
      cta: p.cta,
      sort_order: String(p.sort_order),
    });
    setError("");
    setDialogOpen(true);
  }

  async function save() {
    setError("");
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.id.trim() && !editing) { setError("ID is required"); return; }

    setSaving(true);
    const payload = {
      ...(editing ? {} : { id: form.id.trim().toLowerCase().replace(/\s+/g, "_") }),
      name: form.name.trim(),
      tagline: form.tagline.trim(),
      monthly_paise: Number(form.monthly_paise) || 0,
      yearly_paise: Number(form.yearly_paise) || 0,
      features: form.features.split("\n").map(s => s.trim()).filter(Boolean),
      unavailable: form.unavailable.split("\n").map(s => s.trim()).filter(Boolean),
      is_active: form.is_active,
      is_highlighted: form.is_highlighted,
      cta: form.cta,
      sort_order: Number(form.sort_order) || 0,
    };

    const url = editing ? `/api/admin/plans/${editing.id}` : "/api/admin/plans";
    const method = editing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) { setError(data.error ?? "Failed to save"); setSaving(false); return; }

    if (editing) {
      setPlans(prev => prev.map(p => p.id === editing.id ? data : p));
    } else {
      setPlans(prev => [...prev, data].sort((a, b) => a.sort_order - b.sort_order));
    }
    setDialogOpen(false);
    setSaving(false);
  }

  async function toggleActive(p: Plan) {
    const res = await fetch(`/api/admin/plans/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !p.is_active }),
    });
    if (res.ok) {
      const data = await res.json();
      setPlans(prev => prev.map(x => x.id === p.id ? data : x));
    }
  }

  async function deletePlan(p: Plan) {
    if (!confirm(`Delete plan "${p.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/plans/${p.id}`, { method: "DELETE" });
    if (res.ok) setPlans(prev => prev.filter(x => x.id !== p.id));
  }

  if (!loaded) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Plan Management
          </h2>
          <Button size="sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Load Plans"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Click "Load Plans" to manage pricing plans.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <Layers className="h-4 w-4" /> Plan Management
          <Badge variant="secondary">{plans.length}</Badge>
        </h2>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New Plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">No plans yet.</Card>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-6"></th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Plan</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Monthly</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Yearly</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">CTA</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Highlighted</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Active</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {plans.sort((a, b) => a.sort_order - b.sort_order).map((p) => (
                <tr key={p.id} className={cn("hover:bg-muted/30", !p.is_active && "opacity-60")}>
                  <td className="px-3 py-3 text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{p.id}</p>
                    <p className="text-xs text-muted-foreground">{p.tagline}</p>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {p.monthly_paise === 0 ? "Custom" : `₹${(p.monthly_paise / 100).toLocaleString("en-IN")}`}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {p.yearly_paise === 0 ? "Custom" : `₹${(p.yearly_paise / 100).toLocaleString("en-IN")}`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs capitalize">{p.cta.replace(/_/g, " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.is_highlighted ? <span className="text-primary font-bold">★</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(p)}>
                      {p.is_active
                        ? <ToggleRight className="h-5 w-5 text-green-600 mx-auto" />
                        : <ToggleLeft className="h-5 w-5 text-muted-foreground mx-auto" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deletePlan(p)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Plan: ${editing.name}` : "Create Plan"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label>Plan ID <span className="text-muted-foreground text-xs">(slug, e.g. "pro")</span></Label>
                <Input
                  placeholder="pro"
                  value={form.id}
                  onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/\s+/g, "_") }))}
                  className="font-mono"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Pro" />
              </div>
              <div className="space-y-1.5">
                <Label>Sort Order</Label>
                <Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Tagline</Label>
              <Input value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} placeholder="Best for growing restaurants" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Monthly Price (₹)</Label>
                <Input
                  type="number" min="0"
                  placeholder="999"
                  value={form.monthly_paise ? String(Number(form.monthly_paise) / 100) : ""}
                  onChange={e => setForm(f => ({ ...f, monthly_paise: String(Math.round(Number(e.target.value) * 100)) }))}
                />
                <p className="text-[10px] text-muted-foreground">0 = Custom/Contact</p>
              </div>
              <div className="space-y-1.5">
                <Label>Yearly Price (₹/mo)</Label>
                <Input
                  type="number" min="0"
                  placeholder="799"
                  value={form.yearly_paise ? String(Number(form.yearly_paise) / 100) : ""}
                  onChange={e => setForm(f => ({ ...f, yearly_paise: String(Math.round(Number(e.target.value) * 100)) }))}
                />
                <p className="text-[10px] text-muted-foreground">Billed annually</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Features <span className="text-muted-foreground text-xs">(one per line)</span></Label>
              <textarea
                value={form.features}
                onChange={e => setForm(f => ({ ...f, features: e.target.value }))}
                placeholder={"Up to 20 Tables\nAdvanced Reports\nPriority Support"}
                rows={5}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Unavailable Features <span className="text-muted-foreground text-xs">(shown greyed out, one per line)</span></Label>
              <textarea
                value={form.unavailable}
                onChange={e => setForm(f => ({ ...f, unavailable: e.target.value }))}
                placeholder="Priority Support"
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <Label>CTA Type</Label>
              <select
                value={form.cta}
                onChange={e => setForm(f => ({ ...f, cta: e.target.value as Plan["cta"] }))}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_highlighted} onChange={e => setForm(f => ({ ...f, is_highlighted: e.target.checked }))} className="h-4 w-4" />
                <span className="text-sm">Highlighted (recommended badge)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="h-4 w-4" />
                <span className="text-sm">Active</span>
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Create Plan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

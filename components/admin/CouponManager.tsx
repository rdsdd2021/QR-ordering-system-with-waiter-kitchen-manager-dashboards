"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Tag, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Coupon = {
  id: string;
  code: string;
  type: "percentage" | "flat";
  value: number;
  duration_days: number | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  applicable_plans: string[];
  created_at: string;
};

const ALL_PLANS = ["pro", "business"];

const EMPTY_FORM = {
  code: "",
  type: "percentage" as "percentage" | "flat",
  value: "",
  duration_days: "",
  max_uses: "",
  expires_at: "",
  applicable_plans: ["pro"] as string[],
  is_active: true,
};

export default function CouponManager() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/coupons");
    const data = await res.json();
    setCoupons(Array.isArray(data) ? data : []);
    setLoaded(true);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setDialogOpen(true);
  }

  function openEdit(c: Coupon) {
    setEditing(c);
    setForm({
      code: c.code,
      type: c.type,
      value: String(c.value),
      duration_days: c.duration_days != null ? String(c.duration_days) : "",
      max_uses: c.max_uses != null ? String(c.max_uses) : "",
      expires_at: c.expires_at ? c.expires_at.slice(0, 10) : "",
      applicable_plans: c.applicable_plans,
      is_active: c.is_active,
    });
    setError("");
    setDialogOpen(true);
  }

  async function save() {
    setError("");
    if (!form.code.trim()) { setError("Code is required"); return; }
    if (!form.value || isNaN(Number(form.value)) || Number(form.value) <= 0) {
      setError("Discount value must be a positive number"); return;
    }
    if (form.type === "percentage" && Number(form.value) > 100) {
      setError("Percentage cannot exceed 100"); return;
    }
    if (form.duration_days && (isNaN(Number(form.duration_days)) || Number(form.duration_days) < 1)) {
      setError("Duration must be a positive number of days"); return;
    }
    if (form.applicable_plans.length === 0) {
      setError("Select at least one plan"); return;
    }

    setSaving(true);
    const payload = {
      code: form.code.toUpperCase().trim(),
      type: form.type,
      value: Number(form.value),
      duration_days: form.duration_days ? Number(form.duration_days) : null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      applicable_plans: form.applicable_plans,
      is_active: form.is_active,
    };

    const url = editing ? `/api/admin/coupons/${editing.id}` : "/api/admin/coupons";
    const method = editing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to save");
      setSaving(false);
      return;
    }

    if (editing) {
      setCoupons((prev) => prev.map((c) => (c.id === editing.id ? data : c)));
    } else {
      setCoupons((prev) => [data, ...prev]);
    }
    setDialogOpen(false);
    setSaving(false);
  }

  async function toggleActive(c: Coupon) {
    const res = await fetch(`/api/admin/coupons/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    if (res.ok) {
      const data = await res.json();
      setCoupons((prev) => prev.map((x) => (x.id === c.id ? data : x)));
    }
  }

  async function deleteCoupon(c: Coupon) {
    if (!confirm(`Delete coupon "${c.code}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/coupons/${c.id}`, { method: "DELETE" });
    if (res.ok) setCoupons((prev) => prev.filter((x) => x.id !== c.id));
  }

  function togglePlan(plan: string) {
    setForm((f) => ({
      ...f,
      applicable_plans: f.applicable_plans.includes(plan)
        ? f.applicable_plans.filter((p) => p !== plan)
        : [...f.applicable_plans, plan],
    }));
  }

  if (!loaded) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base flex items-center gap-2">
            <Tag className="h-4 w-4" /> Coupon Management
          </h2>
          <Button size="sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Load Coupons"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Click "Load Coupons" to manage discount codes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <Tag className="h-4 w-4" /> Coupon Management
          <Badge variant="secondary">{coupons.length}</Badge>
        </h2>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New Coupon
        </Button>
      </div>

      {coupons.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          No coupons yet. Create your first discount code.
        </Card>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Code</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Discount</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Bonus Days</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Plans</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Usage</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Expires</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {coupons.map((c) => {
                const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
                const maxed = c.max_uses != null && c.used_count >= c.max_uses;
                return (
                  <tr key={c.id} className={cn("hover:bg-muted/30", !c.is_active && "opacity-60")}>
                    <td className="px-4 py-3 font-mono font-semibold text-xs tracking-wider">{c.code}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">
                        {c.type === "percentage" ? `${c.value}%` : `₹${c.value}`}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">{c.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      {c.duration_days ? (
                        <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                          <Clock className="h-3 w-3" />+{c.duration_days}d
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.applicable_plans.map((p) => (
                          <Badge key={p} variant="outline" className="text-xs py-0">{p}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className={cn(maxed && "text-destructive font-medium")}>
                        {c.used_count}
                      </span>
                      {c.max_uses != null && (
                        <span className="text-muted-foreground"> / {c.max_uses}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.expires_at ? (
                        <span className={cn(expired && "text-destructive")}>
                          {new Date(c.expires_at).toLocaleDateString()}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(c)} title={c.is_active ? "Deactivate" : "Activate"}>
                        {c.is_active
                          ? <ToggleRight className="h-5 w-5 text-green-600 mx-auto" />
                          : <ToggleLeft className="h-5 w-5 text-muted-foreground mx-auto" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteCoupon(c)}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Coupon" : "Create Coupon"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input
                placeholder="e.g. LAUNCH20"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="font-mono uppercase"
              />
            </div>

            {/* Discount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Discount Type</Label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "percentage" | "flat" }))}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="flat">Flat amount (₹)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Value {form.type === "percentage" ? "(%)" : "(₹)"}</Label>
                <Input
                  type="number"
                  min="0"
                  max={form.type === "percentage" ? "100" : undefined}
                  placeholder={form.type === "percentage" ? "20" : "500"}
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                />
              </div>
            </div>

            {/* Bonus duration */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Bonus Days <span className="text-muted-foreground font-normal">(optional — extends subscription period)</span>
              </Label>
              <Input
                type="number"
                min="1"
                placeholder="e.g. 30 adds 30 extra days"
                value={form.duration_days}
                onChange={(e) => setForm((f) => ({ ...f, duration_days: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max Uses <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  value={form.max_uses}
                  onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Coupon Expires <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Applicable Plans</Label>
              <div className="flex gap-2">
                {ALL_PLANS.map((plan) => (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => togglePlan(plan)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
                      form.applicable_plans.includes(plan)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-foreground"
                    )}
                  >
                    {plan}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="h-4 w-4"
              />
              <Label htmlFor="is_active">Active</Label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Create Coupon"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

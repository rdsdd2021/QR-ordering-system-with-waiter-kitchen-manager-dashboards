'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Edit2, Trash2, Loader2, UserCheck, UserX } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

type Waiter = {
  id: string;
  name: string;
  email: string | null;
  is_active: boolean;
  active_orders: number;
  status: 'available' | 'busy' | 'inactive';
};

type FormMode = 'add' | 'edit' | null;

export default function StaffManager({ restaurantId }: { restaurantId: string }) {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null>(null);

  useEffect(() => {
    fetchWaiters();

    // Real-time: refresh when orders or users change
    const client = getSupabaseClient();
    if (channelRef.current) client.removeChannel(channelRef.current);

    const channel = client
      .channel(`staff-manager:${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, fetchWaiters)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `restaurant_id=eq.${restaurantId}` }, fetchWaiters)
      .subscribe();

    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  async function fetchWaiters() {
    // Join users with active order counts
    const { data, error } = await supabase
      .from('users')
      .select(`
        id, name, email, is_active,
        active_orders:orders(id)
      `)
      .eq('restaurant_id', restaurantId)
      .eq('role', 'waiter')
      .order('name');

    if (error) { console.error(error); return; }

    const mapped: Waiter[] = (data ?? []).map((u: any) => {
      const activeCount = Array.isArray(u.active_orders) ? u.active_orders.length : 0;
      let status: Waiter['status'] = 'inactive';
      if (u.is_active) status = activeCount > 0 ? 'busy' : 'available';
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        is_active: u.is_active,
        active_orders: activeCount,
        status,
      };
    });

    setWaiters(mapped);
    setPageLoading(false);
  }

  // ── Dialog helpers ─────────────────────────────────────────────────
  function openAdd() {
    setFormMode('add');
    setEditingId(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(w: Waiter) {
    setFormMode('edit');
    setEditingId(w.id);
    setFormName(w.name);
    setFormEmail(w.email ?? '');
    setFormPassword('');
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setFormMode(null);
    setEditingId(null);
    setFormError(null);
  }

  // ── CRUD ───────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!formName.trim()) return;
    setFormBusy(true);
    setFormError(null);

    if (formMode === 'add') {
      if (!formEmail.trim() || !formPassword.trim()) {
        setFormError('Email and password are required for new waiters.');
        setFormBusy(false);
        return;
      }

      // Use server-side API route to create auth user + profile without
      // disrupting the manager's own session
      const res = await fetch('/api/staff/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          email: formEmail.trim().toLowerCase(),
          password: formPassword.trim(),
          role: 'waiter',
          restaurantId,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? 'Failed to create waiter.');
        setFormBusy(false);
        return;
      }

      closeDialog();
      fetchWaiters();
    } else if (formMode === 'edit' && editingId) {
      const updates: any = { name: formName.trim() };
      if (formEmail.trim()) updates.email = formEmail.trim().toLowerCase();

      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', editingId);

      if (error) {
        setFormError(error.message);
        setFormBusy(false);
        return;
      }

      closeDialog();
      fetchWaiters();
    }

    setFormBusy(false);
  }

  async function handleToggleActive(waiter: Waiter) {
    setBusy(waiter.id);
    await supabase
      .from('users')
      .update({ is_active: !waiter.is_active })
      .eq('id', waiter.id);
    await fetchWaiters();
    setBusy(null);
  }

  async function handleDelete(waiter: Waiter) {
    if (waiter.active_orders > 0) {
      alert(`${waiter.name} has ${waiter.active_orders} active order(s). Reassign or complete them first.`);
      return;
    }
    if (!confirm(`Remove ${waiter.name}? This cannot be undone.`)) return;

    setBusy(waiter.id);
    await supabase.from('users').delete().eq('id', waiter.id);
    await fetchWaiters();
    setBusy(null);
  }

  // ── Stats ──────────────────────────────────────────────────────────
  const available = waiters.filter(w => w.status === 'available').length;
  const busyCount = waiters.filter(w => w.status === 'busy').length;
  const inactive  = waiters.filter(w => w.status === 'inactive').length;

  function StatusBadge({ status }: { status: Waiter['status'] }) {
    if (status === 'available') return <Badge className="bg-green-500 text-white">Available</Badge>;
    if (status === 'busy')      return <Badge className="bg-orange-500 text-white">Busy</Badge>;
    return <Badge variant="secondary">Inactive</Badge>;
  }

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Staff Management</h2>
          <p className="text-sm text-muted-foreground">Manage waiters and view real-time availability</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Waiter
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: waiters.length, color: '' },
          { label: 'Available', value: available, color: 'text-green-600' },
          { label: 'Busy', value: busyCount, color: 'text-orange-600' },
          { label: 'Inactive', value: inactive, color: 'text-muted-foreground' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </Card>
        ))}
      </div>

      {/* Waiter cards */}
      {waiters.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-muted-foreground">No waiters yet.</p>
          <Button className="mt-4" size="sm" onClick={openAdd}>Add your first waiter</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {waiters.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold">{w.name}</p>
                  {w.email && <p className="text-xs text-muted-foreground mt-0.5">{w.email}</p>}
                </div>
                <StatusBadge status={w.status} />
              </div>

              <div className="text-sm space-y-1 mb-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active orders</span>
                  <span className="font-medium">{w.active_orders}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => openEdit(w)}
                  disabled={busy === w.id}
                >
                  <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant={w.is_active ? 'outline' : 'default'}
                  className="flex-1"
                  onClick={() => handleToggleActive(w)}
                  disabled={busy === w.id}
                >
                  {busy === w.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : w.is_active ? (
                    <><UserX className="h-3.5 w-3.5 mr-1.5" />Deactivate</>
                  ) : (
                    <><UserCheck className="h-3.5 w-3.5 mr-1.5" />Activate</>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                  onClick={() => handleDelete(w)}
                  disabled={busy === w.id}
                  title="Remove waiter"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Only active waiters can take orders. Deactivating a waiter won't affect their existing orders.
      </p>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{formMode === 'add' ? 'Add Waiter' : 'Edit Waiter'}</DialogTitle>
            <DialogDescription>
              {formMode === 'add'
                ? 'Create a new waiter account. They can log in at /login.'
                : 'Update waiter details.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="waiter-name">Name *</Label>
              <Input
                id="waiter-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Alice"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="waiter-email">Email {formMode === 'add' ? '*' : ''}</Label>
              <Input
                id="waiter-email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="alice@restaurant.com"
              />
            </div>

            {formMode === 'add' && (
              <div className="space-y-1.5">
                <Label htmlFor="waiter-password">Password *</Label>
                <Input
                  id="waiter-password"
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
                <p className="text-xs text-muted-foreground">
                  The waiter will use this to log in. You can also confirm their account from the Supabase dashboard.
                </p>
              </div>
            )}

            {formError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={formBusy}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={formBusy || !formName.trim()}
            >
              {formBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {formMode === 'add' ? 'Add Waiter' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

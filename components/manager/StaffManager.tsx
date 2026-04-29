'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, Edit2, Trash2, Loader2, UserCheck, UserX } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
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

type StaffRole = 'waiter' | 'kitchen';

type StaffMember = {
  id: string;
  name: string;
  email: string | null;
  role: StaffRole;
  is_active: boolean;
  active_orders: number;
  last_action_at: string | null;
  status: 'available' | 'busy' | 'inactive';
};

type FormMode = 'add' | 'edit' | null;

export default function StaffManager({ restaurantId }: { restaurantId: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<StaffRole>('waiter');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null>(null);

  useEffect(() => {
    fetchStaff();

    const client = getSupabaseClient();
    if (channelRef.current) client.removeChannel(channelRef.current);

    const channel = client
      .channel(`staff-manager:${restaurantId}`)
      // Only re-fetch when waiter_id changes (assignment) — not on every status tick
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `restaurant_id=eq.${restaurantId}`,
      }, (payload: any) => {
        const { old: oldRow, new: newRow } = payload;
        // Only trigger if waiter assignment changed
        if (oldRow?.waiter_id !== newRow?.waiter_id) fetchStaff();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, fetchStaff)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `restaurant_id=eq.${restaurantId}` }, fetchStaff)
      .subscribe();

    channelRef.current = channel;
    return () => { client.removeChannel(channel); channelRef.current = null; };
  }, [restaurantId]);

  async function fetchStaff() {
    const client = getSupabaseClient();
    // Fetch users and their non-served orders separately to get accurate busy/available status
    const { data, error } = await client
      .from('users')
      .select(`id, name, email, role, is_active, active_orders:orders(id, status, served_at, ready_at, created_at)`)
      .eq('restaurant_id', restaurantId)
      .in('role', ['waiter', 'kitchen'])
      .order('name');

    if (error) { console.error(error); return; }

    const mapped: StaffMember[] = (data ?? []).map((u: any) => {
      const allOrders = Array.isArray(u.active_orders) ? u.active_orders : [];
      const activeCount = allOrders.filter((o: any) => o.status !== 'served').length;
      // Derive last action time from most recent order
      const timestamps = allOrders
        .map((o: any) => o.served_at ?? o.ready_at ?? o.created_at)
        .filter(Boolean) as string[];
      const last_action_at = timestamps.length
        ? timestamps.reduce((a, b) => (a > b ? a : b))
        : null;
      let status: StaffMember['status'] = 'inactive';
      if (u.is_active) status = activeCount > 0 ? 'busy' : 'available';
      return {
        id: u.id, name: u.name, email: u.email,
        role: u.role as StaffRole,
        is_active: u.is_active, active_orders: activeCount,
        last_action_at, status,
      };
    });

    setStaff(mapped);
    setPageLoading(false);
  }

  // ── Dialog helpers ─────────────────────────────────────────────────
  function openAdd() {
    setFormMode('add');
    setEditingId(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('waiter');
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(w: StaffMember) {
    setFormMode('edit');
    setEditingId(w.id);
    setFormName(w.name);
    setFormEmail(w.email ?? '');
    setFormPassword('');
    setFormRole(w.role);
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
          role: formRole,
          restaurantId,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? 'Failed to create staff member.');
        setFormBusy(false);
        return;
      }

      closeDialog();
      fetchStaff();
    } else if (formMode === 'edit' && editingId) {
      const res = await fetch('/api/staff/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingId,
          restaurantId,
          name: formName.trim(),
          email: formEmail.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? 'Failed to update staff member.');
        setFormBusy(false);
        return;
      }

      closeDialog();
      fetchStaff();
    }

    setFormBusy(false);
  }

  async function handleToggleActive(member: StaffMember) {
    // Warn if deactivating a waiter who has active orders
    if (member.is_active && member.active_orders > 0) {
      if (!confirm(`${member.name} has ${member.active_orders} active order(s). Deactivating them won't reassign these orders. Continue?`)) return;
    }
    setBusy(member.id);
    await fetch('/api/staff/toggle-active', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member.id, restaurantId, isActive: !member.is_active }),
    });
    await fetchStaff();
    setBusy(null);
  }

  async function handleDelete(member: StaffMember) {
    if (member.active_orders > 0) {
      alert(`${member.name} has ${member.active_orders} active order(s). Reassign or complete them first.`);
      return;
    }
    if (!confirm(`Remove ${member.name}? This cannot be undone.`)) return;
    setBusy(member.id);
    const res = await fetch('/api/staff/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member.id, restaurantId }),
    });
    if (!res.ok) {
      const json = await res.json();
      alert(json.error ?? 'Failed to delete staff member.');
    }
    await fetchStaff();
    setBusy(null);
  }

  // ── Stats ──────────────────────────────────────────────────────────
  const waiters  = staff.filter(s => s.role === 'waiter');
  const kitchen  = staff.filter(s => s.role === 'kitchen');
  const available = staff.filter(s => s.status === 'available').length;
  const busyCount = staff.filter(s => s.status === 'busy').length;

  function StatusBadge({ status }: { status: StaffMember['status'] }) {
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
          <p className="text-sm text-muted-foreground">Manage waiters and kitchen staff</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Staff
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: staff.length,  color: '' },
          { label: 'Waiters',   value: waiters.length, color: '' },
          { label: 'Kitchen',   value: kitchen.length, color: '' },
          { label: 'Available', value: available,      color: 'text-green-600' },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </Card>
        ))}
      </div>

      {staff.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-muted-foreground">No staff yet.</p>
          <Button className="mt-4" size="sm" onClick={openAdd}>Add your first staff member</Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Waiters section */}
          {waiters.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Waiters ({waiters.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {waiters.map((w) => (
                  <StaffCard
                    key={w.id} member={w} busy={busy === w.id}
                    onEdit={() => openEdit(w)}
                    onToggle={() => handleToggleActive(w)}
                    onDelete={() => handleDelete(w)}
                    StatusBadge={StatusBadge}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Kitchen section */}
          {kitchen.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Kitchen ({kitchen.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {kitchen.map((w) => (
                  <StaffCard
                    key={w.id} member={w} busy={busy === w.id}
                    onEdit={() => openEdit(w)}
                    onToggle={() => handleToggleActive(w)}
                    onDelete={() => handleDelete(w)}
                    StatusBadge={StatusBadge}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Only active staff can log in and take actions. Deactivating won't affect existing orders.
      </p>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{formMode === 'add' ? 'Add Staff Member' : 'Edit Staff Member'}</DialogTitle>
            <DialogDescription>
              {formMode === 'add'
                ? 'Create a new staff account. They can log in at /login.'
                : 'Update staff details.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Role selector — only on add */}
            {formMode === 'add' && (
              <div className="space-y-1.5">
                <Label>Role</Label>
                <div className="flex gap-2">
                  {(['waiter', 'kitchen'] as StaffRole[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setFormRole(r)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-colors ${
                        formRole === r
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {r === 'kitchen' ? '🍳 Kitchen' : '🛎 Waiter'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name *</Label>
              <Input
                id="staff-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Ravi"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email {formMode === 'add' ? '*' : ''}</Label>
              <Input
                id="staff-email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="ravi@restaurant.com"
              />
            </div>

            {formMode === 'add' && (
              <div className="space-y-1.5">
                <Label htmlFor="staff-password">Password *</Label>
                <Input
                  id="staff-password"
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
                <p className="text-xs text-muted-foreground">
                  They'll use this to log in at /login.
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
            <Button onClick={handleSubmit} disabled={formBusy || !formName.trim()}>
              {formBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {formMode === 'add' ? 'Add Staff' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Staff Card ────────────────────────────────────────────────────────────────

function StaffCard({
  member, busy, onEdit, onToggle, onDelete, StatusBadge,
}: {
  member: StaffMember;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  StatusBadge: React.FC<{ status: StaffMember['status'] }>;
}) {
  function fmtLastSeen(iso: string | null) {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  const lastSeen = fmtLastSeen(member.last_action_at);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold">{member.name}</p>
          {member.email && <p className="text-xs text-muted-foreground mt-0.5">{member.email}</p>}
        </div>
        <StatusBadge status={member.status} />
      </div>

      <div className="text-sm space-y-1 mb-4">
        {member.role === 'waiter' && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Active orders</span>
            <span className="font-medium">{member.active_orders}</span>
          </div>
        )}
        {lastSeen && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last active</span>
            <span className="font-medium text-xs">{lastSeen}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={onEdit} disabled={busy}>
          <Edit2 className="h-3.5 w-3.5 mr-1.5" />Edit
        </Button>
        <Button
          size="sm"
          variant={member.is_active ? 'outline' : 'default'}
          className="flex-1"
          onClick={onToggle}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : member.is_active ? (
            <><UserX className="h-3.5 w-3.5 mr-1.5" />Deactivate</>
          ) : (
            <><UserCheck className="h-3.5 w-3.5 mr-1.5" />Activate</>
          )}
        </Button>
        <Button
          size="sm" variant="ghost"
          className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
          onClick={onDelete} disabled={busy} title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}

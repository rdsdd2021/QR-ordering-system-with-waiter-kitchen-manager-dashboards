'use client';

import { useState, useEffect } from 'react';
import { Copy, ExternalLink, Check, QrCode, Download, Printer, Lock } from 'lucide-react';
import QRCode from 'qrcode';
import { getTableAvailability, getFloors, createTable, updateTable, deleteTable, backfillQrCodes } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { getSupabaseClient, supabase } from '@/lib/supabase';
import { useSubscription } from '@/hooks/useSubscription';
import { cn } from '@/lib/utils';

// Fire-and-forget audit log via /api/audit
async function logAudit(
  action: string,
  resourceType: string,
  resourceId?: string | null,
  resourceName?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, resource_type: resourceType, resource_id: resourceId, resource_name: resourceName, metadata }),
    });
  } catch { /* non-blocking */ }
}

type TableStatus = {
  table_id: string;
  restaurant_id: string;
  table_number: number;
  capacity: number | null;
  floor_name: string | null;
  price_multiplier: number | null;
  status: 'free' | 'occupied';
  qr_code_url?: string | null;
};

type Floor = {
  id: string;
  name: string;
  price_multiplier: number;
};

// ── QR Modal ──────────────────────────────────────────────────────────────────

function QrModal({
  open,
  onClose,
  table,
  restaurantName,
}: {
  open: boolean;
  onClose: () => void;
  table: TableStatus;
  restaurantName?: string;
}) {
  const [dataUrl, setDataUrl] = useState<string>('');

  const fullUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/r/${table.restaurant_id}/t/${table.table_id}`
      : `/r/${table.restaurant_id}/t/${table.table_id}`;

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(fullUrl, {
      width: 280,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(setDataUrl);
  }, [open, fullUrl]);

  function handleDownload() {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `table-${table.table_number}-qr.png`;
    a.click();
  }

  function handlePrint() {
    if (!dataUrl) return;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Table ${table.table_number} QR Code</title>
          <style>
            body {
              font-family: sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              box-sizing: border-box;
            }
            .label { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
            .sub { font-size: 14px; color: #666; margin-bottom: 20px; }
            img { width: 280px; height: 280px; }
            .url { font-size: 11px; color: #999; margin-top: 16px; word-break: break-all; max-width: 280px; text-align: center; }
          </style>
        </head>
        <body>
          ${restaurantName ? `<p class="label">${restaurantName}</p>` : ''}
          <p class="sub">Table ${table.table_number}${table.floor_name ? ` · ${table.floor_name}` : ''}</p>
          <img src="${dataUrl}" />
          <p class="url">${fullUrl}</p>
          <script>window.onload = () => { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `);
    win.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Table {table.table_number} — QR Code</DialogTitle>
          <DialogDescription>
            Scan to open the ordering page
            {table.floor_name ? ` · ${table.floor_name}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {/* QR image */}
          <div className="rounded-xl border p-3 bg-white shadow-sm">
            {dataUrl ? (
              <img src={dataUrl} alt={`QR code for Table ${table.table_number}`} width={280} height={280} />
            ) : (
              <div className="w-[280px] h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Generating…
              </div>
            )}
          </div>

          {/* URL */}
          <p className="text-xs text-muted-foreground font-mono text-center break-all px-2">
            {fullUrl}
          </p>

          {/* Actions */}
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={handleDownload} disabled={!dataUrl}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button variant="outline" className="flex-1" onClick={handlePrint} disabled={!dataUrl}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── QR Cell (inline on card) ──────────────────────────────────────────────────

function QrCell({
  tableId,
  restaurantId,
  qrCodeUrl,
  onShowQr,
}: {
  tableId: string;
  restaurantId: string;
  qrCodeUrl?: string | null;
  onShowQr: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const path = qrCodeUrl || `/r/${restaurantId}/t/${tableId}`;
  const fullUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;

  async function handleCopy() {
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-1 mt-3 pt-3 border-t">
      <p className="text-xs text-muted-foreground truncate flex-1 font-mono">{path}</p>

      {/* Show QR image */}
      <button
        onClick={onShowQr}
        title="Show QR code"
        className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
      >
        <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {/* Copy link */}
      <button
        onClick={handleCopy}
        title="Copy link"
        className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Open in new tab */}
      <a
        href={fullUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open table page"
        className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
      >
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
      </a>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TablesManager({ restaurantId, restaurantName }: { restaurantId: string; restaurantName?: string }) {
  const [tables, setTables] = useState<TableStatus[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<TableStatus | null>(null);
  const [qrTable, setQrTable] = useState<TableStatus | null>(null);
  const [formData, setFormData] = useState({ table_number: 1, floor_id: '', capacity: 4 });
  const [loading, setLoading] = useState(false);

  const { limits, isPro } = useSubscription(restaurantId);
  const atLimit = !isPro && tables.length >= limits.max_tables;

  useEffect(() => {
    fetchData();

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`table-availability-updates:${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        fetchTables();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [restaurantId]);

  async function fetchData() {
    await backfillQrCodes(restaurantId);
    const [tablesData, floorsData] = await Promise.all([
      getTableAvailability(restaurantId),
      getFloors(restaurantId),
    ]);
    setTables(tablesData as TableStatus[]);
    setFloors(floorsData as Floor[]);
  }

  async function fetchTables() {
    const data = await getTableAvailability(restaurantId);
    setTables(data as TableStatus[]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingTable) {
        await updateTable(editingTable.table_id, {
          table_number: formData.table_number,
          floor_id: formData.floor_id || null,
          capacity: formData.capacity,
        });
        logAudit('table.updated', 'table', editingTable.table_id, `Table ${formData.table_number}`, {
          table_number: formData.table_number,
          floor_id: formData.floor_id || null,
          capacity: formData.capacity,
        });
      } else {
        const result = await createTable({
          restaurantId,
          tableNumber: formData.table_number,
          floorId: formData.floor_id || undefined,
          capacity: formData.capacity,
        });
        logAudit('table.created', 'table', (result as any)?.id ?? null, `Table ${formData.table_number}`, {
          table_number: formData.table_number,
          floor_id: formData.floor_id || null,
          capacity: formData.capacity,
        });
      }
      setIsDialogOpen(false);
      setEditingTable(null);
      setFormData({ table_number: 1, floor_id: '', capacity: 4 });
      fetchData();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(tableId: string) {
    if (confirm('Delete this table? This cannot be undone.')) {
      const tableToDelete = tables.find(t => t.table_id === tableId);
      await deleteTable(tableId);
      logAudit('table.deleted', 'table', tableId, tableToDelete ? `Table ${tableToDelete.table_number}` : null, {
        table_number: tableToDelete?.table_number ?? null,
      });
      fetchData();
    }
  }

  function openDialog(table?: TableStatus) {
    if (table) {
      setEditingTable(table);
      // Use floor_id directly from the table record — don't match by name
      const floorId = (table as any).floor_id ?? floors.find((f) => f.name === table.floor_name)?.id ?? "";
      setFormData({
        table_number: table.table_number,
        floor_id: floorId,
        capacity: table.capacity || 4,
      });
    } else {
      setEditingTable(null);
      setFormData({ table_number: tables.length + 1, floor_id: '', capacity: 4 });
    }
    setIsDialogOpen(true);
  }

  const freeTables = tables.filter((t) => t.status === 'free').length;
  const occupiedTables = tables.filter((t) => t.status === 'occupied').length;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold">Table Setup</h2>
          <p className="text-sm text-muted-foreground">
            Manage tables and view real-time availability
            {!isPro && (
              <span className={cn("ml-1.5", atLimit ? "text-destructive font-medium" : "text-muted-foreground")}>
                · {tables.length}/{limits.max_tables} free limit
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={() => openDialog()}
          disabled={atLimit}
          title={atLimit ? `Trial limit reached (${limits.max_tables} tables). Upgrade to Pro for unlimited tables.` : undefined}
        >
          {atLimit ? <><Lock className="h-4 w-4 mr-2" />Limit Reached</> : 'Add Table'}
        </Button>
      </div>

      {atLimit && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2 mb-6">
          <Lock className="h-4 w-4 shrink-0" />
          Your trial is limited to {limits.max_tables} tables. Upgrade to Pro for unlimited tables.
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Tables</p>
          <p className="text-3xl font-bold mt-1">{tables.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Free Tables</p>
          <p className="text-3xl font-bold mt-1 text-green-600">{freeTables}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Occupied Tables</p>
          <p className="text-3xl font-bold mt-1 text-red-600">{occupiedTables}</p>
        </Card>
      </div>

      {/* Tables Grid */}
      {tables.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No tables created yet</p>
          <Button className="mt-4" onClick={() => openDialog()} disabled={atLimit}>
            Create First Table
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((table) => (
            <Card key={table.table_id} className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-lg">Table {table.table_number}</h3>
                  {table.floor_name && (
                    <p className="text-sm text-muted-foreground">{table.floor_name}</p>
                  )}
                </div>
                <Badge variant={table.status === 'free' ? 'default' : 'destructive'}>
                  {table.status}
                </Badge>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capacity:</span>
                  <span className="font-medium">{table.capacity || 4} seats</span>
                </div>
                {table.price_multiplier && table.price_multiplier !== 1.0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Floor premium:</span>
                    <span className="font-medium">
                      +{((table.price_multiplier - 1) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>

              <QrCell
                tableId={table.table_id}
                restaurantId={table.restaurant_id || restaurantId}
                qrCodeUrl={table.qr_code_url}
                onShowQr={() => setQrTable(table)}
              />

              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => openDialog(table)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleDelete(table.table_id)}
                  disabled={table.status === 'occupied'}
                  title={table.status === 'occupied' ? 'Cannot delete an occupied table' : undefined}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTable ? 'Edit Table' : 'Add Table'}</DialogTitle>
            <DialogDescription>
              {editingTable
                ? 'Update table details and floor assignment'
                : 'Create a new table — a QR code will be generated automatically'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="table_number">Table Number</Label>
              <Input
                id="table_number"
                type="number"
                min="1"
                value={formData.table_number}
                onChange={(e) => setFormData({ ...formData, table_number: parseInt(e.target.value) })}
                required
              />
            </div>
            <div>
              <Label htmlFor="floor_id">Floor (Optional)</Label>
              <select
                id="floor_id"
                value={formData.floor_id}
                onChange={(e) => setFormData({ ...formData, floor_id: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">No floor (normal pricing)</option>
                {floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.name} ({floor.price_multiplier}x)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="capacity">Seating Capacity</Label>
              <Input
                id="capacity"
                type="number"
                min="1"
                max="20"
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR Code Modal */}
      {qrTable && (
        <QrModal
          open={!!qrTable}
          onClose={() => setQrTable(null)}
          table={qrTable}
          restaurantName={restaurantName}
        />
      )}
    </div>
  );
}

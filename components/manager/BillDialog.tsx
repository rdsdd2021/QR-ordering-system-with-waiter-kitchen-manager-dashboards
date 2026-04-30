"use client";

/**
 * BillDialog
 *
 * Modal shown before generating a bill for a table session.
 * Lets the manager:
 *  - Review all items and the gross total
 *  - Apply an optional manual discount (flat ₹ amount)
 *  - Select payment method (Cash / Card / UPI)
 *  - Print the receipt after billing
 */

import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Printer, Receipt, Banknote, CreditCard, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateBill, billTable } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type OrderItem = { id: string; name: string; quantity: number; price: number };

type OrderRow = {
  id: string;
  status: string;
  created_at: string;
  billed_at: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  party_size: number | null;
  order_total: number;
  items: OrderItem[];
};

type TableSession = {
  table_id: string;
  table_number: number;
  floor_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  party_size: number | null;
  waiter_name: string | null;
  orders: OrderRow[];
  session_total: number;
  session_start: string;
  all_served: boolean;
  is_billed: boolean;
};

type PaymentMethod = "cash" | "card" | "upi";

type Props = {
  session: TableSession;
  open: boolean;
  onClose: () => void;
  onBilled: () => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { value: "cash",  label: "Cash",  icon: Banknote    },
  { value: "card",  label: "Card",  icon: CreditCard  },
  { value: "upi",   label: "UPI",   icon: Smartphone  },
];

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BillDialog({ session, open, onClose, onBilled }: Props) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [discountRaw, setDiscountRaw]     = useState("");
  const [discountNote, setDiscountNote]   = useState("");
  const [loading, setLoading]             = useState(false);
  const [billed, setBilled]               = useState(false);
  const [billedAt, setBilledAt]           = useState<string | null>(null);
  const [netAmount, setNetAmount]         = useState<number | null>(null);
  // D1: manager override — bill orders that aren't yet marked served
  const [forceOverride, setForceOverride] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // D1: include non-served, non-cancelled, unbilled orders when force is on
  const servableOrders = session.orders.filter((o) =>
    !o.billed_at && (
      o.status === "served" ||
      (forceOverride && !["cancelled"].includes(o.status))
    )
  );
  const nonServedCount = session.orders.filter(
    (o) => !o.billed_at && o.status !== "served" && o.status !== "cancelled"
  ).length;

  const grossTotal  = servableOrders.reduce((s, o) => s + o.order_total, 0);
  const discount    = Math.min(parseFloat(discountRaw) || 0, grossTotal);
  const net         = grossTotal - discount;

  // All items flattened for receipt
  const allItems = servableOrders.flatMap((o) => o.items);
  const itemMap  = new Map<string, { name: string; quantity: number; price: number }>();
  for (const item of allItems) {
    const key = `${item.name}_${item.price}`;
    if (itemMap.has(key)) {
      itemMap.get(key)!.quantity += item.quantity;
    } else {
      itemMap.set(key, { name: item.name, quantity: item.quantity, price: item.price });
    }
  }
  const receiptItems = [...itemMap.values()];

  async function handleBill() {
    if (servableOrders.length === 0) return;
    setLoading(true);

    // D4: single atomic RPC — bills all orders in one transaction
    const result = await billTable(session.table_id, {
      paymentMethod,
      discountAmount: discount,
      discountNote:   discountNote || undefined,
      force:          forceOverride,
    });

    setLoading(false);

    if (!result.success) {
      alert(result.error ?? "Could not generate bill. Please try again.");
      return;
    }

    setBilledAt(new Date().toISOString());
    setNetAmount(result.netTotal ?? net);
    setBilled(true);
    onBilled();
  }

  function handlePrint() {
    if (!printRef.current) return;
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;
    win.document.write(`
      <html><head><title>Receipt - Table ${session.table_number}</title>
      <style>
        body { font-family: monospace; font-size: 13px; padding: 16px; max-width: 320px; margin: 0 auto; }
        h2 { text-align: center; margin: 0 0 4px; font-size: 16px; }
        .sub { text-align: center; color: #555; margin-bottom: 12px; font-size: 11px; }
        hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
        .row { display: flex; justify-content: space-between; margin: 3px 0; }
        .total { font-weight: bold; font-size: 15px; }
        .discount { color: #c00; }
        .footer { text-align: center; margin-top: 12px; font-size: 11px; color: #777; }
      </style></head><body>
      ${printRef.current.innerHTML}
      </body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  function handleClose() {
    if (!loading) {
      setBilled(false);
      setBilledAt(null);
      setNetAmount(null);
      setDiscountRaw("");
      setDiscountNote("");
      setPaymentMethod("cash");
      setForceOverride(false);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            {billed ? "Bill Generated" : `Bill — Table ${session.table_number}`}
          </DialogTitle>
        </DialogHeader>

        {/* ── Receipt (shown after billing) ─────────────────────── */}
        {billed ? (
          <div className="space-y-4">
            <div ref={printRef} className="rounded-lg border p-4 font-mono text-sm space-y-2">
              <h2 className="text-center font-bold text-base">Receipt</h2>
              <p className="text-center text-xs text-muted-foreground">
                Table {session.table_number}
                {session.floor_name ? ` · ${session.floor_name}` : ""}
                {billedAt ? ` · ${fmtDate(billedAt)}` : ""}
              </p>
              {session.customer_name && (
                <p className="text-center text-xs text-muted-foreground">
                  {session.customer_name}
                  {session.customer_phone ? ` · ${session.customer_phone}` : ""}
                </p>
              )}
              <hr className="border-dashed" />
              {receiptItems.map((item, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{item.quantity}× {item.name}</span>
                  <span>₹{(item.quantity * item.price).toFixed(2)}</span>
                </div>
              ))}
              <hr className="border-dashed" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal</span>
                <span>₹{grossTotal.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-xs text-red-600">
                  <span>Discount{discountNote ? ` (${discountNote})` : ""}</span>
                  <span>−₹{discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>₹{(netAmount ?? net).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Payment</span>
                <span className="capitalize">{paymentMethod}</span>
              </div>
              <p className="text-center text-xs text-muted-foreground pt-2">
                Thank you for dining with us!
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
              <Button onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print Receipt
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── Pre-billing form ─────────────────────────────────── */
          <div className="space-y-5">
            {/* Items summary */}
            <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
              {receiptItems.map((item, i) => (
                <div key={i} className="flex justify-between px-3 py-2 text-sm">
                  <span>{item.quantity}× {item.name}</span>
                  <span className="font-medium">₹{(item.quantity * item.price).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Discount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="discount">Discount (₹)</Label>
                <Input
                  id="discount"
                  type="number"
                  min="0"
                  max={grossTotal}
                  step="0.01"
                  placeholder="0.00"
                  value={discountRaw}
                  onChange={(e) => setDiscountRaw(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="discount-note">Reason (optional)</Label>
                <Input
                  id="discount-note"
                  placeholder="e.g. loyalty"
                  value={discountNote}
                  onChange={(e) => setDiscountNote(e.target.value)}
                />
              </div>
            </div>

            {/* D1: Manager override — bill non-served orders */}
            {nonServedCount > 0 && (
              <label className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceOverride}
                  onChange={(e) => setForceOverride(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-400 accent-amber-600 cursor-pointer"
                />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Manager override — bill {nonServedCount} unserved order{nonServedCount !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    These orders will be marked as served automatically before billing.
                    Use this when a customer leaves before the waiter marks the order served.
                  </p>
                </div>
              </label>
            )}

            {/* Payment method */}
            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <div className="flex gap-2">
                {PAYMENT_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setPaymentMethod(value)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-lg border py-3 text-xs font-medium transition-colors",
                      paymentMethod === value
                        ? "border-primary bg-primary/5 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="rounded-lg bg-muted/50 px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>₹{grossTotal.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Discount</span>
                  <span>−₹{discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>₹{net.toFixed(2)}</span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleBill} disabled={loading || servableOrders.length === 0}>
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Billing…</>
                ) : (
                  <><Receipt className="h-4 w-4 mr-2" />Generate Bill</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

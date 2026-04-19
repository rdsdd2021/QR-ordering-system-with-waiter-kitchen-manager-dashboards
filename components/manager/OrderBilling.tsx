"use client";

import { useEffect, useState, Fragment, useRef } from "react";
import { Loader2, Receipt, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getUnbilledOrders, getBilledOrders, generateBill } from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";
import type { BillingOrder } from "@/types/database";
import { cn } from "@/lib/utils";

type Props = {
  restaurantId: string;
};

export default function OrderBilling({ restaurantId }: Props) {
  const [unbilledOrders, setUnbilledOrders] = useState<BillingOrder[]>([]);
  const [billedOrders, setBilledOrders] = useState<BillingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingOrderId, setBillingOrderId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>["channel"]> | null>(null);
  const loadRef = useRef<() => Promise<void>>(undefined);

  async function loadOrders() {
    setLoading(true);
    const [unbilled, billed] = await Promise.all([
      getUnbilledOrders(restaurantId),
      getBilledOrders(restaurantId, 20),
    ]);
    setUnbilledOrders(unbilled);
    setBilledOrders(billed);
    setLoading(false);
  }

  loadRef.current = loadOrders;

  useEffect(() => {
    loadRef.current?.();
  }, [restaurantId]);

  // Real-time: re-fetch whenever any order changes
  useEffect(() => {
    const client = getSupabaseClient();

    if (channelRef.current) {
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = client
      .channel(`manager:${restaurantId}`)
      .on("broadcast", { event: "order_changed" }, () => { loadRef.current?.(); })
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
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

  async function handleGenerateBill(orderId: string) {
    setBillingOrderId(orderId);

    const result = await generateBill(orderId);

    if (result.success) {
      const billedOrder = unbilledOrders.find((o) => o.id === orderId);
      if (billedOrder) {
        setUnbilledOrders((prev) => prev.filter((o) => o.id !== orderId));
        setBilledOrders((prev) => [
          { ...billedOrder, total_amount: result.total || 0, billed_at: new Date().toISOString() },
          ...prev,
        ]);
      }
    } else {
      alert(`Failed to generate bill: ${result.error}`);
    }

    setBillingOrderId(null);
  }

  function calculateOrderTotal(order: BillingOrder): number {
    return order.order_items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );
  }

  function toggleOrderExpanded(orderId: string) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
      {/* Pending Bills */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Pending Bills</h2>
            <p className="text-sm text-muted-foreground">
              {unbilledOrders.length} {unbilledOrders.length === 1 ? "order" : "orders"}
            </p>
          </div>
        </div>

        {unbilledOrders.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed">
            <p className="text-sm text-muted-foreground">No pending bills</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Waiter</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-[140px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unbilledOrders.map((order) => {
                  const total = calculateOrderTotal(order);
                  const isBilling = billingOrderId === order.id;
                  const isExpanded = expandedOrders.has(order.id);

                  return (
                    <Fragment key={order.id}>
                      <TableRow className={cn(isExpanded && "bg-muted/50")}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleOrderExpanded(order.id)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">
                          Table {order.table.table_number}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatTime(order.created_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.waiter?.name || "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ₹{total.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            onClick={() => handleGenerateBill(order.id)}
                            disabled={isBilling}
                            size="sm"
                          >
                            {isBilling ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Billing...
                              </>
                            ) : (
                              <>
                                <Receipt className="mr-2 h-4 w-4" />
                                Generate Bill
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 p-4">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-muted-foreground">
                                Order Items
                              </p>
                              {order.order_items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex justify-between text-sm"
                                >
                                  <span>
                                    {item.quantity}× {item.menu_item.name}
                                  </span>
                                  <span className="font-medium">
                                    ₹{(item.quantity * item.price).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Completed Orders */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Completed Orders</h2>
            <p className="text-sm text-muted-foreground">
              Recently billed orders
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted ? "Hide" : "Show"} ({billedOrders.length})
          </Button>
        </div>

        {showCompleted && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Billed At</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billedOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      No completed orders yet
                    </TableCell>
                  </TableRow>
                ) : (
                  billedOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        Table {order.table.table_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {order.billed_at && formatDate(order.billed_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {order.order_items.length} {order.order_items.length === 1 ? "item" : "items"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        ₹{order.total_amount.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

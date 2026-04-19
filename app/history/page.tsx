"use client";

import { useState } from "react";
import { Search, Loader2, Clock, User, Receipt, ChevronDown, ChevronUp, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CustomerOrderSession } from "@/types/database";

export default function CustomerHistoryPage() {
  const [phone, setPhone]       = useState("");
  const [sessions, setSessions] = useState<CustomerOrderSession[]>([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function handleSearch() {
    if (!phone.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res  = await fetch(`/api/customer/history?phone=${encodeURIComponent(phone.trim())}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to fetch history"); setSessions([]); }
      else setSessions(data.sessions || []);
    } catch { setError("Failed to fetch order history"); setSessions([]); }
    finally { setLoading(false); }
  }

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-4 h-14 flex items-center gap-3">
          <History className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">Order History</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        {/* Search */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Enter your phone number to view past orders</p>
          <div className="flex gap-2">
            <Input
              type="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              className="h-10 flex-1"
            />
            <Button onClick={handleSearch} disabled={loading || !phone.trim()} className="h-10 px-4">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Empty pre-search */}
        {!searched && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-muted/40">
              <Receipt className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium text-sm">Your order history</p>
            <p className="text-xs text-muted-foreground mt-1">Search by phone number to see past visits</p>
          </div>
        )}

        {/* Error / empty */}
        {searched && !loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">{error || "No orders found for this number."}</p>
          </div>
        )}

        {/* Results */}
        {sessions.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {sessions.length} dining session{sessions.length !== 1 ? "s" : ""} found
            </p>

            {sessions.map(session => {
              const isOpen = expanded.has(session.session_id);
              const totalItems = session.orders.reduce(
                (s: number, o: any) => s + o.items.reduce((a: number, i: any) => a + i.quantity, 0), 0
              );

              return (
                <div key={session.session_id} className="rounded-xl border bg-card overflow-hidden">
                  {/* Session row */}
                  <button
                    className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                    onClick={() => toggle(session.session_id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{session.restaurant_name}</span>
                          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                            Table {session.table_number}{session.floor_name ? ` · ${session.floor_name}` : ""}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {fmtDate(session.session_start)} · {fmtTime(session.session_start)}
                          </span>
                          {session.waiter_name && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {session.waiter_name}
                            </span>
                          )}
                          <span>{session.orders.length} order{session.orders.length !== 1 ? "s" : ""} · {totalItems} items</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="font-bold tabular-nums">₹{session.total_amount.toFixed(0)}</span>
                        {isOpen
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                  </button>

                  {/* Expanded orders */}
                  {isOpen && (
                    <div className="border-t divide-y bg-muted/20">
                      {session.orders.map((order: any) => (
                        <div key={order.id} className="px-4 py-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-medium text-muted-foreground">
                              #{order.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span className="text-xs text-muted-foreground">{fmtTime(order.created_at)}</span>
                          </div>
                          <div className="space-y-1">
                            {order.items.map((item: any, i: number) => (
                              <div key={i} className="flex justify-between text-sm">
                                <span className="text-muted-foreground">{item.quantity}× {item.name}</span>
                                <span className="font-medium tabular-nums">₹{(item.quantity * item.price).toFixed(0)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

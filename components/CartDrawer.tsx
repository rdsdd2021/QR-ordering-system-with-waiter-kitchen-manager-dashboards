"use client";

import { useState, useRef, useEffect } from "react";
import { CheckCircle2, Loader2, ShoppingBag, ArrowLeft, User, Phone, Users, ChevronUp, ChevronDown, Trash2, Minus, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPerformanceMetrics } from "@/lib/api";
import type { CartItem } from "@/types/database";
import type { CustomerInfo } from "@/hooks/useCustomerSession";
import { cn } from "@/lib/utils";

type Props = {
  cartItems: CartItem[];
  totalPrice: number;
  restaurantId: string;
  tableId: string;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onOrderSuccess: () => void;   // called after success delay — switches to orders tab
  onClearCart: () => void;      // called immediately on success — clears cart items
  savedCustomerInfo: CustomerInfo | null;
  onSaveCustomerInfo: (info: CustomerInfo) => void;
};

type Step = "cart" | "info" | "loading" | "success" | "error" | "occupied";

function fmt(n: number) {
  return n % 1 === 0 ? `₹${n}` : `₹${n.toFixed(2)}`;
}

export default function CartDrawer({
  cartItems,
  totalPrice,
  restaurantId,
  tableId,
  onUpdateQuantity,
  onOrderSuccess,
  onClearCart,
  savedCustomerInfo,
  onSaveCustomerInfo,
}: Props) {
  const [step, setStep]         = useState<Step>("cart");
  const [expanded, setExpanded] = useState(false);
  const [orderId, setOrderId]   = useState<string | null>(null);
  const [waitMins, setWaitMins] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("Something went wrong. Please try again.");

  const [name, setName]           = useState(savedCustomerInfo?.name ?? "");
  const [phone, setPhone]         = useState(savedCustomerInfo?.phone ?? "");
  const [partySize, setPartySize] = useState(savedCustomerInfo?.partySize?.toString() ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const itemCount = cartItems.reduce((s, i) => s + i.quantity, 0);

  async function submitOrder(info: CustomerInfo) {
    setStep("loading");

    // G5: Route through /api/orders which enforces server-side rate limiting
    let id: string | "UNPAID_ORDERS_EXIST" | null = null;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          tableId,
          items: cartItems.map(i => ({ menu_item_id: i.id, quantity: i.quantity, price: i.price })),
          customerName: info.name,
          customerPhone: info.phone,
          partySize: info.partySize,
        }),
      });

      if (res.status === 429) {
        setErrorMsg("Too many orders placed. Please wait a moment before trying again.");
        setStep("error");
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        id = null;
      } else {
        id = data.result ?? null;
      }
    } catch {
      id = null;
    }

    if (id && id !== "UNPAID_ORDERS_EXIST") {
      onSaveCustomerInfo(info);
      setOrderId(id);
      // Fetch avg turnaround to show estimated wait
      getPerformanceMetrics(restaurantId).then((m) => {
        if (m.avgTurnaroundSeconds && m.avgTurnaroundSeconds > 0) {
          setWaitMins(Math.ceil(m.avgTurnaroundSeconds / 60));
        }
      });
      setStep("success");
      setExpanded(false);
      onClearCart(); // clear cart immediately — don't wait for the success screen to dismiss
      setTimeout(() => { onOrderSuccess(); setStep("cart"); }, 4000);
    } else if (id === "UNPAID_ORDERS_EXIST") {
      setStep("occupied");
    } else {
      setStep("error");
    }
  }

  function handleProceed() {
    if (!cartItems.length) return;
    if (savedCustomerInfo) {
      submitOrder(savedCustomerInfo);
    } else {
      setName(""); setPhone(""); setPartySize("");
      setStep("info");
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }

  async function handleInfoSubmit() {
    setFieldError(null);
    if (!name.trim()) { setFieldError("Please enter your name."); nameRef.current?.focus(); return; }
    if (!phone.trim()) { setFieldError("Please enter your phone number."); return; }
    if (!/^\+?[\d\s\-()]{7,15}$/.test(phone.trim())) { setFieldError("Please enter a valid phone number."); return; }
    // B6: validate party_size when provided
    if (partySize !== "") {
      const parsed = parseInt(partySize, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 50) {
        setFieldError("Number of guests must be between 1 and 50.");
        return;
      }
    }
    await submitOrder({ name: name.trim(), phone: phone.trim(), partySize: partySize ? parseInt(partySize, 10) : undefined });
  }

  // ── Success ──────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="bg-card border-t px-4 py-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary">
          <CheckCircle2 className="h-7 w-7 text-primary-foreground" />
        </div>
        <p className="font-bold text-base">Order placed!</p>
        <p className="mt-1 text-xs text-muted-foreground">Track it in My Orders</p>
        {orderId && <p className="mt-2 font-mono text-[11px] bg-muted rounded-lg px-3 py-1.5 inline-block text-muted-foreground">#{orderId.slice(0, 8).toUpperCase()}</p>}
        {waitMins && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            Estimated wait: ~{waitMins} min{waitMins !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (step === "loading") {
    return (
      <div className="bg-card border-t px-4 py-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
        <p className="text-sm font-medium">Placing your order…</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Just a moment</p>
      </div>
    );
  }

  // ── Occupied ─────────────────────────────────────────────────────────
  if (step === "occupied") {
    return (
      <div className="bg-card border-t px-4 py-4 space-y-3">
        <p className="text-sm font-medium text-center">Table has an active order</p>
        <p className="text-xs text-muted-foreground text-center">This table already has an unpaid order from another customer. Please ask your waiter to clear the table first.</p>
        <Button className="w-full" variant="outline" onClick={() => setStep("cart")}>Back to menu</Button>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (step === "error") {
    // Check if this was a rate limit error by inspecting the last response
    const isRateLimit = (step as string) === "error" && false; // handled below via errorMsg
    return (
      <div className="bg-card border-t px-4 py-4 space-y-3">
        <p className="text-sm text-destructive text-center">{errorMsg}</p>
        <Button className="w-full" onClick={() => setStep("cart")}>Back to cart</Button>
      </div>
    );
  }

  // ── Info form ────────────────────────────────────────────────────────
  if (step === "info") {
    return (
      <div className="bg-card border-t">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <button onClick={() => { setStep("cart"); setFieldError(null); }} className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="font-semibold text-sm">Your details</p>
          <div className="ml-auto text-xs text-muted-foreground">{itemCount} item{itemCount !== 1 ? "s" : ""} · <span className="font-semibold text-foreground">{fmt(totalPrice)}</span></div>
        </div>

        <div className="h-px bg-border" />

        <div className="px-4 py-4 space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="customer-name" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <User className="h-3 w-3" /> Name <span className="text-destructive">*</span>
            </Label>
            <Input id="customer-name" ref={nameRef} value={name} onChange={e => setName(e.target.value)}
              placeholder="Your name" autoComplete="name" className="h-10" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-phone" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Phone className="h-3 w-3" /> Phone <span className="text-destructive">*</span>
            </Label>
            <Input id="customer-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="+91 98765 43210" autoComplete="tel" className="h-10" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="party-size" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Guests <span className="text-[10px] font-normal">(optional)</span>
            </Label>
            <Input
              id="party-size"
              type="number"
              min="1"
              max="50"
              value={partySize}
              onChange={e => {
                const v = e.target.value;
                // Allow empty (clearing the field) or digits only, max 2 chars
                if (v === "" || (/^\d{1,2}$/.test(v) && parseInt(v, 10) <= 50)) {
                  setPartySize(v);
                }
              }}
              placeholder="2"
              className="h-10 w-24"
            />
          </div>

          {fieldError && (
            <p className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs text-destructive">{fieldError}</p>
          )}

          <Button className="w-full h-11 font-semibold text-sm" onClick={handleInfoSubmit}>
            Confirm order
          </Button>
        </div>
      </div>
    );
  }

  // ── Cart ─────────────────────────────────────────────────────────────
  return (
    <div className="bg-card border-t">
      {/* Expanded item list */}
      {expanded && (
        <div className="max-h-56 overflow-y-auto overscroll-contain divide-y divide-border/60">
          {cartItems.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <p className="flex-1 min-w-0 text-sm font-medium truncate">{item.name}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="icon"
                  className={cn("h-6 w-6", item.quantity === 1 && "text-destructive hover:text-destructive")}
                  onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                  aria-label={item.quantity === 1 ? `Remove ${item.name}` : `Decrease ${item.name}`}
                >
                  {item.quantity === 1 ? <Trash2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                </Button>
                <span className="w-5 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  aria-label={`Increase ${item.name}`}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <p className="w-14 text-right text-sm font-bold tabular-nums shrink-0 text-primary">{fmt(item.price * item.quantity)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle expand */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold shrink-0 hover:opacity-80 transition-opacity"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
            {itemCount}
          </span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>

        {savedCustomerInfo && (
          <p className="text-xs text-muted-foreground truncate hidden sm:block">
            {savedCustomerInfo.name}
          </p>
        )}

        <div className="flex-1" />

        <span className="text-sm font-bold tabular-nums">{fmt(totalPrice)}</span>

        <Button onClick={handleProceed} className="h-10 px-5 font-bold text-sm shrink-0">
          Place order
        </Button>
      </div>
    </div>
  );
}

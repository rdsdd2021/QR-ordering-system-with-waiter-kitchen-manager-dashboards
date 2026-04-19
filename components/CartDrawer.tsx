"use client";

import { useState, useRef } from "react";
import { CheckCircle2, Loader2, ShoppingBag, ArrowLeft, User, Phone, Users, ChevronUp, ChevronDown, Trash2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeOrder } from "@/lib/api";
import type { CartItem } from "@/types/database";
import type { CustomerInfo } from "@/hooks/useCustomerSession";
import { cn } from "@/lib/utils";

type Props = {
  cartItems: CartItem[];
  totalPrice: number;
  restaurantId: string;
  tableId: string;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onOrderSuccess: () => void;
  savedCustomerInfo: CustomerInfo | null;
  onSaveCustomerInfo: (info: CustomerInfo) => void;
};

type Step = "cart" | "info" | "loading" | "success" | "error";

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
  savedCustomerInfo,
  onSaveCustomerInfo,
}: Props) {
  const [step, setStep]       = useState<Step>("cart");
  const [expanded, setExpanded] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  const [name, setName]           = useState(savedCustomerInfo?.name ?? "");
  const [phone, setPhone]         = useState(savedCustomerInfo?.phone ?? "");
  const [partySize, setPartySize] = useState(savedCustomerInfo?.partySize?.toString() ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const itemCount = cartItems.reduce((s, i) => s + i.quantity, 0);

  async function submitOrder(info: CustomerInfo) {
    setStep("loading");
    const id = await placeOrder({
      restaurantId, tableId,
      items: cartItems.map(i => ({ menu_item_id: i.id, quantity: i.quantity, price: i.price })),
      customerName: info.name,
      customerPhone: info.phone,
      partySize: info.partySize,
    });

    if (id && id !== "UNPAID_ORDERS_EXIST") {
      onSaveCustomerInfo(info);
      setOrderId(id);
      setStep("success");
      setExpanded(false);
      setTimeout(() => { onOrderSuccess(); setStep("cart"); }, 2500);
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
    await submitOrder({ name: name.trim(), phone: phone.trim(), partySize: partySize ? parseInt(partySize) : undefined });
  }

  // ── Success ──────────────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="bg-card border-t px-4 py-5 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-6 w-6 text-green-600" />
        </div>
        <p className="font-semibold text-sm">Order placed!</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Track it in My Orders</p>
        {orderId && <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">#{orderId.slice(0, 8).toUpperCase()}</p>}
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (step === "loading") {
    return (
      <div className="bg-card border-t px-4 py-5 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        <p className="mt-2 text-xs text-muted-foreground">Placing your order…</p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (step === "error") {
    return (
      <div className="bg-card border-t px-4 py-4 space-y-3">
        <p className="text-sm text-destructive text-center">Something went wrong. Please try again.</p>
        <Button className="w-full h-10" onClick={() => setStep("cart")}>Back to cart</Button>
      </div>
    );
  }

  // ── Info form ────────────────────────────────────────────────────────
  if (step === "info") {
    return (
      <div className="bg-card border-t">
        {/* Handle */}
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
            <Input id="party-size" type="number" min="1" max="50" value={partySize}
              onChange={e => setPartySize(e.target.value)} placeholder="2" className="h-10 w-24" />
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
  // Collapsed: single bar showing total + place order button
  // Expanded: shows item list above the bar
  return (
    <div className="bg-card border-t shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      {/* Expanded item list */}
      {expanded && (
        <div className="max-h-56 overflow-y-auto overscroll-contain divide-y divide-border/60">
          {cartItems.map(item => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <p className="flex-1 min-w-0 text-sm font-medium truncate">{item.name}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
                >
                  {item.quantity === 1 ? <Trash2 className="h-3 w-3 text-destructive" /> : <Minus className="h-3 w-3" />}
                </button>
                <span className="w-5 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
                <button
                  onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <p className="w-14 text-right text-sm font-semibold tabular-nums shrink-0">{fmt(item.price * item.quantity)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle expand */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold shrink-0"
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

        <Button
          className="h-9 px-5 font-semibold text-sm rounded-xl shrink-0"
          onClick={handleProceed}
        >
          Place order
        </Button>
      </div>
    </div>
  );
}

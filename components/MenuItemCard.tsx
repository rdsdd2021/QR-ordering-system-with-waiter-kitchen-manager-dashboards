"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/types/database";

type Props = {
  item: MenuItem;
  onAddToCart: (item: MenuItem) => void;
  onDecrement: (itemId: string, currentQty: number) => void;
  quantity?: number;
  priceMultiplier?: number;
  disabled?: boolean;
};

const TAG_STYLES: Record<string, string> = {
  veg:        "text-emerald-700 bg-emerald-100 border border-emerald-200",
  vegetarian: "text-emerald-700 bg-emerald-100 border border-emerald-200",
  non_veg:    "text-rose-600 bg-rose-100 border border-rose-200",
  "non-veg":  "text-rose-600 bg-rose-100 border border-rose-200",
  nonveg:     "text-rose-600 bg-rose-100 border border-rose-200",
  spicy:      "text-orange-600 bg-orange-100 border border-orange-200",
  bestseller: "text-amber-700 bg-amber-100 border border-amber-200",
  popular:    "text-amber-700 bg-amber-100 border border-amber-200",
  healthy:    "text-teal-700 bg-teal-100 border border-teal-200",
  dessert:    "text-pink-600 bg-pink-100 border border-pink-200",
  beverage:   "text-blue-600 bg-blue-100 border border-blue-200",
  new:        "text-violet-600 bg-violet-100 border border-violet-200",
};

function tagStyle(tag: string) {
  return TAG_STYLES[tag.toLowerCase()] ?? "text-muted-foreground bg-muted border border-border";
}

function fmt(n: number) {
  return n % 1 === 0 ? `₹${n}` : `₹${n.toFixed(2)}`;
}

export default function MenuItemCard({
  item,
  onAddToCart,
  onDecrement,
  quantity = 0,
  priceMultiplier = 1.0,
  disabled = false,
}: Props) {
  const finalPrice = item.price * priceMultiplier;
  const inCart = quantity > 0;
  const [popping, setPopping] = useState(false);

  function handleAdd() {
    onAddToCart(item);
    setPopping(true);
    setTimeout(() => setPopping(false), 350);
  }

  return (
    <div className={cn(
      "flex gap-3 rounded-2xl bg-card p-3.5 transition-all duration-200 cursor-default",
      "hover:shadow-lg hover:-translate-y-0.5",
      inCart
        ? "ring-2 ring-primary/60 shadow-md shadow-primary/10 bg-primary/[0.03]"
        : "border border-border/70 hover:border-primary/30",
      disabled && "opacity-50 pointer-events-none",
    )}>
      {/* Image */}
      {item.image_url && (
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover transition-transform duration-300 hover:scale-105" loading="lazy" />
        </div>
      )}

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
        <div className="space-y-1">
          <p className="font-semibold text-sm leading-snug">{item.name}</p>

          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map(tag => (
                <span key={tag} className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", tagStyle(tag))}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {item.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{item.description}</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-primary">{fmt(finalPrice)}</p>

          {/* Stepper / Add */}
          {inCart ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDecrement(item.id, quantity)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-rose-600 hover:bg-rose-200 active:scale-90 transition-all duration-150"
                aria-label={`Remove ${item.name}`}
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className={cn("w-5 text-center text-sm font-bold tabular-nums", popping && "animate-pop")}>
                {quantity}
              </span>
              <button
                onClick={handleAdd}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85 hover:shadow-md hover:shadow-primary/30 active:scale-90 transition-all duration-150"
                aria-label={`Add ${item.name}`}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAdd}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/50 text-primary",
                "hover:bg-primary hover:text-primary-foreground hover:border-primary hover:shadow-md hover:shadow-primary/30 hover:scale-110",
                "active:scale-90 transition-all duration-150",
                popping && "animate-pop",
              )}
              aria-label={`Add ${item.name} to cart`}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

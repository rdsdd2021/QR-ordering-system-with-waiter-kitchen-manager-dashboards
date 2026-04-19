"use client";

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
  veg:        "text-green-700 bg-green-50",
  vegetarian: "text-green-700 bg-green-50",
  non_veg:    "text-red-600 bg-red-50",
  "non-veg":  "text-red-600 bg-red-50",
  nonveg:     "text-red-600 bg-red-50",
  spicy:      "text-orange-600 bg-orange-50",
  bestseller: "text-amber-700 bg-amber-50",
  popular:    "text-amber-700 bg-amber-50",
  healthy:    "text-teal-700 bg-teal-50",
  dessert:    "text-pink-600 bg-pink-50",
  beverage:   "text-blue-600 bg-blue-50",
};

function tagStyle(tag: string) {
  return TAG_STYLES[tag.toLowerCase()] ?? "text-muted-foreground bg-muted";
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

  return (
    <div className={cn(
      "flex gap-3 rounded-2xl bg-card p-3.5 transition-all",
      inCart ? "ring-1 ring-primary/30 shadow-sm" : "border border-border/60",
      disabled && "opacity-50 pointer-events-none",
    )}>
      {/* Image */}
      {item.image_url && (
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted">
          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
        <div className="space-y-1">
          <p className="font-semibold text-sm leading-snug">{item.name}</p>

          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map(tag => (
                <span key={tag} className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", tagStyle(tag))}>
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
          <p className="text-sm font-bold">{fmt(finalPrice)}</p>

          {/* Stepper / Add */}
          {inCart ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDecrement(item.id, quantity)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                aria-label={`Remove ${item.name}`}
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-4 text-center text-sm font-bold tabular-nums">{quantity}</span>
              <button
                onClick={() => onAddToCart(item)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                aria-label={`Add ${item.name}`}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onAddToCart(item)}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all"
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

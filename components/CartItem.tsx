"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CartItem as CartItemType } from "@/types/database";

type Props = {
  item: CartItemType;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
};

export default function CartItem({ item, onUpdateQuantity }: Props) {
  return (
    <div className="flex items-center gap-3 py-3">
      {/* Name + subtotal */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          ₹{item.price.toFixed(2)} each
        </p>
      </div>

      {/* Quantity stepper */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          className={cn(
            "h-7 w-7 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90",
            item.quantity === 1
              ? "bg-rose-100 text-rose-600 hover:bg-rose-200"
              : "bg-orange-100 text-orange-600 hover:bg-orange-200"
          )}
          onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
          aria-label={`Remove one ${item.name}`}
        >
          {item.quantity === 1 ? (
            <Trash2 className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
        </button>

        <span className="w-6 text-center text-sm font-bold tabular-nums">
          {item.quantity}
        </span>

        <button
          className="h-7 w-7 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-700 hover:bg-emerald-200 active:scale-90 transition-all duration-150"
          onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
          aria-label={`Add one more ${item.name}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Line total */}
      <p className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-primary">
        ₹{(item.price * item.quantity).toFixed(2)}
      </p>
    </div>
  );
}

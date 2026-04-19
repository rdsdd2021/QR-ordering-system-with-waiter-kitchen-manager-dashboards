"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          ₹{item.price.toFixed(2)} each
        </p>
      </div>

      {/* Quantity stepper */}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 rounded-full touch-manipulation"
          onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
          aria-label={`Remove one ${item.name}`}
        >
          {item.quantity === 1 ? (
            <Trash2 className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
        </Button>

        <span className="w-6 text-center text-sm font-semibold tabular-nums">
          {item.quantity}
        </span>

        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 rounded-full touch-manipulation"
          onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
          aria-label={`Add one more ${item.name}`}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* Line total */}
      <p className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
        ₹{(item.price * item.quantity).toFixed(2)}
      </p>
    </div>
  );
}

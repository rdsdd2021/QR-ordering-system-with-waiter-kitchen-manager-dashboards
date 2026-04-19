"use client";

import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
  totalItems: number;
  totalPrice: number;
};

export default function CartBadge({ totalItems, totalPrice }: Props) {
  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-[calc(var(--cart-height,180px)+16px)] left-1/2 z-50 -translate-x-1/2 pointer-events-none">
      <Button
        className="pointer-events-auto shadow-xl gap-2.5 pr-5 pl-4 h-11 rounded-full text-sm font-semibold backdrop-blur-sm"
        onClick={() =>
          document
            .getElementById("cart-drawer")
            ?.scrollIntoView({ behavior: "smooth" })
        }
        aria-label="View cart"
      >
        <span className="relative">
          <ShoppingBag className="h-4 w-4" />
          <Badge className="absolute -top-2.5 -right-2.5 h-4 w-4 p-0 flex items-center justify-center text-[9px] rounded-full bg-primary-foreground text-primary">
            {totalItems}
          </Badge>
        </span>
        <span>View cart</span>
        <span className="opacity-80">·</span>
        <span className="tabular-nums">₹{totalPrice.toFixed(2)}</span>
      </Button>
    </div>
  );
}

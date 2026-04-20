"use client";

import { useEffect, useRef, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import Counter from "@/components/ui/Counter";

type Props = {
  totalItems: number;
  totalPrice: number;
};

export default function CartBadge({ totalItems, totalPrice }: Props) {
  const prevItems = useRef(totalItems);
  const [badgePopping, setBadgePopping] = useState(false);
  const [btnPopping, setBtnPopping] = useState(false);

  useEffect(() => {
    if (totalItems > prevItems.current) {
      setBadgePopping(true);
      setBtnPopping(true);
      setTimeout(() => setBadgePopping(false), 400);
      setTimeout(() => setBtnPopping(false), 350);
    }
    prevItems.current = totalItems;
  }, [totalItems]);

  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-[calc(var(--cart-height,180px)+16px)] left-1/2 z-50 -translate-x-1/2 pointer-events-none">
      <button
        className={cn(
          "pointer-events-auto shadow-xl gap-2.5 pr-5 pl-4 h-12 rounded-full text-sm font-semibold backdrop-blur-sm",
          "inline-flex items-center",
          "bg-gradient-to-r from-orange-500 to-amber-500 text-white",
          "hover:from-orange-600 hover:to-amber-600 hover:shadow-2xl hover:shadow-orange-400/40 hover:scale-105",
          "active:scale-95 transition-all duration-150",
          btnPopping && "animate-pop",
        )}
        onClick={() =>
          document
            .getElementById("cart-drawer")
            ?.scrollIntoView({ behavior: "smooth" })
        }
        aria-label="View cart"
      >
        <span className="relative">
          <ShoppingBag className="h-4 w-4" />
          <span className={cn(
            "absolute -top-2.5 -right-2.5 h-4 w-4 flex items-center justify-center text-[9px] font-bold rounded-full bg-white text-orange-600",
            badgePopping && "animate-badge-pop",
          )}>
            {totalItems}
          </span>
        </span>
        <span>View cart</span>
        <span className="opacity-60">·</span>
        <span className="tabular-nums font-bold">
          ₹<Counter value={Math.round(totalPrice * 100) / 100} fontSize={14} textColor="white" fontWeight="bold" />
        </span>
      </button>
    </div>
  );
}

"use client";

import { useState, useCallback, useMemo } from "react";
import type { CartItem, MenuItem } from "@/types/database";

export function useCart(priceMultiplier = 1.0) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  /** Add a menu item to the cart. If it already exists, increment quantity. */
  const addToCart = useCallback((item: MenuItem) => {
    setCartItems((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  /** Remove an item from the cart entirely. */
  const removeFromCart = useCallback((itemId: string) => {
    setCartItems((prev) => prev.filter((c) => c.id !== itemId));
  }, []);

  /**
   * Update the quantity of a cart item.
   * If quantity drops to 0 or below, the item is removed.
   */
  const updateQuantity = useCallback((itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setCartItems((prev) => prev.filter((c) => c.id !== itemId));
    } else {
      setCartItems((prev) =>
        prev.map((c) => (c.id === itemId ? { ...c, quantity } : c))
      );
    }
  }, []);

  /** Clear all items from the cart. */
  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  /**
   * Total price using the floor-adjusted price (matches what MenuItemCard displays).
   * The server also applies the multiplier via calculate_item_prices_batch RPC.
   */
  const totalPrice = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.price * priceMultiplier * item.quantity, 0),
    [cartItems, priceMultiplier]
  );

  /** Total number of individual items (sum of quantities). */
  const totalItems = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  return {
    cartItems,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    totalPrice,
    totalItems,
  };
}

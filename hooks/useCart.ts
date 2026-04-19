/**
 * useCart — custom hook for managing cart state.
 *
 * Provides:
 * - cartItems: current items in the cart
 * - addToCart: add a menu item (or increment quantity if already present)
 * - removeFromCart: remove a menu item entirely
 * - updateQuantity: set a specific quantity for an item
 * - clearCart: empty the cart
 * - totalPrice: computed total across all items
 * - totalItems: total number of individual items
 */
"use client";

import { useState, useCallback, useMemo } from "react";
import type { CartItem, MenuItem } from "@/types/database";

export function useCart() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  /** Add a menu item to the cart. If it already exists, increment quantity. */
  const addToCart = useCallback((item: MenuItem) => {
    setCartItems((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        // Optimistically increment quantity
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

  /** Computed total price across all cart items. */
  const totalPrice = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cartItems]
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

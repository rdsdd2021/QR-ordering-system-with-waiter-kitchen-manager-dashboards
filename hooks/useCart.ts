"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import type { CartItem, MenuItem } from "@/types/database";

const CART_KEY = (tableId: string) => `cart_${tableId}`;

export function useCart(priceMultiplier = 1.0, tableId?: string, onItemInvalidated?: (itemId: string) => void) {
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    // Initialise from sessionStorage on first render (client-only)
    if (typeof window === "undefined" || !tableId) return [];
    try {
      const stored = sessionStorage.getItem(CART_KEY(tableId));
      return stored ? (JSON.parse(stored) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  // Persist cart to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window === "undefined" || !tableId) return;
    try {
      if (cartItems.length === 0) {
        sessionStorage.removeItem(CART_KEY(tableId));
      } else {
        sessionStorage.setItem(CART_KEY(tableId), JSON.stringify(cartItems));
      }
    } catch {}
  }, [cartItems, tableId]);

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
   * Remove a deleted menu item from the cart.
   * Called when a real-time DELETE event arrives for a menu item that is
   * currently in the cart. Fires the optional onItemInvalidated callback so
   * the UI can show a toast/banner.
   */
  const invalidateCartItem = useCallback((itemId: string) => {
    setCartItems((prev) => {
      const exists = prev.some((c) => c.id === itemId);
      if (!exists) return prev;
      onItemInvalidated?.(itemId);
      return prev.filter((c) => c.id !== itemId);
    });
  }, [onItemInvalidated]);

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
    invalidateCartItem,
    updateQuantity,
    clearCart,
    totalPrice,
    totalItems,
  };
}

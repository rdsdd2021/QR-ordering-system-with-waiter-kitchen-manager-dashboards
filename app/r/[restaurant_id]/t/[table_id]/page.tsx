/**
 * Table Order Page — /r/[restaurant_id]/t/[table_id]
 *
 * This is the main customer-facing page. It:
 * 1. Validates the restaurant and table exist
 * 2. Fetches available menu items
 * 3. Fetches floor information for pricing display
 * 4. Renders the menu with cart functionality
 *
 * Data fetching happens server-side for fast initial load.
 * Cart state and order placement are handled client-side.
 */
import { notFound } from "next/navigation";
import { getRestaurant, getTable, getMenuItems, getTableFloor } from "@/lib/api";
import OrderPageClient from "./OrderPageClient";

type Props = {
  params: Promise<{
    restaurant_id: string;
    table_id: string;
  }>;
};

export default async function TableOrderPage({ params }: Props) {
  const { restaurant_id, table_id } = await params;

  // Fetch restaurant, table, menu, and floor info in parallel for speed
  const [restaurant, table, menuItems, floorInfo] = await Promise.all([
    getRestaurant(restaurant_id),
    getTable(restaurant_id, table_id),
    getMenuItems(restaurant_id),
    getTableFloor(table_id),
  ]);

  // If the restaurant or table doesn't exist, show a 404
  if (!restaurant || !table) {
    notFound();
  }

  return (
    <OrderPageClient
      restaurant={restaurant}
      table={table}
      menuItems={menuItems}
      floorInfo={floorInfo}
    />
  );
}

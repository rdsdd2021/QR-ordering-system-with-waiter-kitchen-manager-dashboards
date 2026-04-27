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

  // If the restaurant is deactivated by admin, show a closed screen
  if (restaurant.is_active === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border bg-card shadow-sm">
          <span className="text-3xl">🔒</span>
        </div>
        <h1 className="text-xl font-bold">{restaurant.name}</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">Table {table.table_number}</p>
        <div className="mt-6 rounded-xl border bg-card px-6 py-5 shadow-sm max-w-xs w-full">
          <p className="font-semibold text-base">Restaurant is currently closed</p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            We&apos;re not accepting orders right now. Please check back later or ask your server.
          </p>
        </div>
      </div>
    );
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

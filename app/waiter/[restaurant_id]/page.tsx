/**
 * Waiter Dashboard Page — /waiter/[restaurant_id]
 *
 * This is the waiter-facing dashboard. It:
 * 1. Validates the restaurant exists
 * 2. Shows orders assigned to the waiter + unassigned orders needing attention
 * 3. Allows waiters to take orders and mark them as served
 *
 * Uses authentication to get the current waiter's ID.
 */
import { notFound } from "next/navigation";
import { getRestaurant } from "@/lib/api";
import WaiterClient from "./WaiterClient";

type Props = {
  params: Promise<{
    restaurant_id: string;
  }>;
};

export default async function WaiterDashboardPage({ params }: Props) {
  const { restaurant_id } = await params;

  // Fetch restaurant to validate it exists
  const restaurant = await getRestaurant(restaurant_id);

  if (!restaurant) {
    notFound();
  }

  // The WaiterClient component will handle getting the current user ID from auth
  return (
    <WaiterClient 
      restaurant={restaurant}
    />
  );
}
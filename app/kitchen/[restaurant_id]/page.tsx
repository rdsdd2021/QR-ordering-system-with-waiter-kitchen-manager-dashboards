/**
 * Kitchen Dashboard — /kitchen/[restaurant_id]
 *
 * Server component: validates the restaurant exists, then hands off
 * to KitchenClient which owns all real-time state.
 */
import { notFound } from "next/navigation";
import { getRestaurant } from "@/lib/api";
import KitchenClient from "./KitchenClient";

type Props = {
  params: Promise<{ restaurant_id: string }>;
};

export default async function KitchenPage({ params }: Props) {
  const { restaurant_id } = await params;
  const restaurant = await getRestaurant(restaurant_id);

  if (!restaurant) notFound();

  return <KitchenClient restaurant={restaurant} />;
}

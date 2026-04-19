import { notFound } from "next/navigation";
import { getRestaurant } from "@/lib/api";
import ManagerClient from "./ManagerClient";

type Props = {
  params: Promise<{ restaurant_id: string }>;
};

export default async function ManagerPage({ params }: Props) {
  const { restaurant_id } = await params;
  
  // Fetch restaurant data
  const restaurant = await getRestaurant(restaurant_id);

  if (!restaurant) {
    notFound();
  }

  return <ManagerClient restaurant={restaurant} />;
}

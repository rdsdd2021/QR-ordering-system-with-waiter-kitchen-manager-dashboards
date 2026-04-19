import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";

// Service-role client — bypasses RLS for subscription writes
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, returnUrl } = await req.json();
    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const stripe = getStripe();

    // Get or create Stripe customer for this restaurant
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("restaurant_id", restaurantId)
      .single();

    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
      // Fetch restaurant name for Stripe customer
      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .single();

      const customer = await stripe.customers.create({
        name: restaurant?.name ?? "Restaurant",
        metadata: { restaurant_id: restaurantId },
      });
      customerId = customer.id;

      // Save customer ID
      await supabase
        .from("subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("restaurant_id", restaurantId);
    }

    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: "STRIPE_PRO_PRICE_ID not configured" }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${returnUrl}?upgrade=success`,
      cancel_url:  `${returnUrl}?upgrade=canceled`,
      metadata: { restaurant_id: restaurantId },
      subscription_data: {
        metadata: { restaurant_id: restaurantId },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

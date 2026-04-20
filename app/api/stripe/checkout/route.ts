import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key);
}

/**
 * Resolve or create a Stripe coupon for the given discount.
 * Caches the stripe_coupon_id back to DB to avoid re-creation.
 */
async function resolveStripeCoupon(
  couponId: string,
  type: "percentage" | "flat",
  value: number,
  cachedStripeId: string | null
): Promise<string> {
  const stripe = getStripe();

  if (cachedStripeId) {
    // Verify it still exists in Stripe
    try {
      await stripe.coupons.retrieve(cachedStripeId);
      return cachedStripeId;
    } catch {
      // Stale — fall through to create a new one
    }
  }

  const params: Parameters<typeof stripe.coupons.create>[0] =
    type === "percentage"
      ? { percent_off: value, duration: "once" }
      : { amount_off: Math.round(value), currency: "inr", duration: "once" };

  const stripeCoupon = await stripe.coupons.create(params);

  // Cache back to DB
  const supabase = getServiceClient();
  await supabase
    .from("coupons")
    .update({ stripe_coupon_id: stripeCoupon.id })
    .eq("id", couponId);

  return stripeCoupon.id;
}

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, returnUrl, plan = "pro", couponCode } = await req.json();

    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const stripe = getStripe();

    // ── Validate coupon (server-side, never trust frontend) ──────────────
    let stripeCouponId: string | undefined;
    let couponDbId: string | undefined;

    if (couponCode) {
      const { data: validation, error: valErr } = await supabase.rpc("validate_coupon", {
        p_code: couponCode,
        p_plan: plan,
        p_restaurant_id: restaurantId,
      });

      if (valErr || !validation?.valid) {
        return NextResponse.json(
          { error: validation?.reason ?? "Invalid coupon" },
          { status: 400 }
        );
      }

      couponDbId = validation.coupon_id as string;
      stripeCouponId = await resolveStripeCoupon(
        couponDbId,
        validation.type as "percentage" | "flat",
        Number(validation.value),
        validation.stripe_coupon_id as string | null
      );
    }

    // ── Get or create Stripe customer ────────────────────────────────────
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("restaurant_id", restaurantId)
      .single();

    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
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

      await supabase
        .from("subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("restaurant_id", restaurantId);
    }

    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) {
      return NextResponse.json({ error: "STRIPE_PRO_PRICE_ID not configured" }, { status: 500 });
    }

    // ── Create checkout session ──────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
      success_url: `${returnUrl}?upgrade=success`,
      cancel_url: `${returnUrl}?upgrade=canceled`,
      metadata: {
        restaurant_id: restaurantId,
        coupon_id: couponDbId ?? "",
      },
      subscription_data: {
        trial_period_days: 7,
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

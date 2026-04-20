import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import Stripe from "stripe";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const restaurantId = session.metadata?.restaurant_id;
        const couponId     = session.metadata?.coupon_id;
        const subscriptionId = session.subscription as string;
        if (!restaurantId || !subscriptionId) break;

        const stripeSub = await getStripe().subscriptions.retrieve(subscriptionId);
        await supabase.from("subscriptions").upsert({
          restaurant_id:          restaurantId,
          plan:                   "pro",
          status:                 stripeSub.status,
          stripe_customer_id:     stripeSub.customer as string,
          stripe_subscription_id: stripeSub.id,
          current_period_end:     new Date((stripeSub.items.data[0]?.current_period_end ?? 0) * 1000).toISOString(),
          updated_at:             new Date().toISOString(),
        }, { onConflict: "restaurant_id" });

        // Record coupon usage (idempotent, race-condition safe via advisory lock)
        if (couponId) {
          await supabase.rpc("record_coupon_usage", {
            p_coupon_id:     couponId,
            p_restaurant_id: restaurantId,
          });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as Stripe.Subscription;
        const restaurantId = stripeSub.metadata?.restaurant_id;
        if (!restaurantId) break;

        const plan = event.type === "customer.subscription.deleted"
          ? "free"
          : (stripeSub.status === "active" || stripeSub.status === "trialing" ? "pro" : "free");

        await supabase.from("subscriptions").upsert({
          restaurant_id:          restaurantId,
          plan,
          status:                 event.type === "customer.subscription.deleted" ? "canceled" : stripeSub.status,
          stripe_customer_id:     stripeSub.customer as string,
          stripe_subscription_id: stripeSub.id,
          current_period_end:     new Date((stripeSub.items.data[0]?.current_period_end ?? 0) * 1000).toISOString(),
          updated_at:             new Date().toISOString(),
        }, { onConflict: "restaurant_id" });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.parent?.subscription_details?.subscription as string | undefined;
        if (!subId) break;

        await supabase
          .from("subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("stripe_subscription_id", subId);
        break;
      }
    }
  } catch (err) {
    console.error("[webhook] handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Stripe sends raw body — disable Next.js body parsing (App Router uses runtime config)
export const runtime = "nodejs";

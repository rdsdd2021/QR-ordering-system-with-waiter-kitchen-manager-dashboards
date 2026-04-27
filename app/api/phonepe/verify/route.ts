import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPhonePeClient } from "@/lib/phonepe";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Called by the client after the PhonePe popup closes.
 * Directly checks PhonePe order status — no webhook dependency.
 * Also handles coupon usage recording and duration_days.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantOrderId, restaurantId } = await req.json();
    if (!merchantOrderId || !restaurantId) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const client = getPhonePeClient();
    const status = await client.getOrderStatus(merchantOrderId);
    const state = (status as unknown as { state?: string }).state;

    const supabase = getServiceClient();

    if (state === "COMPLETED") {
      // Fetch transaction details: billing cycle, coupon info
      const { data: txRow } = await supabase
        .from("payment_transactions")
        .select("plan, coupon_code, coupon_duration_days")
        .eq("merchant_order_id", merchantOrderId)
        .maybeSingle();

      const isYearly = (txRow?.plan as string | null)?.includes("yearly");
      const couponDurationDays = (txRow?.coupon_duration_days as number | null) ?? 0;

      const periodEnd = new Date();
      if (isYearly) {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
      if (couponDurationDays > 0) {
        periodEnd.setDate(periodEnd.getDate() + couponDurationDays);
      }

      // Fetch pending_coupon_id from subscription
      const { data: subRow } = await supabase
        .from("subscriptions")
        .select("pending_coupon_id")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();

      await supabase.from("subscriptions").upsert({
        restaurant_id:          restaurantId,
        plan:                   "pro",
        status:                 "active",
        trial_used:             true,
        phonepe_transaction_id: merchantOrderId,
        current_period_end:     periodEnd.toISOString(),
        pending_coupon_id:      null,
        updated_at:             new Date().toISOString(),
      }, { onConflict: "restaurant_id" });

      await supabase.from("payment_transactions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("merchant_order_id", merchantOrderId);

      // Record coupon usage if one was applied
      if (subRow?.pending_coupon_id) {
        await supabase.rpc("record_coupon_usage", {
          p_coupon_id:     subRow.pending_coupon_id,
          p_restaurant_id: restaurantId,
        });
      }

      return NextResponse.json({ upgraded: true, state });
    }

    if (state === "FAILED") {
      await supabase.from("payment_transactions")
        .update({ status: "failed" })
        .eq("merchant_order_id", merchantOrderId);
      return NextResponse.json({ upgraded: false, state });
    }

    // PENDING — still processing
    return NextResponse.json({ upgraded: false, state: state ?? "PENDING" });

  } catch (err) {
    console.error("[phonepe/verify]", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}

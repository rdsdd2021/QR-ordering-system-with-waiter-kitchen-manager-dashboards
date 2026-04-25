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
 * Called by the client after the popup closes.
 * Directly checks PhonePe order status — no webhook dependency.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantOrderId, restaurantId } = await req.json();
    if (!merchantOrderId || !restaurantId) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const client = getPhonePeClient();
    const status = await client.getOrderStatus(merchantOrderId);

    const supabase = getServiceClient();
    const state = (status as unknown as { state?: string }).state;

    if (state === "COMPLETED") {
      // Look up billing cycle from payment_transactions
      const { data: txRow } = await supabase
        .from("payment_transactions")
        .select("plan")
        .eq("merchant_order_id", merchantOrderId)
        .maybeSingle();

      const isYearly = (txRow?.plan as string | null)?.includes("yearly");
      const periodEnd = new Date();
      if (isYearly) {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await supabase.from("subscriptions").upsert({
        restaurant_id:          restaurantId,
        plan:                   "pro",
        status:                 "active",
        phonepe_transaction_id: merchantOrderId,
        current_period_end:     periodEnd.toISOString(),
        pending_coupon_id:      null,
        updated_at:             new Date().toISOString(),
      }, { onConflict: "restaurant_id" });

      await supabase.from("payment_transactions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("merchant_order_id", merchantOrderId);

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

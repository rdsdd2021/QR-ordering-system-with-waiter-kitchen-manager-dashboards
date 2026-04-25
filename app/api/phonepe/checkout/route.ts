import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { StandardCheckoutPayRequest, MetaInfo } from "pg-sdk-node";
import { getPhonePeClient, PHONEPE_PLANS } from "@/lib/phonepe";
import { randomUUID } from "crypto";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, returnUrl, plan = "pro", couponCode } = await req.json();

    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
    }

    const planConfig = PHONEPE_PLANS[plan as keyof typeof PHONEPE_PLANS];
    if (!planConfig) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // ── Validate coupon (server-side) ────────────────────────────────────
    let couponDbId: string | undefined;
    let discountPaise = 0;

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
      if (validation.type === "percentage") {
        discountPaise = Math.round((planConfig.amountPaise * Number(validation.value)) / 100);
      } else {
        discountPaise = Math.round(Number(validation.value) * 100);
      }
    }

    const finalAmountPaise = Math.max(100, planConfig.amountPaise - discountPaise);

    // ── Build PhonePe payment request ────────────────────────────────────
    const merchantOrderId = `SUB-${randomUUID().replace(/-/g, "").slice(0, 30)}`;
    const redirectUrl = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}upgrade=success&orderId=${merchantOrderId}`;

    const metaInfo = MetaInfo.builder()
      .udf1(restaurantId)
      .udf2(couponDbId ?? "")
      .build();

    const request = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantOrderId)
      .amount(finalAmountPaise)
      .redirectUrl(redirectUrl)
      .metaInfo(metaInfo)
      .build();

    const client = getPhonePeClient();
    const response = await client.pay(request);
    const checkoutUrl = response.redirectUrl;

    if (!checkoutUrl) {
      return NextResponse.json({ error: "No redirect URL from PhonePe" }, { status: 500 });
    }

    // ── Store pending transaction ────────────────────────────────────────
    await supabase.from("subscriptions").upsert({
      restaurant_id:          restaurantId,
      plan:                   "free",
      status:                 "incomplete",
      phonepe_transaction_id: merchantOrderId,
      pending_coupon_id:      couponDbId ?? null,
      updated_at:             new Date().toISOString(),
    }, { onConflict: "restaurant_id" });

    // ── Record in payment_transactions ───────────────────────────────────
    await supabase.from("payment_transactions").insert({
      restaurant_id:    restaurantId,
      merchant_order_id: merchantOrderId,
      plan,
      amount_paise:     finalAmountPaise,
      status:           "pending",
      coupon_code:      couponCode ?? null,
    });

    return NextResponse.json({ url: checkoutUrl });
  } catch (err) {
    console.error("[phonepe/checkout]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

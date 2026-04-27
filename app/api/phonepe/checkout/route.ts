import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { StandardCheckoutPayRequest, MetaInfo } from "pg-sdk-node";
import { getPhonePeClient } from "@/lib/phonepe";
import { randomUUID } from "crypto";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing Supabase service role env vars");
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, returnUrl, plan = "pro_monthly", couponCode } = await req.json();

    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
    }

    // Derive base plan id and billing cycle from plan key
    // e.g. "pro_monthly" → basePlanId="pro", cycle="monthly"
    //      "pro_yearly"  → basePlanId="pro", cycle="yearly"
    //      "pro"         → basePlanId="pro", cycle="monthly"
    const isYearly = plan.endsWith("_yearly");
    const basePlanId = plan.replace(/_monthly$|_yearly$/, "");

    const supabase = getServiceClient();

    // Fetch plan config from DB
    const { data: planRow, error: planErr } = await supabase
      .from("plans")
      .select("id, name, monthly_paise, yearly_paise, cta")
      .eq("id", basePlanId)
      .eq("is_active", true)
      .maybeSingle();

    if (planErr || !planRow) {
      return NextResponse.json({ error: "Invalid or inactive plan" }, { status: 400 });
    }

    if (planRow.cta !== "choose") {
      return NextResponse.json({ error: "This plan is not available for self-serve purchase" }, { status: 400 });
    }

    const basePricePaise = isYearly ? planRow.yearly_paise : planRow.monthly_paise;

    // ── Validate coupon (server-side) ────────────────────────────────────
    let couponDbId: string | undefined;
    let discountPaise = 0;
    let couponDurationDays: number | null = null;

    if (couponCode) {
      const { data: validation, error: valErr } = await supabase.rpc("validate_coupon", {
        p_code: couponCode,
        p_plan: basePlanId, // DB function also normalizes, but pass clean value
        p_restaurant_id: restaurantId,
      });

      if (valErr || !validation?.valid) {
        return NextResponse.json(
          { error: validation?.reason ?? "Invalid coupon" },
          { status: 400 }
        );
      }

      couponDbId = validation.coupon_id as string;
      couponDurationDays = validation.duration_days ? Number(validation.duration_days) : null;

      if (validation.type === "percentage") {
        discountPaise = Math.round((basePricePaise * Number(validation.value)) / 100);
      } else {
        discountPaise = Math.round(Number(validation.value) * 100);
      }
    }

    const finalAmountPaise = Math.max(100, basePricePaise - discountPaise);

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
    // Only overwrite the subscription if it's NOT already on an active trial.
    // A trialing subscription means the user just onboarded — we don't want to
    // clobber it with "free/incomplete" before the payment completes.
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("status")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (existingSub?.status !== "trialing") {
      await supabase.from("subscriptions").upsert({
        restaurant_id:          restaurantId,
        plan:                   "free",
        status:                 "incomplete",
        phonepe_transaction_id: merchantOrderId,
        pending_coupon_id:      couponDbId ?? null,
        updated_at:             new Date().toISOString(),
      }, { onConflict: "restaurant_id" });
    } else {
      // Just store the pending transaction id so the webhook can upgrade later
      await supabase.from("subscriptions")
        .update({
          phonepe_transaction_id: merchantOrderId,
          pending_coupon_id:      couponDbId ?? null,
          updated_at:             new Date().toISOString(),
        })
        .eq("restaurant_id", restaurantId);
    }

    await supabase.from("payment_transactions").insert({
      restaurant_id:        restaurantId,
      merchant_order_id:    merchantOrderId,
      plan,
      amount_paise:         finalAmountPaise,
      status:               "pending",
      coupon_code:          couponCode ?? null,
      coupon_duration_days: couponDurationDays,
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

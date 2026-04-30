import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPhonePeClient } from "@/lib/phonepe";
import { writeAuditLog } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const authorizationHeader = req.headers.get("authorization") ?? "";

  const username = process.env.PHONEPE_WEBHOOK_USERNAME ?? "";
  const password = process.env.PHONEPE_WEBHOOK_PASSWORD ?? "";

  let callbackResponse: { type: string; payload: Record<string, unknown> };
  try {
    const client = getPhonePeClient();
    callbackResponse = client.validateCallback(
      username,
      password,
      authorizationHeader,
      body
    ) as unknown as typeof callbackResponse;
  } catch (err) {
    console.error("[phonepe/webhook] validation failed:", err);
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const { type, payload } = callbackResponse;
  const merchantOrderId = payload.originalMerchantOrderId as string | undefined;

  if (!merchantOrderId) {
    return NextResponse.json({ received: true });
  }

  const supabase = getServiceClient();

  // Look up subscription by transaction ID
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("restaurant_id, pending_coupon_id, status, plan")
    .eq("phonepe_transaction_id", merchantOrderId)
    .maybeSingle();

  let restaurantId = sub?.restaurant_id as string | undefined;

  // E4: If the DB lookup missed (race between checkout API crash and webhook),
  // fall back to the restaurantId stored in PhonePe's metaInfo.udf1 field.
  if (!restaurantId) {
    const metaInfo = payload.metaInfo as Record<string, unknown> | undefined;
    const udf1 = metaInfo?.udf1 as string | undefined;
    if (udf1 && udf1.length > 0) {
      console.warn("[phonepe/webhook] subscription lookup missed — recovering restaurantId from udf1:", udf1);
      restaurantId = udf1;

      // Also update the subscription row so future lookups work
      await supabase
        .from("subscriptions")
        .update({
          phonepe_transaction_id: merchantOrderId,
          updated_at: new Date().toISOString(),
        })
        .eq("restaurant_id", restaurantId);
    }
  }

  if (!restaurantId) {
    console.warn("[phonepe/webhook] no subscription found for orderId:", merchantOrderId);
    return NextResponse.json({ received: true });
  }

  // Look up the transaction to determine billing cycle and coupon duration
  const { data: txRow } = await supabase
    .from("payment_transactions")
    .select("plan, coupon_duration_days")
    .eq("merchant_order_id", merchantOrderId)
    .maybeSingle();

  const isYearly = (txRow?.plan as string | null)?.includes("yearly");
  const couponDurationDays = (txRow?.coupon_duration_days as number | null) ?? 0;

  try {
    if (type === "CHECKOUT_ORDER_COMPLETED" || payload.state === "COMPLETED") {
      const periodEnd = new Date();
      if (isYearly) {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
      // Add any bonus days from coupon
      if (couponDurationDays > 0) {
        periodEnd.setDate(periodEnd.getDate() + couponDurationDays);
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

      if (sub?.pending_coupon_id) {
        await supabase.rpc("record_coupon_usage", {
          p_coupon_id:     sub.pending_coupon_id,
          p_restaurant_id: restaurantId,
        });
      }

      // Audit: payment succeeded + plan changed (Requirements 2.8, 1.8)
      try {
        await writeAuditLog({
          restaurant_id: restaurantId,
          actor_type:    "system",
          actor_id:      "phonepe_webhook",
          actor_name:    "PhonePe Webhook",
          action:        "billing.payment_succeeded",
          resource_type: "billing",
          resource_id:   merchantOrderId,
          metadata:      { merchant_order_id: merchantOrderId },
        });
        await writeAuditLog({
          restaurant_id: restaurantId,
          actor_type:    "system",
          actor_id:      "phonepe_webhook",
          actor_name:    "PhonePe Webhook",
          action:        "billing.plan_changed",
          resource_type: "billing",
          resource_id:   merchantOrderId,
          metadata:      { old_plan: "free", new_plan: "pro", merchant_order_id: merchantOrderId },
        });
      } catch (auditErr) {
        console.error("[phonepe/webhook] audit log failed:", auditErr);
      }
    } else if (type === "CHECKOUT_ORDER_FAILED" || payload.state === "FAILED") {
      // E2: Distinguish between a failed renewal on an active Pro subscription
      // (→ past_due, keeps access temporarily) vs a failed first-time payment
      // (→ incomplete, no access). Never downgrade a trialing subscription.
      const currentStatus = sub?.status as string | undefined;
      const currentPlan   = sub?.plan   as string | undefined;

      if (currentStatus !== "trialing") {
        const newStatus = (currentPlan === "pro" && currentStatus === "active")
          ? "past_due"   // renewal failed — keep plan but flag as past_due
          : "incomplete"; // first-time payment failed — no access

        await supabase
          .from("subscriptions")
          .update({
            status:            newStatus,
            pending_coupon_id: null,
            updated_at:        new Date().toISOString(),
          })
          .eq("restaurant_id", restaurantId);
      }

      await supabase.from("payment_transactions")
        .update({ status: "failed" })
        .eq("merchant_order_id", merchantOrderId);

      // Audit: payment failed (Requirements 2.8, 1.8)
      try {
        await writeAuditLog({
          restaurant_id: restaurantId,
          actor_type:    "system",
          actor_id:      "phonepe_webhook",
          actor_name:    "PhonePe Webhook",
          action:        "billing.payment_failed",
          resource_type: "billing",
          resource_id:   merchantOrderId,
          metadata:      { merchant_order_id: merchantOrderId },
        });
      } catch (auditErr) {
        console.error("[phonepe/webhook] audit log failed:", auditErr);
      }
    }
  } catch (err) {
    console.error("[phonepe/webhook] handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

export const runtime = "nodejs";

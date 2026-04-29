import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit-log";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { code, plan, restaurantId } = await req.json();

    if (!code || !plan || !restaurantId) {
      return NextResponse.json(
        { valid: false, reason: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase.rpc("validate_coupon", {
      p_code: code,
      p_plan: plan,
      p_restaurant_id: restaurantId,
    });

    if (error) {
      console.error("[coupons/validate]", error);
      return NextResponse.json(
        { valid: false, reason: "Validation failed" },
        { status: 500 }
      );
    }

    try {
      await writeAuditLog({
        restaurant_id: restaurantId,
        actor_type: 'system',
        actor_id: 'coupon_validation',
        actor_name: 'Coupon Validation',
        action: 'coupon.validated',
        resource_type: 'coupon',
        resource_name: code,
        metadata: { code, plan, result: data },
      });
    } catch (auditErr) {
      console.error("[audit-log] coupon.validated failed", auditErr);
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[coupons/validate]", err);
    return NextResponse.json(
      { valid: false, reason: "Internal error" },
      { status: 500 }
    );
  }
}

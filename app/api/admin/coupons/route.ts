import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/admin/coupons — list all coupons
export async function GET() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// POST /api/admin/coupons — create coupon
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, type, value, duration_days, max_uses, expires_at, applicable_plans, is_active } = body;

    if (!code || !type || value == null) {
      return NextResponse.json({ error: "code, type, value are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("coupons")
      .insert({
        code: code.toUpperCase().trim(),
        type,
        value: Number(value),
        duration_days: duration_days ? Number(duration_days) : null,
        max_uses: max_uses ? Number(max_uses) : null,
        expires_at: expires_at || null,
        applicable_plans: applicable_plans ?? ["pro"],
        is_active: is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

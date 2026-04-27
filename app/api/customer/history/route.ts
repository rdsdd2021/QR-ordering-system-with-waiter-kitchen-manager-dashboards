import { NextRequest, NextResponse } from "next/server";
import { getCustomerOrderHistory } from "@/lib/api";

/**
 * POST /api/customer/history
 * 
 * Returns order history for a customer by phone number.
 * Groups orders by table sessions and includes waiter names.
 * Uses POST to avoid exposing phone numbers in URL query params.
 */
export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();

    if (!phone || phone.trim().length === 0) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    const history = await getCustomerOrderHistory(phone.trim());
    return NextResponse.json({ sessions: history });
  } catch (err) {
    console.error("[customer/history]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
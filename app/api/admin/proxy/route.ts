/**
 * POST /api/admin/proxy
 *
 * Server-side proxy for admin API calls.
 * The client sends the admin PIN; this route validates it and
 * forwards the request to the actual admin endpoint with the
 * ADMIN_SECRET header — keeping the secret out of the browser bundle.
 */
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { pin, endpoint, method = "POST", body } = await req.json();

    // Validate PIN server-side
    const adminPin = process.env.ADMIN_PIN ?? process.env.NEXT_PUBLIC_ADMIN_PIN ?? "";
    if (!pin || pin !== adminPin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminSecret = process.env.ADMIN_SECRET ?? "";
    if (!adminSecret) {
      return NextResponse.json({ error: "Admin secret not configured" }, { status: 500 });
    }

    // Forward to the actual admin endpoint
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminSecret}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("[admin/proxy]", err);
    return NextResponse.json({ error: "Proxy error" }, { status: 500 });
  }
}

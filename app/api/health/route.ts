import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Force dynamic so Next.js doesn't cache this route
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error } = await supabase.from("restaurants").select("id").limit(1);

  if (error) {
    return NextResponse.json(
      { status: "error", db: "error", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { status: "ok", db: "ok", timestamp: new Date().toISOString() },
    { status: 200 }
  );
}

/**
 * POST   /api/floors  — create a floor
 * PATCH  /api/floors  — update a floor
 * DELETE /api/floors  — delete a floor
 *
 * All operations write audit log entries.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAuditLog, getClientIp } from "@/lib/audit-log";
import { fireEvent } from "@/lib/webhooks";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function resolveManager(supabase: ReturnType<typeof getServiceClient>, restaurantId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, name")
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager")
    .maybeSingle();
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, name, priceMultiplier } = await req.json();
    if (!restaurantId || !name) {
      return NextResponse.json({ error: "restaurantId and name are required" }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("floors")
      .insert({ restaurant_id: restaurantId, name: name.trim(), price_multiplier: priceMultiplier ?? 1.0 })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const manager = await resolveManager(supabase, restaurantId);
    try {
      await writeAuditLog({
        restaurant_id: restaurantId,
        actor_type: "manager",
        actor_id: manager?.id ?? "unknown",
        actor_name: manager?.name ?? "Manager",
        action: "floor.created",
        resource_type: "floor",
        resource_id: data.id,
        resource_name: name.trim(),
        ip_address: getClientIp(req),
      });
    } catch (err) { console.error("[floors/create] writeAuditLog failed", err); }

    fireEvent(restaurantId, "floor.created", {
      floor_id: data.id,
      restaurant_id: restaurantId,
      name: data.name,
      price_multiplier: data.price_multiplier ?? 1.0,
    }).catch(err => console.error("[floors/create] webhook error:", err));

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { floorId, restaurantId, updates } = await req.json();
    if (!floorId || !restaurantId) {
      return NextResponse.json({ error: "floorId and restaurantId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Fetch current name for audit log
    const { data: existing } = await supabase.from("floors").select("name").eq("id", floorId).maybeSingle();

    const { error } = await supabase.from("floors").update(updates).eq("id", floorId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const manager = await resolveManager(supabase, restaurantId);
    try {
      await writeAuditLog({
        restaurant_id: restaurantId,
        actor_type: "manager",
        actor_id: manager?.id ?? "unknown",
        actor_name: manager?.name ?? "Manager",
        action: "floor.updated",
        resource_type: "floor",
        resource_id: floorId,
        resource_name: existing?.name ?? null,
        metadata: { updated_fields: updates },
        ip_address: getClientIp(req),
      });
    } catch (err) { console.error("[floors/update] writeAuditLog failed", err); }

    fireEvent(restaurantId, "floor.updated", {
      floor_id: floorId,
      restaurant_id: restaurantId,
      name: existing?.name ?? null,
      changes: updates,
    }).catch(err => console.error("[floors/update] webhook error:", err));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { floorId, restaurantId } = await req.json();
    if (!floorId || !restaurantId) {
      return NextResponse.json({ error: "floorId and restaurantId are required" }, { status: 400 });
    }

    const supabase = getServiceClient();

    // Fetch name before deletion
    const { data: existing } = await supabase.from("floors").select("name").eq("id", floorId).maybeSingle();

    const { error } = await supabase.from("floors").delete().eq("id", floorId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const manager = await resolveManager(supabase, restaurantId);
    try {
      await writeAuditLog({
        restaurant_id: restaurantId,
        actor_type: "manager",
        actor_id: manager?.id ?? "unknown",
        actor_name: manager?.name ?? "Manager",
        action: "floor.deleted",
        resource_type: "floor",
        resource_id: floorId,
        resource_name: existing?.name ?? null,
        ip_address: getClientIp(req),
      });
    } catch (err) { console.error("[floors/delete] writeAuditLog failed", err); }

    fireEvent(restaurantId, "floor.deleted", {
      floor_id: floorId,
      restaurant_id: restaurantId,
      name: existing?.name ?? null,
    }).catch(err => console.error("[floors/delete] webhook error:", err));

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

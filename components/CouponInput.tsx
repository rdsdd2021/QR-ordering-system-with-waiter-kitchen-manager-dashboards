"use client";

import { useState } from "react";
import { Tag, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CouponResult = {
  coupon_id: string;
  type: "percentage" | "flat";
  value: number;
  duration_days: number | null;
  code: string;
};

type Props = {
  plan: string;
  restaurantId: string;
  /** Plan price in smallest currency unit (paise) for flat discount cap */
  planPricePaise: number;
  onApply: (result: CouponResult | null) => void;
};

export default function CouponInput({ plan, restaurantId, planPricePaise, onApply }: Props) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState<CouponResult | null>(null);

  async function apply() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setStatus("loading");
    setMessage("");

    const res = await fetch("/api/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmed, plan, restaurantId }),
    });

    const data = await res.json();

    if (!data.valid) {
      setStatus("error");
      setMessage(data.reason ?? "Invalid coupon");
      onApply(null);
      setApplied(null);
      return;
    }

    const result: CouponResult = {
      coupon_id: data.coupon_id,
      type: data.type,
      value: Number(data.value),
      duration_days: data.duration_days ? Number(data.duration_days) : null,
      code: trimmed,
    };

    setApplied(result);
    setStatus("success");

    const flatRupees = Number(data.value);
    const planRupees = planPricePaise / 100;
    const parts: string[] = [];
    if (data.type === "percentage") {
      parts.push(`${data.value}% off`);
    } else {
      parts.push(`₹${Math.min(flatRupees, planRupees).toFixed(0)} off`);
    }
    if (data.duration_days) {
      parts.push(`+${data.duration_days} bonus days`);
    }
    setMessage(`${parts.join(" · ")} applied 🎉`);
    onApply(result);
  }

  function remove() {
    setCode("");
    setApplied(null);
    setStatus("idle");
    setMessage("");
    onApply(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Coupon code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (status !== "idle") { setStatus("idle"); setMessage(""); }
            }}
            onKeyDown={(e) => e.key === "Enter" && !applied && apply()}
            disabled={!!applied}
            className="pl-8 font-mono uppercase text-sm"
          />
        </div>
        {applied ? (
          <Button variant="outline" size="sm" onClick={remove} className="shrink-0">
            Remove
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={apply}
            disabled={status === "loading" || !code.trim()}
            className="shrink-0"
          >
            {status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
          </Button>
        )}
      </div>

      {message && (
        <p className={cn(
          "text-xs flex items-center gap-1.5",
          status === "success" ? "text-green-600" : "text-destructive"
        )}>
          {status === "success"
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : <XCircle className="h-3.5 w-3.5" />}
          {message}
        </p>
      )}
    </div>
  );
}

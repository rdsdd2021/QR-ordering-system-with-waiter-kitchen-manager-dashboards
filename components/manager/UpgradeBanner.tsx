"use client";

import { useState } from "react";
import { Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/hooks/useSubscription";
import CouponInput, { type CouponResult } from "@/components/CouponInput";
import { cn } from "@/lib/utils";

type Props = { restaurantId: string };

// Pro plan price in paise (₹799/month = 79900 paise)
const PRO_PRICE_PAISE = 79900;

export default function UpgradeBanner({ restaurantId }: Props) {
  const { plan, isPro, subscription, loading, startUpgrade } = useSubscription(restaurantId);
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  if (loading) return null;

  if (isPro) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
        <Zap className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Pro plan active</p>
          {subscription?.current_period_end && (
            <p className="text-xs text-muted-foreground">
              Renews {new Date(subscription.current_period_end).toLocaleDateString()}
            </p>
          )}
        </div>
        <Badge className="bg-primary text-primary-foreground shrink-0">Pro</Badge>
      </div>
    );
  }

  // flat coupon value is in rupees; PRO_PRICE_PAISE is in paise — convert to same unit
  const discountedPaise = coupon
    ? coupon.type === "percentage"
      ? PRO_PRICE_PAISE - Math.round((PRO_PRICE_PAISE * coupon.value) / 100)
      : Math.max(0, PRO_PRICE_PAISE - Math.round(coupon.value * 100))
    : PRO_PRICE_PAISE;

  const originalPrice = `₹${(PRO_PRICE_PAISE / 100).toFixed(0)}`;
  const finalPrice    = `₹${(discountedPaise / 100).toFixed(0)}`;

  async function handleUpgrade() {
    setUpgrading(true);
    await startUpgrade(window.location.href, coupon?.code);
    setUpgrading(false);
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">Upgrade to Pro</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            7-day free trial · then {`₹${(79900/100).toFixed(0)}`}/month
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          "Unlimited tables",
          "Unlimited menu items",
          "Advanced analytics",
          "Priority support",
          "Custom branding",
          "Export reports",
        ].map((f) => (
          <div key={f} className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            {f}
          </div>
        ))}
      </div>

      {/* Coupon input */}
      <CouponInput
        plan="pro"
        restaurantId={restaurantId}
        planPricePaise={PRO_PRICE_PAISE}
        onApply={setCoupon}
      />

      {/* Price display */}
      <div className="flex items-baseline gap-2">
        {coupon ? (
          <>
            <span className="text-lg font-bold">{finalPrice}/month</span>
            <span className="text-sm text-muted-foreground line-through">{originalPrice}</span>
          </>
        ) : (
          <span className="text-lg font-bold">{originalPrice}/month</span>
        )}
      </div>

      <Button
        className="w-full"
        onClick={handleUpgrade}
        disabled={upgrading}
      >
        <Zap className="h-4 w-4 mr-2" />
        {upgrading ? "Redirecting…" : `Start 7-day free trial — ${finalPrice}/month after`}
      </Button>
    </div>
  );
}

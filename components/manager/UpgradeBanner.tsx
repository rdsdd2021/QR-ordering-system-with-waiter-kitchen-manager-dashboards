"use client";

import { useState, useEffect } from "react";
import { Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/hooks/useSubscription";
import CouponInput, { type CouponResult } from "@/components/CouponInput";
import { cn } from "@/lib/utils";

type Props = { restaurantId: string };

export default function UpgradeBanner({ restaurantId }: Props) {
  const { plan, isPro, subscription, loading, startUpgrade } = useSubscription(restaurantId);
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [proPricePaise, setProPricePaise] = useState(99900);

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((plans: Array<{ id: string; monthly_paise: number }>) => {
        const pro = plans.find((p) => p.id === "pro");
        if (pro) setProPricePaise(pro.monthly_paise);
      })
      .catch(() => {});
  }, []);

  if (loading) return null;

  if (isPro) {
    const isTrial = subscription?.status === "trialing";
    const trialEnd = subscription?.current_period_end;
    const daysLeft = trialEnd
      ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - Date.now()) / 86400000))
      : null;

    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
        <Zap className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {isTrial ? "Trial active" : "Pro plan active"}
          </p>
          {isTrial && daysLeft !== null ? (
            <p className="text-xs text-muted-foreground">
              {daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining` : "Trial ends today"}
            </p>
          ) : subscription?.current_period_end ? (
            <p className="text-xs text-muted-foreground">
              Renews {new Date(subscription.current_period_end).toLocaleDateString()}
            </p>
          ) : null}
        </div>
        <Badge className={isTrial ? "bg-amber-500 text-white shrink-0" : "bg-primary text-primary-foreground shrink-0"}>
          {isTrial ? "Trial" : "Pro"}
        </Badge>
      </div>
    );
  }

  const discountedPaise = coupon
    ? coupon.type === "percentage"
      ? proPricePaise - Math.round((proPricePaise * coupon.value) / 100)
      : Math.max(0, proPricePaise - Math.round(coupon.value * 100))
    : proPricePaise;

  const originalPrice = `₹${(proPricePaise / 100).toFixed(0)}`;
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
            7-day free trial · then {originalPrice}/month
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
        planPricePaise={proPricePaise}
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

      {discountedPaise === 0 ? (
        <Button className="w-full" onClick={handleUpgrade} disabled={upgrading}>
          <Zap className="h-4 w-4 mr-2" />
          {upgrading ? "Redirecting…" : "Upgrade for Free"}
        </Button>
      ) : coupon ? (
        <Button className="w-full" onClick={handleUpgrade} disabled={upgrading}>
          <Zap className="h-4 w-4 mr-2" />
          {upgrading ? "Redirecting…" : `Upgrade — ${finalPrice}/month`}
        </Button>
      ) : (
        <Button className="w-full" onClick={handleUpgrade} disabled={upgrading}>
          <Zap className="h-4 w-4 mr-2" />
          {upgrading ? "Redirecting…" : `Start 7-day free trial — ${finalPrice}/month after`}
        </Button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import CouponInput, { type CouponResult } from "@/components/CouponInput";

const PRO_FEATURES = [
  "Unlimited tables",
  "Unlimited menu items",
  "QR ordering",
  "Kitchen & waiter dashboards",
  "Real-time order updates",
  "Advanced analytics",
  "Floor-based pricing",
  "Priority support",
  "Export reports",
  "Custom branding",
  "Geo-fencing",
];

const PRO_PRICE_PAISE = 79900;

type Props = {
  restaurantId?: string;
  onUpgrade?: (couponCode?: string) => void;
  upgrading?: boolean;
};

export default function PricingSection({ restaurantId, onUpgrade, upgrading }: Props) {
  const [coupon, setCoupon] = useState<CouponResult | null>(null);

  const discountedPaise = coupon
    ? coupon.type === "percentage"
      ? PRO_PRICE_PAISE - Math.round((PRO_PRICE_PAISE * coupon.value) / 100)
      : Math.max(0, PRO_PRICE_PAISE - Math.round(coupon.value * 100))
    : PRO_PRICE_PAISE;

  const originalPrice = `₹${(PRO_PRICE_PAISE / 100).toFixed(0)}`;
  const finalPrice    = `₹${(discountedPaise / 100).toFixed(0)}`;
  const showDiscount  = coupon && discountedPaise < PRO_PRICE_PAISE;

  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">One plan. Everything included.</h2>
        <p className="text-muted-foreground mt-3 text-base">
          Try free for 7 days. No credit card required.
        </p>
      </div>

      <div className="max-w-lg mx-auto mt-10">
        {/* Pro card */}
        <div className="rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/5 to-primary/10 p-8 shadow-xl space-y-6">
          {/* Most Popular inline badge */}
          <div className="flex justify-center -mt-1 mb-2">
            <span className="bg-primary text-primary-foreground text-xs font-bold px-4 py-1 rounded-full">
              ⚡ Most Popular
            </span>
          </div>
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Pro Plan</p>
              <div className="flex items-baseline gap-2">
                <span className="text-6xl font-bold tracking-tight">{finalPrice}</span>
                {showDiscount && (
                  <span className="text-xl text-muted-foreground line-through">{originalPrice}</span>
                )}
                <span className="text-muted-foreground text-base">/month</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5">For growing restaurants</p>
            </div>
            <div className="bg-green-500/10 text-green-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-green-500/20 shrink-0 mt-1">
              7-day free trial
            </div>
          </div>

          {/* Features */}
          <div className="border-t border-primary/20 pt-5">
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-4">Everything you need</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {PRO_FEATURES.map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Coupon */}
          {restaurantId && (
            <div className="border-t border-primary/20 pt-5">
              <CouponInput
                plan="pro"
                restaurantId={restaurantId}
                planPricePaise={PRO_PRICE_PAISE}
                onApply={setCoupon}
              />
            </div>
          )}

          {/* CTA */}
          {onUpgrade ? (
            <Button
              size="lg"
              className="w-full text-base h-12 shadow-md"
              onClick={() => onUpgrade(coupon?.code)}
              disabled={upgrading}
            >
              <Zap className="h-5 w-5 mr-2" />
              {upgrading ? "Redirecting…" : "Start 7-day free trial"}
            </Button>
          ) : (
            <Button size="lg" className="w-full text-base h-12 shadow-md" asChild>
              <a href="/onboarding">
                <Zap className="h-5 w-5 mr-2" />
                Start 7-day free trial
              </a>
            </Button>
          )}

          <p className="text-xs text-center text-muted-foreground">
            Cancel anytime · No credit card required for trial
          </p>
        </div>
      </div>

      {/* Trust row */}
      <div className="mt-10 flex items-center justify-center gap-8 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          No setup fees
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          Cancel anytime
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          24/7 support
        </div>
      </div>
    </section>
  );
}

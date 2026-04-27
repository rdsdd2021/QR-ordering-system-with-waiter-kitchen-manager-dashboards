"use client";

import { useState, useEffect, useRef } from "react";
import {
  Check, Star, Zap, Building2, Diamond,
  Download, CreditCard, HeadphonesIcon,
  Loader2, ChevronRight, Pencil, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";
import { usePlans, type Plan as PlanDef } from "@/hooks/usePlans";
import CouponInput, { type CouponResult } from "@/components/CouponInput";
import { supabase } from "@/lib/supabase";

// ── Icon map — keyed by plan id ───────────────────────────────────────────────

const PLAN_ICONS: Record<string, { icon: React.ElementType; iconColor: string; iconBg: string }> = {
  starter:    { icon: Zap,      iconColor: "text-blue-500",   iconBg: "bg-blue-50"      },
  pro:        { icon: Star,     iconColor: "text-primary",    iconBg: "bg-primary/10"   },
  business:   { icon: Building2,iconColor: "text-purple-500", iconBg: "bg-purple-50"    },
  enterprise: { icon: Diamond,  iconColor: "text-amber-500",  iconBg: "bg-amber-50"     },
};

function getPlanIcon(id: string) {
  return PLAN_ICONS[id] ?? { icon: Star, iconColor: "text-primary", iconBg: "bg-primary/10" };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TxRow = {
  id: string;
  merchant_order_id: string;
  plan: string;
  amount_paise: number;
  status: string;
  coupon_code: string | null;
  created_at: string;
  completed_at: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function planLabel(planKey: string) {
  if (planKey.includes("yearly")) return "Pro Plan (Yearly)";
  if (planKey.includes("monthly")) return "Pro Plan (Monthly)";
  return `${planKey.charAt(0).toUpperCase() + planKey.slice(1)} Plan`;
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = { restaurantId: string; restaurantName?: string };

export default function BillingPanel({ restaurantId, restaurantName }: Props) {
  const { subscription, loading, isPro, isTrial, isExpired, startUpgrade } = useSubscription(restaurantId);
  const { plans, loading: plansLoading } = usePlans();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [showAllTx, setShowAllTx] = useState(false);

  // Billing address edit state
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressLine, setAddressLine] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(`billing_address_${restaurantId}`) ?? "";
    }
    return "";
  });
  const addressRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(50);
      setTransactions((data as TxRow[]) ?? []);
      setTxLoading(false);
    }
    load();
  }, [restaurantId]);

  useEffect(() => {
    if (editingAddress) addressRef.current?.focus();
  }, [editingAddress]);

  // Only paid Pro users have a "current plan" to highlight — trial/expired users are upgrading
  const currentPlanId = (isPro && !isTrial) ? "pro" : null;
  const renewalDate = (isPro && !isTrial && subscription?.current_period_end)
    ? fmtDate(subscription.current_period_end)
    : null;

  // Displayed transactions — 4 rows unless "View All" clicked
  const visibleTx = showAllTx ? transactions : transactions.slice(0, 4);

  // Pro plan from DB
  const proPlan = plans.find((p) => p.id === "pro");
  const proMonthlyPaise = proPlan?.monthly_paise ?? 99900;
  const proYearlyPaise  = proPlan?.yearly_paise  ?? 79900;
  const proPrice = billing === "monthly" ? proMonthlyPaise : proYearlyPaise;

  const discountedProPaise = coupon
    ? coupon.type === "percentage"
      ? proPrice - Math.round((proPrice * coupon.value) / 100)
      : Math.max(0, proPrice - Math.round(coupon.value * 100))
    : proPrice;

  async function handleChoosePlan(plan: PlanDef) {
    if (plan.cta === "contact") {
      window.open("mailto:support@qrorder.in?subject=Plan%20Enquiry%20-%20" + plan.name, "_blank");
      return;
    }
    if (plan.id === currentPlanId) return;
    if (plan.cta === "downgrade_unsupported") {
      window.open("mailto:support@qrorder.in?subject=Downgrade%20Request", "_blank");
      return;
    }
    setUpgrading(plan.id);
    await startUpgrade(window.location.href, coupon?.code, billing, `${plan.id}_${billing}`);
    setUpgrading(null);
  }

  function planPrice(p: PlanDef) {
    const price = billing === "monthly" ? p.monthly_paise : p.yearly_paise;
    return price === 0 ? null : price;
  }

  function ctaLabel(plan: PlanDef): string {
    if (plan.id === currentPlanId) return "Current Plan";
    if (plan.cta === "contact") return "Contact Sales";
    if (plan.cta === "downgrade_unsupported") return "Contact Support";
    if (plan.id === "pro") return `Upgrade — ${fmtRupees(discountedProPaise)}/mo`;
    return "Choose Plan";
  }

  function handleContactSupport() {
    window.open("mailto:support@qrorder.in?subject=Billing%20Support", "_blank");
  }

  if (loading || plansLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Plan selector ─────────────────────────────────────────────── */}
      <div data-plan-section className="rounded-xl border border-border bg-card p-6 card-shadow">
        <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="text-base font-semibold">Choose Your Plan</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Upgrade or downgrade your plan anytime</p>
          </div>
          {/* Monthly / Yearly toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-1 text-sm">
            <button
              onClick={() => { setBilling("monthly"); setCoupon(null); }}
              className={cn(
                "px-3 py-1 rounded-md font-medium transition-all",
                billing === "monthly" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => { setBilling("yearly"); setCoupon(null); }}
              className={cn(
                "px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5",
                billing === "yearly" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                billing === "yearly" ? "bg-white/20 text-white" : "bg-green-100 text-green-700"
              )}>
                {proMonthlyPaise > 0 && proYearlyPaise > 0
                  ? `Save ${Math.round((1 - proYearlyPaise / proMonthlyPaise) * 100)}%`
                  : "Save 20%"}
              </span>
            </button>
          </div>
        </div>

        {/* Plan cards — exclude "free" since there's no free tier, only trial + paid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.filter(p => p.id !== "free").map((plan) => {
            const { icon: PlanIcon, iconColor, iconBg } = getPlanIcon(plan.id);
            const price = planPrice(plan);
            const isCurrent = plan.id === currentPlanId;
            const isLoadingThis = upgrading === plan.id;
            const isDisabled = !!upgrading;

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-xl border p-4 flex flex-col transition-all",
                  plan.is_highlighted && !isCurrent
                    ? "border-primary/40 bg-primary/[0.03]"
                    : "border-border bg-card",
                  isCurrent && "border-primary ring-1 ring-primary/20"
                )}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-white text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
                      Current Plan
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2.5 mb-3 mt-1">
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
                    <PlanIcon className={cn("h-4 w-4", iconColor)} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{plan.name}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">{plan.tagline}</p>
                  </div>
                </div>

                <div className="mb-4">
                  {price !== null ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold">{fmtRupees(price)}</span>
                      <span className="text-xs text-muted-foreground">
                        {billing === "yearly" ? "/mo (billed yearly)" : "/month"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-2xl font-bold">Custom</span>
                  )}
                </div>

                {/* CTA */}
                {isCurrent ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-primary text-primary mb-4 cursor-default"
                    disabled
                  >
                    Current Plan
                  </Button>
                ) : plan.cta === "contact" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-amber-400 text-amber-600 hover:bg-amber-50 mb-4"
                    onClick={() => handleChoosePlan(plan)}
                  >
                    Contact Sales
                  </Button>
                ) : plan.cta === "downgrade_unsupported" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mb-4 text-muted-foreground"
                    onClick={() => handleChoosePlan(plan)}
                    disabled={isDisabled}
                  >
                    Contact Support
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full mb-4"
                    onClick={() => handleChoosePlan(plan)}
                    disabled={isDisabled}
                  >
                    {isLoadingThis
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : ctaLabel(plan)
                    }
                  </Button>
                )}

                {/* Features */}
                <div className="space-y-1.5 flex-1">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-xs">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                  {plan.unavailable.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-xs text-muted-foreground/50">
                      <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/25 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>

                {/* Coupon — only on Pro card for non-paid users (free, trial, expired) */}
                {plan.id === "pro" && !(isPro && !isTrial) && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <CouponInput
                      plan="pro"
                      restaurantId={restaurantId}
                      planPricePaise={proPrice}
                      onApply={setCoupon}
                    />
                    {coupon && discountedProPaise < proPrice && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Final:{" "}
                        <span className="font-semibold text-foreground">{fmtRupees(discountedProPaise)}/mo</span>
                        <span className="line-through ml-1.5 text-muted-foreground/60">{fmtRupees(proPrice)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5">
          <Check className="h-3 w-3 text-green-500 shrink-0" />
          All plans include: Order Management, Table Management, Customer Management &amp; Regular Updates
        </p>
      </div>

      {/* ── Bottom layout ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Billing history */}
        <div className="xl:col-span-2 rounded-xl border border-border bg-card p-6 card-shadow">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Billing History</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Your past invoices and transactions</p>
            </div>
            {transactions.length > 4 && (
              <button
                onClick={() => setShowAllTx((v) => !v)}
                className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
              >
                {showAllTx ? "Show Less" : "View All Invoices"}
                <ChevronRight className={cn("h-3 w-3 transition-transform", showAllTx && "rotate-90")} />
              </button>
            )}
          </div>

          {txLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <CreditCard className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No transactions yet</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Your billing history will appear here after your first payment</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Invoice ID", "Date", "Plan", "Amount", "Status", "Invoice"].map((h) => (
                      <th key={h} className="text-left text-xs font-medium text-muted-foreground pb-2.5 pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleTx.map((tx, i) => {
                    const invNum = `INV-${new Date(tx.created_at).getFullYear()}-${String(transactions.indexOf(tx) + 1).padStart(4, "0")}`;
                    return (
                      <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{invNum}</td>
                        <td className="py-3 pr-4 text-sm">{fmtDate(tx.created_at)}</td>
                        <td className="py-3 pr-4 text-sm">{planLabel(tx.plan)}</td>
                        <td className="py-3 pr-4 text-sm font-medium">{fmtRupees(tx.amount_paise)}</td>
                        <td className="py-3 pr-4">
                          <span className={cn(
                            "text-[11px] font-semibold px-2 py-0.5 rounded-full",
                            tx.status === "completed" ? "bg-green-100 text-green-700" :
                            tx.status === "failed"    ? "bg-red-100 text-red-600" :
                                                        "bg-yellow-100 text-yellow-700"
                          )}>
                            {tx.status === "completed" ? "Paid" : tx.status === "failed" ? "Failed" : "Pending"}
                          </span>
                        </td>
                        <td className="py-3">
                          {tx.status === "completed" ? (
                            <button
                              onClick={() => {
                                // Generate a formatted HTML receipt and trigger download
                                const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${invNum}</title>
<style>body{font-family:monospace;font-size:13px;padding:20px;max-width:320px;margin:0 auto}
h2{text-align:center;margin:0 0 4px}
.sub{text-align:center;color:#555;margin-bottom:12px;font-size:11px}
hr{border:none;border-top:1px dashed #999;margin:8px 0}
.row{display:flex;justify-content:space-between;margin:3px 0}
.total{font-weight:bold;font-size:15px}
.footer{text-align:center;margin-top:12px;font-size:11px;color:#777}
</style></head><body>
<h2>Receipt</h2>
<p class="sub">${invNum} · ${fmtDate(tx.created_at)}</p>
<hr/>
${transactions.find(t => t.id === tx.id) ? '' : ''}
<div class="row"><span>Plan</span><span>${planLabel(tx.plan)}</span></div>
<div class="row total"><span>Amount</span><span>${fmtRupees(tx.amount_paise)}</span></div>
<div class="row"><span>Status</span><span>Paid</span></div>
<div class="row"><span>Transaction ID</span><span style="font-size:10px">${tx.merchant_order_id}</span></div>
<hr/>
<p class="footer">Thank you for your business!</p>
</body></html>`;
                                const blob = new Blob([html], { type: "text/html" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `${invNum}.html`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Download className="h-3 w-3" /> Download
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">

          {/* Current plan */}
          <div className="rounded-xl border border-border bg-card p-4 card-shadow">
            <h3 className="text-sm font-semibold mb-3">Current Plan</h3>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Star className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {isTrial ? "Trial" : (isPro && !isTrial) ? "Pro" : "Trial Expired"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {isTrial ? "7-day trial · all features included" : isPro ? "Full access · all features" : "Upgrade to restore access"}
                </p>
              </div>
            </div>
            <div className="mb-3">
              {isTrial ? (
                <span className="text-2xl font-bold text-green-600">Free</span>
              ) : isPro ? (
                <>
                  <span className="text-2xl font-bold">
                    {(() => {
                      const lastCompleted = transactions.find(t => t.status === "completed");
                      return lastCompleted?.plan?.includes("yearly")
                        ? fmtRupees(proYearlyPaise)
                        : fmtRupees(proMonthlyPaise);
                    })()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {transactions.find(t => t.status === "completed")?.plan?.includes("yearly")
                      ? "/mo (yearly)" : "/month"}
                  </span>
                </>
              ) : (
                <span className="text-sm text-destructive font-medium">No active subscription</span>
              )}
            </div>
            {isTrial && subscription?.current_period_end ? (
              <p className="text-xs text-amber-600 font-medium mb-3">
                Trial ends {fmtDate(subscription.current_period_end)}
              </p>
            ) : renewalDate ? (
              <p className="text-xs text-muted-foreground mb-3">
                Plan renews on<br />
                <span className="font-medium text-foreground">{renewalDate}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mb-3">
                {isExpired ? "Trial expired — upgrade to continue" : "Upgrade to unlock all features"}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full border-primary text-primary hover:bg-primary hover:text-white"
              onClick={() => {
                // Scroll the plan cards into view
                document.querySelector("[data-plan-section]")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Manage Plan
            </Button>
          </div>

          {/* Payment method */}
          <div className="rounded-xl border border-border bg-card p-4 card-shadow">
            <h3 className="text-sm font-semibold mb-3">Payment Method</h3>
            {isPro && transactions.some((t) => t.status === "completed") ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30 mb-3">
                <div className="h-8 w-12 rounded bg-[#5f259f] flex items-center justify-center shrink-0">
                  <span className="text-white text-[8px] font-bold leading-tight text-center">Phone<br/>Pe</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">PhonePe</p>
                  <p className="text-[11px] text-muted-foreground">Last payment via UPI</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mb-3">No payment method on file</p>
            )}
            <button
              onClick={() => {
                if (!isPro) {
                  const proPlan = plans.find(p => p.id === "pro");
                  if (proPlan) handleChoosePlan(proPlan);
                } else {
                  window.open("mailto:support@qrorder.in?subject=Update%20Payment%20Method", "_blank");
                }
              }}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-primary border border-dashed border-primary/40 rounded-lg py-2 hover:bg-primary/5 transition-colors"
            >
              <span className="text-base leading-none">+</span>
              {isPro ? "Update Payment Method" : "Add Payment Method"}
            </button>
          </div>

          {/* Billing address */}
          <div className="rounded-xl border border-border bg-card p-4 card-shadow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Billing Address</h3>
              <button
                onClick={() => setEditingAddress((v) => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                title={editingAddress ? "Cancel" : "Edit address"}
              >
                {editingAddress ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              </button>
            </div>
            {editingAddress ? (
              <div className="space-y-2">
                <Input
                  ref={addressRef}
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  placeholder="Street, City, State, PIN"
                  className="text-xs h-8"
                />
                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={() => {
                    localStorage.setItem(`billing_address_${restaurantId}`, addressLine);
                    setEditingAddress(false);
                  }}
                >
                  Save Address
                </Button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium text-foreground">{restaurantName ?? "Your Restaurant"}</p>
                {addressLine ? <p>{addressLine}</p> : <p>India</p>}
              </div>
            )}
          </div>

          {/* Need help */}
          <div className="rounded-xl border border-border bg-card p-4 card-shadow">
            <div className="flex items-center gap-2 mb-2">
              <HeadphonesIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="text-sm font-semibold">Need Help?</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Our team is here to help you with any billing related queries.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={handleContactSupport}
            >
              Contact Support
            </Button>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <Check className="h-3 w-3 text-green-500 shrink-0" />
          All payments are secure and encrypted.
        </div>
        <p>
          Need help with billing?{" "}
          <button
            onClick={handleContactSupport}
            className="text-primary hover:underline font-medium"
          >
            Contact Support
          </button>
        </p>
      </div>

    </div>
  );
}

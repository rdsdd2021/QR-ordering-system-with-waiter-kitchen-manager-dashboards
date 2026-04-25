"use client";

import { useState, useEffect, useRef } from "react";
import {
  Check, Star, Zap, Building2, Diamond,
  Download, CreditCard, MapPin, HeadphonesIcon,
  Loader2, ChevronRight, Pencil, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";
import CouponInput, { type CouponResult } from "@/components/CouponInput";
import { supabase } from "@/lib/supabase";

// ── Plan definitions ──────────────────────────────────────────────────────────

type PlanId = "starter" | "pro" | "business" | "enterprise";

type PlanDef = {
  id: PlanId;
  name: string;
  tagline: string;
  /** paise — 0 means custom/contact */
  monthlyPaise: number;
  yearlyPaise: number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  features: string[];
  unavailable?: string[];
  /** which PhonePe plan key to use */
  planKey?: "pro_monthly" | "pro_yearly";
  cta: "choose" | "current" | "contact" | "downgrade_unsupported";
  highlight?: boolean;
};

const PLANS: PlanDef[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Perfect for getting started",
    monthlyPaise: 49900,
    yearlyPaise: 39900,
    icon: Zap,
    iconColor: "text-blue-500",
    iconBg: "bg-blue-50",
    features: ["Up to 5 Tables", "Basic Reports", "Menu Management", "1 Staff Account"],
    unavailable: ["Priority Support"],
    cta: "downgrade_unsupported", // can't downgrade via self-serve
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Best for growing restaurants",
    monthlyPaise: 99900,
    yearlyPaise: 79900,
    icon: Star,
    iconColor: "text-primary",
    iconBg: "bg-primary/10",
    features: ["Up to 20 Tables", "Advanced Reports", "Menu & Modifier Management", "5 Staff Accounts", "Priority Support"],
    planKey: "pro_monthly", // overridden at runtime based on billing cycle
    cta: "choose",
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    tagline: "For established businesses",
    monthlyPaise: 199900,
    yearlyPaise: 159900,
    icon: Building2,
    iconColor: "text-purple-500",
    iconBg: "bg-purple-50",
    features: ["Up to 50 Tables", "Advanced Reports", "Menu & Modifier Management", "15 Staff Accounts", "Priority Support", "Custom Roles"],
    cta: "contact", // not yet available — route to sales
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For large scale operations",
    monthlyPaise: 0,
    yearlyPaise: 0,
    icon: Diamond,
    iconColor: "text-amber-500",
    iconBg: "bg-amber-50",
    features: ["Unlimited Tables", "Advanced Reports", "Menu & Modifier Management", "Unlimited Staff Accounts", "Priority Support", "Dedicated Account Manager", "API Access"],
    cta: "contact",
  },
];

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
  const { subscription, loading, isPro, startUpgrade } = useSubscription(restaurantId);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [coupon, setCoupon] = useState<CouponResult | null>(null);
  const [upgrading, setUpgrading] = useState<PlanId | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [showAllTx, setShowAllTx] = useState(false);

  // Billing address edit state
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressLine, setAddressLine] = useState("");
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

  const currentPlanId: PlanId = isPro ? "pro" : "starter";
  const renewalDate = subscription?.current_period_end
    ? fmtDate(subscription.current_period_end)
    : null;

  // Displayed transactions — 4 rows unless "View All" clicked
  const visibleTx = showAllTx ? transactions : transactions.slice(0, 4);

  // Pro price for the selected billing cycle
  const proMonthlyPaise = PLANS[1].monthlyPaise;
  const proYearlyPaise  = PLANS[1].yearlyPaise;
  const proPrice = billing === "monthly" ? proMonthlyPaise : proYearlyPaise;

  const discountedProPaise = coupon
    ? coupon.type === "percentage"
      ? proPrice - Math.round((proPrice * coupon.value) / 100)
      : Math.max(0, proPrice - Math.round(coupon.value * 100))
    : proPrice;

  async function handleChoosePlan(plan: PlanDef) {
    // Only Pro is purchasable right now; Business/Enterprise go to contact
    if (plan.cta === "contact" || plan.id === "business" || plan.id === "enterprise") {
      window.open(
        "mailto:support@qrorder.in?subject=Plan%20Enquiry%20-%20" + plan.name,
        "_blank"
      );
      return;
    }
    if (plan.id === currentPlanId) return;
    if (plan.cta === "downgrade_unsupported") {
      // Downgrade not self-serve — open support
      window.open("mailto:support@qrorder.in?subject=Downgrade%20Request", "_blank");
      return;
    }
    // Pro upgrade
    setUpgrading(plan.id);
    await startUpgrade(window.location.href, coupon?.code, billing);
    setUpgrading(null);
  }

  function planPrice(p: PlanDef) {
    if (p.monthlyPaise === 0) return null;
    return billing === "monthly" ? p.monthlyPaise : p.yearlyPaise;
  }

  function ctaLabel(plan: PlanDef): string {
    if (plan.id === currentPlanId) return "Current Plan";
    if (plan.cta === "contact") return "Contact Sales";
    if (plan.cta === "downgrade_unsupported") return "Contact Support";
    if (plan.id === "pro") {
      const price = fmtRupees(discountedProPaise);
      return `Upgrade — ${price}/mo`;
    }
    return "Choose Plan";
  }

  function handleContactSupport() {
    window.open("mailto:support@qrorder.in?subject=Billing%20Support", "_blank");
  }

  if (loading) {
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
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const price = planPrice(plan);
            const isCurrent = plan.id === currentPlanId;
            const isLoadingThis = upgrading === plan.id;
            const isDisabled = !!upgrading;

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative rounded-xl border p-4 flex flex-col transition-all",
                  plan.highlight && !isCurrent
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
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", plan.iconBg)}>
                    <plan.icon className={cn("h-4 w-4", plan.iconColor)} />
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
                      <span className="text-xs text-muted-foreground">/month</span>
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
                  {plan.unavailable?.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-xs text-muted-foreground/50">
                      <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/25 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>

                {/* Coupon — only on Pro card for non-pro users */}
                {plan.id === "pro" && !isPro && (
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
                                // Generate a simple text receipt and trigger download
                                const lines = [
                                  `Invoice: ${invNum}`,
                                  `Date: ${fmtDate(tx.created_at)}`,
                                  `Plan: ${planLabel(tx.plan)}`,
                                  `Amount: ${fmtRupees(tx.amount_paise)}`,
                                  `Status: Paid`,
                                  `Transaction ID: ${tx.merchant_order_id}`,
                                ].join("\n");
                                const blob = new Blob([lines], { type: "text/plain" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `${invNum}.txt`;
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
                <p className="font-semibold text-sm">{isPro ? "Pro Plan" : "Starter Plan"}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isPro ? "Up to 20 Tables · Up to 5 Staff" : "Up to 5 Tables · 1 Staff"}
                </p>
              </div>
            </div>
            <div className="mb-3">
              <span className="text-2xl font-bold">{isPro ? fmtRupees(proMonthlyPaise) : fmtRupees(49900)}</span>
              <span className="text-xs text-muted-foreground">/month</span>
            </div>
            {renewalDate ? (
              <p className="text-xs text-muted-foreground mb-3">
                Plan renews on<br />
                <span className="font-medium text-foreground">{renewalDate}</span>
              </p>
            ) : !isPro ? (
              <p className="text-xs text-muted-foreground mb-3">Free tier — no renewal</p>
            ) : null}
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
                // PhonePe doesn't support saved payment methods — redirect to upgrade flow
                if (!isPro) {
                  handleChoosePlan(PLANS[1]);
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
                  onClick={() => setEditingAddress(false)}
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

import Stripe from "stripe";

// Server-side Stripe client — only used in API routes / server actions
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY environment variable");
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

export const STRIPE_PLANS = {
  pro: {
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? "",
    name: "Pro",
    price: 2999, // ₹29.99/month in paise
    currency: "inr",
  },
} as const;

export type PlanId = keyof typeof STRIPE_PLANS;

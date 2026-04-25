import { StandardCheckoutClient, Env } from "pg-sdk-node";

export function getPhonePeClient(): StandardCheckoutClient {
  const clientId      = process.env.PHONEPE_CLIENT_ID!;
  const clientSecret  = process.env.PHONEPE_CLIENT_SECRET!;
  const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION ?? "1", 10);
  const isProd        = process.env.PHONEPE_ENV === "production";

  if (!clientId || !clientSecret) {
    throw new Error("Missing PHONEPE_CLIENT_ID or PHONEPE_CLIENT_SECRET");
  }

  // Clear the SDK singleton so it always picks up the current env credentials
  // SDK checks `=== undefined`, so set to undefined not null
  (StandardCheckoutClient as unknown as { _client: unknown })._client = undefined;

  return StandardCheckoutClient.getInstance(
    clientId,
    clientSecret,
    clientVersion,
    isProd ? Env.PRODUCTION : Env.SANDBOX
  );
}

export const PHONEPE_PLANS = {
  pro_monthly: {
    name: "Pro (Monthly)",
    amountPaise: 99900, // ₹999/month
  },
  pro_yearly: {
    name: "Pro (Yearly)",
    amountPaise: 79900 * 12, // ₹799/month billed annually
  },
  pro: {
    name: "Pro",
    amountPaise: 99900,
  },
} as const;

export type PlanId = keyof typeof PHONEPE_PLANS;

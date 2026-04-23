import { StandardCheckoutClient, Env } from "pg-sdk-node";

const clientId      = process.env.PHONEPE_CLIENT_ID!;
const clientSecret  = process.env.PHONEPE_CLIENT_SECRET!;
const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION ?? "1", 10);
const isProd        = process.env.PHONEPE_ENV === "production";

export function getPhonePeClient(): StandardCheckoutClient {
  if (!clientId || !clientSecret) {
    throw new Error("Missing PHONEPE_CLIENT_ID or PHONEPE_CLIENT_SECRET");
  }
  return StandardCheckoutClient.getInstance(
    clientId,
    clientSecret,
    clientVersion,
    isProd ? Env.PRODUCTION : Env.SANDBOX
  );
}

export const PHONEPE_PLANS = {
  pro: {
    name: "Pro",
    amountPaise: 79900, // ₹799/month in paise
  },
} as const;

export type PlanId = keyof typeof PHONEPE_PLANS;

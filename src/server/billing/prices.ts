import { isPlanId, type PlanId } from "@/server/entitlements/plans";
import { isStripeConfigured } from "@/server/payments/providers/stripe-config";

/** Paid plans that require a Stripe Price ID for SaaS Checkout. Free has no price. */
export const PAID_PLAN_IDS = ["starter", "pro", "business"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

const PRICE_ENV_BY_PLAN: Record<PaidPlanId, string> = {
  starter: "STRIPE_PRICE_STARTER",
  pro: "STRIPE_PRICE_PRO",
  business: "STRIPE_PRICE_BUSINESS",
};

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

export function getConfiguredStripePriceId(planId: PaidPlanId): string | null {
  const envName = PRICE_ENV_BY_PLAN[planId];
  const value = process.env[envName]?.trim() || "";
  return value || null;
}

/** Application plan → Stripe Price ID (server env only). */
export function mapPlanToStripePriceId(planId: PlanId): string | null {
  if (planId === "free") return null;
  if (!isPaidPlanId(planId)) return null;
  return getConfiguredStripePriceId(planId);
}

/** Stripe Price ID → application plan. Unknown prices return null (never grant entitlements). */
export function mapStripePriceIdToPlan(priceId: string): PlanId | null {
  const normalized = priceId.trim();
  if (!normalized) return null;

  for (const planId of PAID_PLAN_IDS) {
    const configured = getConfiguredStripePriceId(planId);
    if (configured && configured === normalized) return planId;
  }
  return null;
}

export function isSaasBillingConfigured() {
  if (!isStripeConfigured()) return false;
  return PAID_PLAN_IDS.some((planId) => Boolean(getConfiguredStripePriceId(planId)));
}

export function listBillablePlans() {
  return PAID_PLAN_IDS.map((planId) => ({
    planId,
    priceConfigured: Boolean(getConfiguredStripePriceId(planId)),
  }));
}

export function assertRecognizedPaidPlan(planId: unknown): PaidPlanId {
  if (!isPlanId(planId) || !isPaidPlanId(planId)) {
    throw new Error("INVALID_PLAN");
  }
  return planId;
}

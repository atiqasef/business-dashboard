/**
 * Central plan / entitlement definitions for the SaaS foundation.
 *
 * Pricing and Stripe subscription billing are intentionally separate and NOT implemented here.
 * These values are technical entitlements only — not commercial pricing.
 *
 * Compatibility note (Phase 20):
 * - Existing business documents continue to use `ownerId` (= Better Auth user id).
 * - `organizations.ownerUserId` maps 1:1 to that same id for now.
 * - Future phases may introduce organizationId on business docs + memberships.
 */

export const PLAN_IDS = ["free", "starter", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PLAN_FEATURES = [
  "reports",
  "aiAssistant",
  "proactiveInsights",
  "aiInsightSummary",
  "invoicePortal",
  "customerPortal",
  "stripeInvoicePayments",
  "automatedReminders",
  "invoicePdf",
  "invoiceEmail",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_LIMIT_RESOURCES = [
  "customers",
  "products",
  "orders",
  "invoices",
  "monthlyAiQueries",
] as const;
export type PlanLimitResource = (typeof PLAN_LIMIT_RESOURCES)[number];

/** `null` means unlimited for that resource. */
export type PlanLimits = Record<PlanLimitResource, number | null>;

export type PlanDefinition = {
  id: PlanId;
  name: string;
  limits: PlanLimits;
  features: Record<PlanFeature, boolean>;
};

/** Default plan for newly provisioned organizations. */
export const DEFAULT_PLAN_ID: PlanId = "free";

const CORE_FEATURES_ON: Pick<
  PlanDefinition["features"],
  | "reports"
  | "proactiveInsights"
  | "invoicePortal"
  | "customerPortal"
  | "stripeInvoicePayments"
  | "automatedReminders"
  | "invoicePdf"
  | "invoiceEmail"
> = {
  reports: true,
  proactiveInsights: true,
  invoicePortal: true,
  customerPortal: true,
  stripeInvoicePayments: true,
  automatedReminders: true,
  invoicePdf: true,
  invoiceEmail: true,
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    limits: {
      customers: 200,
      products: 200,
      orders: 2_000,
      invoices: 2_000,
      monthlyAiQueries: 0,
    },
    features: {
      ...CORE_FEATURES_ON,
      aiAssistant: false,
      aiInsightSummary: false,
    },
  },
  starter: {
    id: "starter",
    name: "Starter",
    limits: {
      customers: 500,
      products: 500,
      orders: 5_000,
      invoices: 5_000,
      monthlyAiQueries: 250,
    },
    features: {
      ...CORE_FEATURES_ON,
      aiAssistant: true,
      aiInsightSummary: true,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    limits: {
      customers: 2_000,
      products: 2_000,
      orders: 25_000,
      invoices: 25_000,
      monthlyAiQueries: 1_000,
    },
    features: {
      ...CORE_FEATURES_ON,
      aiAssistant: true,
      aiInsightSummary: true,
    },
  },
  business: {
    id: "business",
    name: "Business",
    limits: {
      customers: null,
      products: null,
      orders: null,
      invoices: null,
      monthlyAiQueries: 10_000,
    },
    features: {
      ...CORE_FEATURES_ON,
      aiAssistant: true,
      aiInsightSummary: true,
    },
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function getPlanDefinition(planId: PlanId): PlanDefinition {
  return PLANS[planId];
}

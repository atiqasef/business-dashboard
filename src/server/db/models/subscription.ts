import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";
import type { PlanId } from "@/server/entitlements/plans";

/**
 * SaaS subscription records (organization billing).
 * Independent from customer invoice Stripe Checkout payments.
 */
export const SUBSCRIPTION_PROVIDER = "stripe" as const;

export const subscriptionStatuses = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export interface SubscriptionDocument {
  _id?: ObjectId;
  organizationId: ObjectId;
  planId: PlanId;
  provider: typeof SUBSCRIPTION_PROVIDER;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: SubscriptionStatus;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getSubscriptionsCollection(): Collection<SubscriptionDocument> {
  return db.collection<SubscriptionDocument>("subscriptions");
}

export async function ensureSubscriptionIndexes() {
  if (!indexesPromise) {
    indexesPromise = getSubscriptionsCollection()
      .createIndexes([
        { key: { organizationId: 1 }, name: "organizationId_unique", unique: true },
        { key: { stripeSubscriptionId: 1 }, name: "stripeSubscriptionId_unique", unique: true },
        {
          key: { stripeCustomerId: 1 },
          name: "stripeCustomerId_unique",
          unique: true,
          partialFilterExpression: { stripeCustomerId: { $type: "string" } },
        },
      ])
      .then(() => undefined);
  }
  return indexesPromise;
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (subscriptionStatuses as readonly string[]).includes(value);
}

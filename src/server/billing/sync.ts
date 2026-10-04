import type Stripe from "stripe";
import { ObjectId } from "mongodb";
import {
  ensureOrganizationIndexes,
  getOrganizationsCollection,
  type OrganizationDocument,
} from "@/server/db/models/organization";
import {
  ensureSubscriptionIndexes,
  getSubscriptionsCollection,
  isSubscriptionStatus,
  SUBSCRIPTION_PROVIDER,
  type SubscriptionDocument,
  type SubscriptionStatus,
} from "@/server/db/models/subscription";
import { mapStripePriceIdToPlan } from "@/server/billing/prices";
import { findOrganizationByStripeCustomerId } from "@/server/billing/customer";
import { DEFAULT_PLAN_ID, type PlanId } from "@/server/entitlements/plans";
import { resolveEffectivePlanId } from "@/server/billing/effective-plan";

function asUnixDate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value * 1000);
}

function extractSubscriptionPriceId(subscription: Stripe.Subscription): string | null {
  const item = subscription.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;
  if (typeof price === "string") return price;
  if (typeof price === "object" && typeof price.id === "string") return price.id;
  return null;
}

function extractCustomerId(subscription: Stripe.Subscription): string | null {
  if (typeof subscription.customer === "string") return subscription.customer;
  if (subscription.customer && typeof subscription.customer === "object" && "id" in subscription.customer) {
    const id = (subscription.customer as { id?: string }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function normalizeStatus(status: string): SubscriptionStatus | null {
  return isSubscriptionStatus(status) ? status : null;
}

async function resolveOrganizationForSubscription(
  subscription: Stripe.Subscription,
  stripeCustomerId: string,
): Promise<OrganizationDocument | null> {
  const metaOrgId = subscription.metadata?.organizationId?.trim();
  if (metaOrgId && ObjectId.isValid(metaOrgId)) {
    await ensureOrganizationIndexes();
    const byMeta = await getOrganizationsCollection().findOne({ _id: new ObjectId(metaOrgId) });
    if (byMeta?.stripeCustomerId && byMeta.stripeCustomerId !== stripeCustomerId) {
      // Metadata must not override a different org's Stripe customer.
      return null;
    }
    if (byMeta && (!byMeta.stripeCustomerId || byMeta.stripeCustomerId === stripeCustomerId)) {
      if (!byMeta.stripeCustomerId) {
        await getOrganizationsCollection().updateOne(
          { _id: byMeta._id },
          { $set: { stripeCustomerId, updatedAt: new Date() } },
        );
        return { ...byMeta, stripeCustomerId };
      }
      return byMeta;
    }
  }

  return findOrganizationByStripeCustomerId(stripeCustomerId);
}

/**
 * Sync a Stripe Subscription into local subscription + organization.planId.
 * Unknown price IDs do not grant paid entitlements.
 */
export async function syncStripeSubscription(subscription: Stripe.Subscription): Promise<{
  ok: boolean;
  ignored?: boolean;
  reason?: string;
}> {
  await ensureSubscriptionIndexes();
  await ensureOrganizationIndexes();

  const stripeCustomerId = extractCustomerId(subscription);
  if (!stripeCustomerId) {
    return { ok: false, ignored: true, reason: "missing_customer" };
  }

  const organization = await resolveOrganizationForSubscription(subscription, stripeCustomerId);
  if (!organization?._id) {
    return { ok: false, ignored: true, reason: "unknown_customer" };
  }

  const status = normalizeStatus(subscription.status);
  if (!status) {
    return { ok: false, ignored: true, reason: "unknown_status" };
  }

  const stripePriceId = extractSubscriptionPriceId(subscription);
  const mappedPlan = stripePriceId ? mapStripePriceIdToPlan(stripePriceId) : null;

  // Unknown / missing price → never grant paid plan. Keep Free locally.
  const planId: PlanId = mappedPlan ?? DEFAULT_PLAN_ID;
  if (!mappedPlan && status !== "canceled" && status !== "incomplete_expired") {
    // Still persist subscription status for observability, but force Free entitlements.
  }

  const now = new Date();
  const period = subscription as unknown as {
    current_period_start?: number | null;
    current_period_end?: number | null;
  };
  const doc: Omit<SubscriptionDocument, "_id"> = {
    organizationId: organization._id,
    planId,
    provider: SUBSCRIPTION_PROVIDER,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: stripePriceId || "unknown",
    status,
    currentPeriodStart: asUnixDate(period.current_period_start),
    currentPeriodEnd: asUnixDate(period.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: asUnixDate(subscription.canceled_at),
    trialStart: asUnixDate(subscription.trial_start),
    trialEnd: asUnixDate(subscription.trial_end),
    createdAt: now,
    updatedAt: now,
  };

  const existing = await getSubscriptionsCollection().findOne({ organizationId: organization._id });
  if (existing) {
    await getSubscriptionsCollection().updateOne(
      { organizationId: organization._id },
      {
        $set: {
          planId: doc.planId,
          stripeCustomerId: doc.stripeCustomerId,
          stripeSubscriptionId: doc.stripeSubscriptionId,
          stripePriceId: doc.stripePriceId,
          status: doc.status,
          currentPeriodStart: doc.currentPeriodStart,
          currentPeriodEnd: doc.currentPeriodEnd,
          cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
          canceledAt: doc.canceledAt,
          trialStart: doc.trialStart,
          trialEnd: doc.trialEnd,
          updatedAt: now,
        },
      },
    );
  } else {
    try {
      await getSubscriptionsCollection().insertOne({ ...doc });
    } catch (error) {
      const duplicate =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === 11000;
      if (!duplicate) throw error;
      await getSubscriptionsCollection().updateOne(
        { stripeSubscriptionId: subscription.id },
        {
          $set: {
            organizationId: organization._id,
            planId: doc.planId,
            stripeCustomerId: doc.stripeCustomerId,
            stripePriceId: doc.stripePriceId,
            status: doc.status,
            currentPeriodStart: doc.currentPeriodStart,
            currentPeriodEnd: doc.currentPeriodEnd,
            cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
            canceledAt: doc.canceledAt,
            trialStart: doc.trialStart,
            trialEnd: doc.trialEnd,
            updatedAt: now,
          },
        },
      );
    }
  }

  const persisted = await getSubscriptionsCollection().findOne({ organizationId: organization._id });
  const effectivePlanId = resolveEffectivePlanId(organization, persisted, now);

  await getOrganizationsCollection().updateOne(
    { _id: organization._id },
    {
      $set: {
        planId: effectivePlanId,
        stripeCustomerId,
        updatedAt: now,
      },
    },
  );

  return { ok: true, ignored: !mappedPlan && status !== "canceled" ? true : false };
}

export async function getSubscriptionForOrganization(organizationId: ObjectId) {
  await ensureSubscriptionIndexes();
  return getSubscriptionsCollection().findOne({ organizationId });
}

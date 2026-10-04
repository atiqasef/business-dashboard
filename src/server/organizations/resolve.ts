import { ObjectId } from "mongodb";
import { resolveEffectivePlanId } from "@/server/billing/effective-plan";
import { isSaasBillingConfigured, listBillablePlans } from "@/server/billing/prices";
import { getSubscriptionForOrganization } from "@/server/billing/sync";
import type { OrganizationDocument } from "@/server/db/models/organization";
import type { SubscriptionDocument } from "@/server/db/models/subscription";
import {
  buildOrganizationEntitlements,
  type OrganizationEntitlements,
} from "@/server/entitlements/service";
import { ensureOrganizationForUser } from "@/server/organizations/provision";

export type ResolvedOrganizationContext = {
  /** Same value as existing business-document `ownerId`. Not for client exposure. */
  ownerUserId: string;
  organization: OrganizationDocument;
  subscription: SubscriptionDocument | null;
  effectivePlanId: OrganizationDocument["planId"];
  entitlements: OrganizationEntitlements;
};

/**
 * Session user → organization → subscription → effective plan → entitlements.
 * Never accepts browser-supplied organizationId / planId.
 */
export async function resolveOrganizationForUser(
  ownerUserId: string,
  options?: { displayName?: string },
): Promise<ResolvedOrganizationContext> {
  const organization = await ensureOrganizationForUser(ownerUserId, options);
  const subscription = organization._id
    ? await getSubscriptionForOrganization(organization._id)
    : null;
  const effectivePlanId = resolveEffectivePlanId(organization, subscription);
  const entitlements = buildOrganizationEntitlements({
    planId: effectivePlanId,
    status: organization.status,
  });
  return { ownerUserId, organization, subscription, effectivePlanId, entitlements };
}

function toPublicSubscription(subscription: SubscriptionDocument | null) {
  if (!subscription) {
    return {
      status: "none" as const,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null as string | null,
      currentPeriodStart: null as string | null,
    };
  }

  return {
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
  };
}

export function toPublicOrganizationResponse(context: ResolvedOrganizationContext) {
  const { organization, entitlements, subscription, effectivePlanId } = context;
  return {
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    plan: {
      id: effectivePlanId,
      name: entitlements.plan.name,
    },
    features: entitlements.features,
    limits: entitlements.limits,
    subscription: toPublicSubscription(subscription),
    billing: {
      subscriptionBilling: isSaasBillingConfigured()
        ? ("configured" as const)
        : ("not_configured" as const),
      note: isSaasBillingConfigured()
        ? "SaaS subscriptions are managed through Stripe. Customer invoice Checkout is separate."
        : "SaaS subscription billing is not configured. The Free plan remains available. Invoice Stripe Checkout is independent.",
      availablePlans: listBillablePlans().map((entry) => ({
        id: entry.planId,
        checkoutAvailable: entry.priceConfigured,
      })),
    },
  };
}

/** Internal helper for tests — never expose ObjectIds to clients. */
export function organizationObjectId(organization: OrganizationDocument): ObjectId | null {
  return organization._id ?? null;
}

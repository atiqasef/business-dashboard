import { getCustomersCollection } from "@/server/db/models/customer";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getOrdersCollection } from "@/server/db/models/order";
import type { OrganizationDocument } from "@/server/db/models/organization";
import { getProductsCollection } from "@/server/db/models/product";
import {
  getPlanDefinition,
  type PlanDefinition,
  type PlanFeature,
  type PlanId,
  type PlanLimitResource,
} from "@/server/entitlements/plans";
import {
  organizationSuspendedError,
  planFeatureDeniedError,
  planLimitReachedError,
} from "@/server/entitlements/errors";

export type OrganizationEntitlements = {
  plan: PlanDefinition;
  status: OrganizationDocument["status"];
  features: PlanDefinition["features"];
  limits: PlanDefinition["limits"];
};

export function getPlan(planId: PlanId): PlanDefinition {
  return getPlanDefinition(planId);
}

export function getOrganizationPlan(organization: Pick<OrganizationDocument, "planId">): PlanDefinition {
  return getPlan(organization.planId);
}

export function buildOrganizationEntitlements(
  organization: Pick<OrganizationDocument, "planId" | "status">,
): OrganizationEntitlements {
  const plan = getOrganizationPlan(organization);
  return {
    plan,
    status: organization.status,
    features: plan.features,
    limits: plan.limits,
  };
}

export function hasFeature(
  organization: Pick<OrganizationDocument, "planId" | "status">,
  feature: PlanFeature,
) {
  if (organization.status === "suspended") return false;
  return Boolean(getOrganizationPlan(organization).features[feature]);
}

export function assertFeature(
  organization: Pick<OrganizationDocument, "planId" | "status">,
  feature: PlanFeature,
) {
  if (organization.status === "suspended") {
    throw organizationSuspendedError();
  }
  if (!hasFeature(organization, feature)) {
    throw planFeatureDeniedError(feature);
  }
}

export function getLimit(
  organization: Pick<OrganizationDocument, "planId">,
  resource: PlanLimitResource,
): number | null {
  return getOrganizationPlan(organization).limits[resource];
}

async function countOwnedResource(ownerUserId: string, resource: PlanLimitResource): Promise<number> {
  switch (resource) {
    case "customers":
      return getCustomersCollection().countDocuments({ ownerId: ownerUserId });
    case "products":
      return getProductsCollection().countDocuments({ ownerId: ownerUserId });
    case "orders":
      return getOrdersCollection().countDocuments({ ownerId: ownerUserId });
    case "invoices":
      return getInvoicesCollection().countDocuments({ ownerId: ownerUserId });
    case "monthlyAiQueries":
      // Usage metering is deferred; treat as zero until a meter exists.
      return 0;
    default:
      return 0;
  }
}

/**
 * Server-authoritative limit check. Never trusts client-supplied counts.
 * `null` limits are unlimited.
 */
export async function assertWithinLimit(
  organization: Pick<OrganizationDocument, "ownerUserId" | "planId" | "status">,
  resource: PlanLimitResource,
) {
  if (organization.status === "suspended") {
    throw organizationSuspendedError();
  }

  const limit = getLimit(organization, resource);
  if (limit === null) return { limit: null as null, current: await countOwnedResource(organization.ownerUserId, resource) };

  const current = await countOwnedResource(organization.ownerUserId, resource);
  if (current >= limit) {
    throw planLimitReachedError(resource, limit, current);
  }

  return { limit, current };
}

/** Safe DTO for Settings / GET /api/organization — no Mongo IDs or ownerUserId. */
export function toPublicOrganizationEntitlements(
  organization: OrganizationDocument,
  entitlements: OrganizationEntitlements,
) {
  return {
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    plan: {
      id: entitlements.plan.id,
      name: entitlements.plan.name,
    },
    features: entitlements.features,
    limits: entitlements.limits,
    billing: {
      // Explicitly communicate that SaaS subscription charging is not live.
      subscriptionBilling: "not_implemented" as const,
      note: "Subscription billing and plan upgrades will arrive in a later phase. Invoice Stripe Checkout remains for customer invoice payments only.",
    },
  };
}

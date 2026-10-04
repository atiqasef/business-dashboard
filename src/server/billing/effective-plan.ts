import { DEFAULT_PLAN_ID, type PlanId } from "@/server/entitlements/plans";
import type { OrganizationDocument } from "@/server/db/models/organization";
import type { SubscriptionDocument } from "@/server/db/models/subscription";

/**
 * Entitlement policy for SaaS subscriptions (documented):
 *
 * - No local subscription → organization.planId (normally Free)
 * - active / trialing / past_due → subscription.planId
 *   (past_due keeps paid entitlements while Stripe retries collection)
 * - canceled with currentPeriodEnd still in the future → keep subscription.planId until period end
 * - unpaid / incomplete / incomplete_expired / paused → Free
 *
 * organization.planId is updated by webhooks for Settings display; this resolver is used when
 * computing entitlements so browser/org.planId alone cannot unlock paid features without a valid sub.
 */
export function resolveEffectivePlanId(
  organization: Pick<OrganizationDocument, "planId">,
  subscription: SubscriptionDocument | null | undefined,
  now = new Date(),
): PlanId {
  if (!subscription) {
    return organization.planId;
  }

  const { status, planId, currentPeriodEnd } = subscription;
  const periodOpen = Boolean(currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime());

  if (status === "active" || status === "trialing" || status === "past_due") {
    return planId;
  }

  // Canceled but still inside the paid period (typical cancel_at_period_end outcome).
  if (status === "canceled" && periodOpen) {
    return planId;
  }

  return DEFAULT_PLAN_ID;
}

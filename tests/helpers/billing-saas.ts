import { getOrganizationsCollection } from "@/server/db/models/organization";
import type { PlanId } from "@/server/entitlements/plans";
import { ensureOrganizationForUser } from "@/server/organizations/provision";

/** Test helper: set organization.planId for entitlement checks (not a Stripe sync). */
export async function setOrganizationPlan(ownerUserId: string, planId: PlanId) {
  await ensureOrganizationForUser(ownerUserId);
  await getOrganizationsCollection().updateOne(
    { ownerUserId },
    { $set: { planId, updatedAt: new Date() } },
  );
}

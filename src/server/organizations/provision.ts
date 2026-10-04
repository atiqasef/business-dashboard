import {
  ensureOrganizationIndexes,
  getOrganizationsCollection,
  normalizeOrganizationPlanId,
  type OrganizationDocument,
} from "@/server/db/models/organization";
import { DEFAULT_PLAN_ID } from "@/server/entitlements/plans";
import { getBusinessProfile } from "@/server/settings/business-profile";

function buildSlug(ownerUserId: string) {
  // Deterministic + unique via ownerUserId unique index. Browser cannot choose slug.
  const safe = ownerUserId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "user";
  return `org-${safe}`.toLowerCase();
}

async function resolveDefaultName(ownerUserId: string, fallbackName?: string) {
  try {
    const profile = await getBusinessProfile(ownerUserId);
    if (profile.businessName?.trim()) return profile.businessName.trim().slice(0, 120);
  } catch {
    // Profile optional during first login.
  }
  const trimmed = fallbackName?.trim();
  if (trimmed) return trimmed.slice(0, 120);
  return "My Workspace";
}

/**
 * Idempotent, race-safe organization provisioning for a session user.
 * `ownerUserId` must come from the authenticated session only.
 */
export async function ensureOrganizationForUser(
  ownerUserId: string,
  options?: { displayName?: string },
): Promise<OrganizationDocument> {
  if (!ownerUserId || typeof ownerUserId !== "string") {
    throw new Error("ownerUserId is required");
  }

  await ensureOrganizationIndexes();
  const collection = getOrganizationsCollection();

  const existing = await collection.findOne({ ownerUserId });
  if (existing) {
    // Repair invalid planId without allowing browser overrides.
    const planId = normalizeOrganizationPlanId(existing.planId);
    if (planId !== existing.planId) {
      const updatedAt = new Date();
      await collection.updateOne({ _id: existing._id, ownerUserId }, { $set: { planId, updatedAt } });
      return { ...existing, planId, updatedAt };
    }
    return existing;
  }

  const now = new Date();
  const doc: OrganizationDocument = {
    name: await resolveDefaultName(ownerUserId, options?.displayName),
    slug: buildSlug(ownerUserId),
    ownerUserId,
    planId: DEFAULT_PLAN_ID,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await collection.insertOne(doc);
    return doc;
  } catch (error) {
    // Unique index race: another request provisioned first.
    const duplicate =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000;

    if (!duplicate) throw error;

    const raced = await collection.findOne({ ownerUserId });
    if (!raced) throw error;
    return raced;
  }
}

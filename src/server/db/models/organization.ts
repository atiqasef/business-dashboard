import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";
import { DEFAULT_PLAN_ID, isPlanId, type PlanId } from "@/server/entitlements/plans";

/**
 * Organization / workspace boundary for SaaS plans.
 *
 * Compatibility (Phase 20):
 * - `ownerUserId` equals the existing Better Auth user id used as `ownerId`
 *   on customers, products, orders, invoices, payments, etc.
 * - Business collections are NOT migrated to `organizationId` in this phase.
 * - Future: members/roles + organizationId on business docs.
 */
export const organizationStatuses = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof organizationStatuses)[number];

export interface OrganizationDocument {
  _id?: ObjectId;
  name: string;
  slug: string;
  ownerUserId: string;
  planId: PlanId;
  status: OrganizationStatus;
  /** Stripe Customer for SaaS subscription billing only (not invoice payments). */
  stripeCustomerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getOrganizationsCollection(): Collection<OrganizationDocument> {
  return db.collection<OrganizationDocument>("organizations");
}

export async function ensureOrganizationIndexes() {
  if (!indexesPromise) {
    indexesPromise = getOrganizationsCollection()
      .createIndexes([
        { key: { ownerUserId: 1 }, name: "ownerUserId_unique", unique: true },
        { key: { slug: 1 }, name: "slug_unique", unique: true },
      ])
      .then(() => undefined);
  }
  return indexesPromise;
}

export function normalizeOrganizationPlanId(value: unknown): PlanId {
  return isPlanId(value) ? value : DEFAULT_PLAN_ID;
}

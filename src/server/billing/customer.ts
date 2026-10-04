import {
  ensureOrganizationIndexes,
  getOrganizationsCollection,
  type OrganizationDocument,
} from "@/server/db/models/organization";
import { billingCustomerError, billingNotConfiguredError } from "@/server/billing/errors";
import { getStripeClient } from "@/server/payments/providers/stripe-client";
import { isStripeConfigured } from "@/server/payments/providers/stripe-config";
import { getBusinessProfile } from "@/server/settings/business-profile";

/**
 * Idempotent Stripe Customer for SaaS billing.
 * One customer per organization; never accepts browser-supplied customer IDs.
 */
export async function ensureStripeCustomerForOrganization(
  organization: OrganizationDocument,
  options?: { ownerEmail?: string | null; ownerName?: string | null },
): Promise<{ organization: OrganizationDocument; stripeCustomerId: string }> {
  if (!isStripeConfigured()) throw billingNotConfiguredError();
  if (!organization._id) throw billingCustomerError();

  await ensureOrganizationIndexes();

  if (organization.stripeCustomerId?.startsWith("cus_")) {
    return { organization, stripeCustomerId: organization.stripeCustomerId };
  }

  // Re-read to avoid races with concurrent checkout/portal requests.
  const latest = await getOrganizationsCollection().findOne({ _id: organization._id });
  if (!latest) throw billingCustomerError();
  if (latest.stripeCustomerId?.startsWith("cus_")) {
    return { organization: latest, stripeCustomerId: latest.stripeCustomerId };
  }

  let email = options?.ownerEmail?.trim() || undefined;
  let name = options?.ownerName?.trim() || latest.name;
  try {
    const profile = await getBusinessProfile(latest.ownerUserId);
    if (profile.email?.trim()) email = profile.email.trim();
    if (profile.businessName?.trim()) name = profile.businessName.trim();
  } catch {
    // Profile optional.
  }

  try {
    const stripe = getStripeClient();
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        organizationId: latest._id!.toHexString(),
        ownerUserId: latest.ownerUserId,
        billingContext: "saas_subscription_v1",
      },
    });

    const updatedAt = new Date();
    const claimed = await getOrganizationsCollection().findOneAndUpdate(
      { _id: latest._id, stripeCustomerId: { $exists: false } },
      { $set: { stripeCustomerId: customer.id, updatedAt } },
      { returnDocument: "after" },
    );

    if (claimed?.stripeCustomerId) {
      return { organization: claimed, stripeCustomerId: claimed.stripeCustomerId };
    }

    // Another request won the race — prefer the persisted customer id.
    const raced = await getOrganizationsCollection().findOne({ _id: latest._id });
    if (raced?.stripeCustomerId?.startsWith("cus_")) {
      // Best-effort cleanup of unused Stripe customer created by this race.
      try {
        await stripe.customers.del(customer.id);
      } catch {
        // ignore
      }
      return { organization: raced, stripeCustomerId: raced.stripeCustomerId };
    }

    throw billingCustomerError();
  } catch (error) {
    if (error instanceof Error && error.name === "BillingError") throw error;
    throw billingCustomerError();
  }
}

export async function findOrganizationByStripeCustomerId(stripeCustomerId: string) {
  if (!stripeCustomerId.startsWith("cus_")) return null;
  await ensureOrganizationIndexes();
  return getOrganizationsCollection().findOne({ stripeCustomerId });
}

import {
  billingNotConfiguredError,
  checkoutCreationFailedError,
  demoBillingBlockedError,
  invalidPlanError,
  subscriptionAlreadyExistsError,
} from "@/server/billing/errors";
import { ensureStripeCustomerForOrganization } from "@/server/billing/customer";
import { isSaasBillingConfigured, mapPlanToStripePriceId, assertRecognizedPaidPlan } from "@/server/billing/prices";
import { getSubscriptionForOrganization } from "@/server/billing/sync";
import { getCanonicalAppUrl } from "@/server/config/app-url";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import { getStripeClient } from "@/server/payments/providers/stripe-client";
import { resolveOrganizationForUser } from "@/server/organizations/resolve";

export const SAAS_BILLING_CONTEXT = "saas_subscription_v1";

/** Statuses that mean Manage Billing / portal should be used instead of a second Checkout. */
const BLOCKING_STATUSES = new Set(["active", "trialing", "past_due", "paused"]);

export async function createSaasCheckoutSession(options: {
  ownerUserId: string;
  requestedPlan: unknown;
  ownerEmail?: string | null;
  ownerName?: string | null;
}) {
  if (!isSaasBillingConfigured()) throw billingNotConfiguredError();
  if (await isReadOnlyDemoUser(options.ownerUserId)) throw demoBillingBlockedError();

  let planId;
  try {
    planId = assertRecognizedPaidPlan(options.requestedPlan);
  } catch {
    throw invalidPlanError();
  }

  const priceId = mapPlanToStripePriceId(planId);
  if (!priceId) throw billingNotConfiguredError();

  const { organization } = await resolveOrganizationForUser(options.ownerUserId, {
    displayName: options.ownerName || undefined,
  });
  if (!organization._id) throw checkoutCreationFailedError();

  const existing = await getSubscriptionForOrganization(organization._id);
  if (existing && BLOCKING_STATUSES.has(existing.status)) {
    throw subscriptionAlreadyExistsError();
  }

  const { stripeCustomerId } = await ensureStripeCustomerForOrganization(organization, {
    ownerEmail: options.ownerEmail,
    ownerName: options.ownerName,
  });

  const origin = getCanonicalAppUrl();
  const successUrl = `${origin}/settings?billing=success`;
  const cancelUrl = `${origin}/settings?billing=canceled`;

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: organization._id.toHexString(),
      metadata: {
        billingContext: SAAS_BILLING_CONTEXT,
        organizationId: organization._id.toHexString(),
        ownerUserId: options.ownerUserId,
        planId,
      },
      subscription_data: {
        metadata: {
          billingContext: SAAS_BILLING_CONTEXT,
          organizationId: organization._id.toHexString(),
          ownerUserId: options.ownerUserId,
          planId,
        },
      },
      allow_promotion_codes: false,
    });

    if (!session.url) throw checkoutCreationFailedError();
    return { url: session.url, planId };
  } catch (error) {
    if (error instanceof Error && error.name === "BillingError") throw error;
    throw checkoutCreationFailedError();
  }
}

import {
  billingNotConfiguredError,
  billingPortalUnavailableError,
  demoBillingBlockedError,
} from "@/server/billing/errors";
import { ensureStripeCustomerForOrganization } from "@/server/billing/customer";
import { isSaasBillingConfigured } from "@/server/billing/prices";
import { getCanonicalAppUrl } from "@/server/config/app-url";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import { getStripeClient } from "@/server/payments/providers/stripe-client";
import { resolveOrganizationForUser } from "@/server/organizations/resolve";

export async function createBillingPortalSession(options: {
  ownerUserId: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
}) {
  if (!isSaasBillingConfigured()) throw billingNotConfiguredError();
  if (await isReadOnlyDemoUser(options.ownerUserId)) throw demoBillingBlockedError();

  const { organization } = await resolveOrganizationForUser(options.ownerUserId, {
    displayName: options.ownerName || undefined,
  });

  const { stripeCustomerId } = await ensureStripeCustomerForOrganization(organization, {
    ownerEmail: options.ownerEmail,
    ownerName: options.ownerName,
  });

  const returnUrl = `${getCanonicalAppUrl()}/settings`;

  try {
    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    if (!session.url) throw billingPortalUnavailableError();
    return { url: session.url };
  } catch (error) {
    if (error instanceof Error && error.name === "BillingError") throw error;
    throw billingPortalUnavailableError();
  }
}

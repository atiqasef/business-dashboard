import type Stripe from "stripe";
import { getStripeClient } from "@/server/payments/providers/stripe-client";
import { SAAS_BILLING_CONTEXT } from "@/server/billing/checkout";
import { syncStripeSubscription } from "@/server/billing/sync";

async function retrieveSubscription(subscriptionId: string) {
  const stripe = getStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * SaaS subscription Checkout completion.
 * Invoice Checkout uses mode=payment + paymentContext=invoice_checkout_v1 and is handled separately.
 */
export async function processSaasCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") {
    return { handled: false as const };
  }

  const billingContext = session.metadata?.billingContext?.trim();
  if (billingContext !== SAAS_BILLING_CONTEXT) {
    return { handled: false as const };
  }

  const subscriptionRef = session.subscription;
  const subscriptionId =
    typeof subscriptionRef === "string"
      ? subscriptionRef
      : subscriptionRef && typeof subscriptionRef === "object" && "id" in subscriptionRef
        ? String((subscriptionRef as { id: string }).id)
        : null;

  if (!subscriptionId) {
    return { handled: true as const, ignored: true as const, reason: "missing_subscription" };
  }

  const subscription = await retrieveSubscription(subscriptionId);
  const result = await syncStripeSubscription(subscription);
  return { handled: true as const, ...result };
}

export async function processStripeSubscriptionEvent(subscription: Stripe.Subscription) {
  const result = await syncStripeSubscription(subscription);
  return { handled: true as const, ...result };
}

function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Stripe API shapes vary; keep this defensive so customer-invoice events stay ignored.
  const record = invoice as unknown as { subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } } };
  const candidates = [record.subscription, record.parent?.subscription_details?.subscription];
  for (const ref of candidates) {
    if (typeof ref === "string" && ref.startsWith("sub_")) return ref;
    if (ref && typeof ref === "object" && "id" in ref) {
      const id = (ref as { id?: string }).id;
      if (typeof id === "string" && id.startsWith("sub_")) return id;
    }
  }
  return null;
}

export async function processSubscriptionInvoiceEvent(invoice: Stripe.Invoice) {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);

  // Customer invoice payment webhooks have no subscription — ignore safely.
  if (!subscriptionId) {
    return { handled: false as const };
  }

  const subscription = await retrieveSubscription(subscriptionId);
  const result = await syncStripeSubscription(subscription);
  return { handled: true as const, ...result };
}

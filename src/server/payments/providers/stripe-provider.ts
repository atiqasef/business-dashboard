import { ObjectId } from "mongodb";
import { getCustomersCollection } from "@/server/db/models/customer";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import { getInvoiceBusinessBranding } from "@/server/settings/business-profile";
import { APP_CURRENCY, dollarsToStripeCents } from "@/server/payments/money";
import { getStripeClient } from "@/server/payments/providers/stripe-client";
import { isStripeConfigured, StripeConfigurationError } from "@/server/payments/providers/stripe-config";
import type {
  InvoiceCheckoutSession,
  InvoiceCheckoutSessionInput,
  InvoicePaymentProvider,
} from "@/server/payments/providers/types";

export const STRIPE_PAYMENT_CONTEXT = "invoice_checkout_v1";

/** Stripe Checkout Sessions expire after 24h by default; we track a slightly shorter window. */
const PENDING_CHECKOUT_TTL_MS = 23 * 60 * 60 * 1000;

export class StripeCheckoutError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "StripeCheckoutError";
    this.status = status;
  }
}

export const stripeInvoicePaymentProvider: InvoicePaymentProvider = {
  id: "stripe",
  isConfigured: () => isStripeConfigured(),
  createCheckoutSession: createStripeCheckoutSession,
};

async function expireStripeSessionBestEffort(sessionId: string) {
  try {
    const stripe = getStripeClient();
    await stripe.checkout.sessions.expire(sessionId);
  } catch {
    // Session may already be expired, completed, or unknown — safe to continue.
  }
}

async function createStripeCheckoutSession(
  input: InvoiceCheckoutSessionInput,
): Promise<InvoiceCheckoutSession> {
  if (!isStripeConfigured()) {
    throw new StripeConfigurationError("Online payment is not configured.");
  }

  if (!input.ownerId || !ObjectId.isValid(input.invoiceId)) {
    throw new StripeCheckoutError("Invalid checkout context", 400);
  }

  if (await isReadOnlyDemoUser(input.ownerId)) {
    throw new StripeCheckoutError("Online payment is unavailable for demo invoices.", 403);
  }

  const invoiceId = new ObjectId(input.invoiceId);
  const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId: input.ownerId });
  if (!invoice) throw new StripeCheckoutError("Invoice not found", 404);
  if (invoice.status === "cancelled") throw new StripeCheckoutError("Cannot pay a cancelled invoice", 409);
  if (invoice.status === "draft") throw new StripeCheckoutError("Cannot pay a draft invoice", 409);
  if (invoice.outstandingAmount <= 0 || invoice.status === "paid") {
    throw new StripeCheckoutError("Invoice is already fully paid", 409);
  }

  // Expire any previously issued Checkout Session so customers cannot complete stale full-balance sessions.
  if (invoice.pendingStripeCheckout?.sessionId) {
    await expireStripeSessionBestEffort(invoice.pendingStripeCheckout.sessionId);
  }

  let amountCents: number;
  try {
    amountCents = dollarsToStripeCents(invoice.outstandingAmount);
  } catch {
    throw new StripeCheckoutError("Invoice outstanding amount is not payable online", 409);
  }

  const customer = await getCustomersCollection().findOne({
    _id: invoice.customerId,
    ownerId: input.ownerId,
  });
  const branding = await getInvoiceBusinessBranding(input.ownerId);
  const customerEmail = customer?.email?.trim() || invoice.customerSnapshot.email?.trim() || undefined;

  const stripe = getStripeClient();
  const metadata = {
    ownerId: input.ownerId,
    invoiceId: invoiceId.toHexString(),
    paymentContext: STRIPE_PAYMENT_CONTEXT,
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Card payments confirm immediately; async methods are intentionally not enabled.
      allowed_payment_method_types: ["card"],
      customer_email: customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: APP_CURRENCY,
            unit_amount: amountCents,
            product_data: {
              name: `Invoice ${invoice.invoiceNumber}`,
              description: `Payment to ${branding.businessName}`,
            },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      payment_intent_data: {
        metadata,
      },
      client_reference_id: invoiceId.toHexString(),
    });

    if (!session.url) {
      throw new StripeCheckoutError("Unable to start online payment.", 502);
    }

    const now = new Date();
    await getInvoicesCollection().updateOne(
      { _id: invoiceId, ownerId: input.ownerId },
      {
        $set: {
          pendingStripeCheckout: {
            sessionId: session.id,
            amountCents,
            createdAt: now,
            expiresAt: new Date(now.getTime() + PENDING_CHECKOUT_TTL_MS),
          },
          updatedAt: now,
        },
      },
    );

    return {
      provider: "stripe",
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  } catch (error) {
    if (error instanceof StripeCheckoutError || error instanceof StripeConfigurationError) throw error;
    console.error("Stripe checkout session creation failed", error instanceof Error ? error.name : "unknown");
    throw new StripeCheckoutError("Unable to start online payment.", 502);
  }
}

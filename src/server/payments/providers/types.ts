import { isStripeConfigured } from "@/server/payments/providers/stripe-config";
import { stripeInvoicePaymentProvider } from "@/server/payments/providers/stripe-provider";

/**
 * Online payment provider abstraction.
 *
 * Flow:
 * 1. createCheckoutSession for a validated public invoice access token context
 * 2. provider webhook verifies the event
 * 3. payment is recorded through existing internal payment recording
 * 4. invoice outstanding/status update via existing business logic
 */
export type InvoiceCheckoutSessionInput = {
  ownerId: string;
  invoiceId: string;
  /** Public invoice access token that authorized the customer view (not sent to Stripe). */
  accessToken: string;
  successUrl: string;
  cancelUrl: string;
};

export type InvoiceCheckoutSession = {
  provider: string;
  checkoutUrl: string;
  sessionId: string;
};

export type InvoicePaymentProvider = {
  readonly id: string;
  isConfigured(): boolean;
  createCheckoutSession(input: InvoiceCheckoutSessionInput): Promise<InvoiceCheckoutSession>;
};

/** Placeholder provider — online checkout is not available. */
export const unavailableInvoicePaymentProvider: InvoicePaymentProvider = {
  id: "none",
  isConfigured: () => false,
  createCheckoutSession: async () => {
    throw new Error("Online payment is not configured");
  },
};

export function getInvoicePaymentProvider(): InvoicePaymentProvider {
  if (isStripeConfigured()) return stripeInvoicePaymentProvider;
  return unavailableInvoicePaymentProvider;
}

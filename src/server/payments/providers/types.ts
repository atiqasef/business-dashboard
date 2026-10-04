/**
 * Future online payment provider abstraction.
 * Phase 12 intentionally ships no Stripe/PayPal SDK or checkout.
 *
 * Expected future flow:
 * 1. createCheckoutSession for a public invoice access token
 * 2. provider webhook verifies the event
 * 3. payment is recorded through existing internal payment APIs
 * 4. invoice outstanding/status update via existing business logic
 */
export type InvoiceCheckoutSessionInput = {
  ownerId: string;
  invoiceId: string;
  /** Public invoice access token that authorized the customer view. */
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

/** Placeholder provider — online checkout is not available yet. */
export const unavailableInvoicePaymentProvider: InvoicePaymentProvider = {
  id: "none",
  isConfigured: () => false,
  createCheckoutSession: async () => {
    throw new Error("Online payment is not configured");
  },
};

export function getInvoicePaymentProvider(): InvoicePaymentProvider {
  return unavailableInvoicePaymentProvider;
}

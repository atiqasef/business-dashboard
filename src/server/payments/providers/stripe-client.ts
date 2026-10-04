import Stripe from "stripe";
import { requireStripeSecretKey } from "@/server/payments/providers/stripe-config";

let stripeClient: Stripe | null = null;

/** Lazy Stripe client — never instantiate when secret key is absent. */
export function getStripeClient() {
  if (!stripeClient) {
    stripeClient = new Stripe(requireStripeSecretKey());
  }
  return stripeClient;
}

/** Test helper — clears the cached client between cases. */
export function resetStripeClientForTests() {
  stripeClient = null;
}

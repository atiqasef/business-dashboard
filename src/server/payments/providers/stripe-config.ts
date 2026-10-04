export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigurationError";
  }
}

export function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
}

export function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey());
}

export function isStripeWebhookConfigured() {
  return Boolean(getStripeSecretKey() && getStripeWebhookSecret());
}

export function requireStripeSecretKey() {
  const key = getStripeSecretKey();
  if (!key) {
    throw new StripeConfigurationError("Online payment is not configured.");
  }
  return key;
}

export function requireStripeWebhookSecret() {
  const secret = getStripeWebhookSecret();
  if (!secret) {
    throw new StripeConfigurationError("Stripe webhook is not configured.");
  }
  return secret;
}

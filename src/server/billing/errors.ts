export class BillingError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
  }
}

export function billingNotConfiguredError() {
  return new BillingError("Billing is not configured.", 503, "BILLING_NOT_CONFIGURED");
}

export function invalidPlanError() {
  return new BillingError("Invalid plan selection.", 400, "INVALID_PLAN");
}

export function subscriptionAlreadyExistsError() {
  return new BillingError(
    "An active subscription already exists. Use Manage Billing to change plans.",
    409,
    "SUBSCRIPTION_ALREADY_EXISTS",
  );
}

export function billingCustomerError() {
  return new BillingError("Unable to prepare billing customer.", 502, "BILLING_CUSTOMER_ERROR");
}

export function checkoutCreationFailedError() {
  return new BillingError("Unable to start subscription checkout.", 502, "CHECKOUT_CREATION_FAILED");
}

export function billingPortalUnavailableError() {
  return new BillingError("Billing portal is unavailable.", 502, "BILLING_PORTAL_UNAVAILABLE");
}

export function demoBillingBlockedError() {
  return new BillingError("Demo account cannot manage SaaS billing.", 403, "DEMO_BILLING_BLOCKED");
}

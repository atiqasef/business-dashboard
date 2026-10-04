import { NextResponse } from "next/server";
import { isStripeConfigured, isStripeWebhookConfigured, StripeConfigurationError } from "@/server/payments/providers/stripe-config";
import { constructStripeEvent, handleStripeWebhookEvent } from "@/server/payments/stripe-webhook";

/**
 * Stripe webhook — authenticates via signature over the raw body.
 * Never trusts browser sessions or request JSON fields for payment truth.
 */
export async function POST(request: Request) {
  if (!isStripeConfigured() || !isStripeWebhookConfigured()) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const event = constructStripeEvent(rawBody, signature);
    const result = await handleStripeWebhookEvent(event);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
    }
    // Stripe signature failures throw StripeSignatureVerificationError
    const name = error instanceof Error ? error.name : "unknown";
    if (name.includes("Signature") || (error instanceof Error && /signature/i.test(error.message))) {
      return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
    }
    console.error("Stripe webhook request failed", name);
    return NextResponse.json({ error: "Unable to process webhook." }, { status: 400 });
  }
}

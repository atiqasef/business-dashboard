import { NextResponse } from "next/server";
import { buildPublicInvoiceUrl } from "@/server/config/app-url";
import { resolvePublicInvoiceByToken } from "@/server/invoices/public-access";
import { getInvoicePaymentProvider } from "@/server/payments/providers/types";
import { StripeConfigurationError } from "@/server/payments/providers/stripe-config";
import { StripeCheckoutError } from "@/server/payments/providers/stripe-provider";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Creates a Stripe Checkout Session for a public invoice token.
 * Browser body is ignored for amount/owner/invoice identity.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const resolved = await resolvePublicInvoiceByToken(token);
    if (!resolved.ok) {
      return errorResponse("This invoice link is invalid or has expired.", 404);
    }

    const provider = getInvoicePaymentProvider();
    if (!provider.isConfigured()) {
      return errorResponse("Online payment is not configured.", 503);
    }

    const invoiceUrl = buildPublicInvoiceUrl(token);
    const session = await provider.createCheckoutSession({
      ownerId: resolved.access.ownerId,
      invoiceId: resolved.invoice._id!.toHexString(),
      accessToken: token,
      successUrl: `${invoiceUrl}?payment=success`,
      cancelUrl: `${invoiceUrl}?payment=cancelled`,
    });

    return NextResponse.json(
      {
        data: {
          checkoutUrl: session.checkoutUrl,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StripeConfigurationError) {
      return errorResponse("Online payment is not configured.", 503);
    }
    if (error instanceof StripeCheckoutError) {
      return errorResponse(error.message, error.status);
    }
    // Ignore any spoofed body — never surface Stripe internals.
    console.error("Public invoice checkout failed", error instanceof Error ? error.name : "unknown");
    return errorResponse("Unable to start online payment.", 500);
  }
}

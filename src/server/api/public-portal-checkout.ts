import { NextResponse } from "next/server";
import { buildCustomerPortalInvoiceUrl } from "@/server/config/app-url";
import { CustomerPortalAccessError, getPortalInvoiceByNumber } from "@/server/portal/access";
import { getInvoicePaymentProvider } from "@/server/payments/providers/types";
import { StripeConfigurationError } from "@/server/payments/providers/stripe-config";
import { StripeCheckoutError } from "@/server/payments/providers/stripe-provider";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Portal checkout for a specific invoice number within the portal customer context.
 * Browser cannot supply owner/customer/amount/currency authoritatively.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string; invoiceNumber: string }> },
) {
  try {
    const { token, invoiceNumber } = await context.params;
    const { resolved, invoice } = await getPortalInvoiceByNumber(token, decodeURIComponent(invoiceNumber));

    const provider = getInvoicePaymentProvider();
    if (!provider.isConfigured()) {
      return errorResponse("Online payment is not configured.", 503);
    }

    const returnUrl = buildCustomerPortalInvoiceUrl(token, invoice.invoiceNumber);
    const session = await provider.createCheckoutSession({
      ownerId: resolved.access.ownerId,
      invoiceId: invoice._id!.toHexString(),
      accessToken: token,
      successUrl: `${returnUrl}?payment=success`,
      cancelUrl: `${returnUrl}?payment=cancelled`,
    });

    return NextResponse.json(
      { data: { checkoutUrl: session.checkoutUrl } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof StripeConfigurationError) {
      return errorResponse("Online payment is not configured.", 503);
    }
    if (error instanceof StripeCheckoutError) {
      return errorResponse(error.message, error.status);
    }
    console.error("Portal checkout failed", error instanceof Error ? error.name : "unknown");
    return errorResponse("Unable to start online payment.", 500);
  }
}

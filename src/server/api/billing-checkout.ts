import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createSaasCheckoutSession } from "@/server/billing/checkout";
import { BillingError } from "@/server/billing/errors";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse("Authentication required", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Invalid request body", 400);
  }

  const record = body as Record<string, unknown>;
  // Ignore hostile / spoofed billing identity fields.
  void record.ownerId;
  void record.organizationId;
  void record.priceId;
  void record.stripeCustomerId;
  void record.stripeSubscriptionId;
  void record.returnUrl;
  void record.successUrl;
  void record.cancelUrl;

  try {
    const result = await createSaasCheckoutSession({
      ownerUserId: session.user.id,
      requestedPlan: record.planId,
      ownerEmail: session.user.email,
      ownerName: session.user.name,
    });
    return NextResponse.json({ data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof BillingError) {
      return errorResponse(error.message, error.status, error.code);
    }
    return errorResponse("Unable to start checkout", 500);
  }
}

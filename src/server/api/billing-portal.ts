import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { BillingError } from "@/server/billing/errors";
import { createBillingPortalSession } from "@/server/billing/portal";

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

  // Body is optional; ignore any client-supplied customer/return URLs.
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      void record.ownerId;
      void record.organizationId;
      void record.stripeCustomerId;
      void record.returnUrl;
    }
  } catch {
    // empty body ok
  }

  try {
    const result = await createBillingPortalSession({
      ownerUserId: session.user.id,
      ownerEmail: session.user.email,
      ownerName: session.user.name,
    });
    return NextResponse.json({ data: result }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof BillingError) {
      return errorResponse(error.message, error.status, error.code);
    }
    return errorResponse("Unable to open billing portal", 500);
  }
}

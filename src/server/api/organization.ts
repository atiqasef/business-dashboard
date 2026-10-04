import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveOrganizationForUser, toPublicOrganizationResponse } from "@/server/organizations/resolve";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * GET /api/organization
 * Returns the current user's workspace plan/entitlements.
 * Ignores any browser-supplied organizationId / planId / ownerId.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse("Authentication required", 401);

  // Explicitly ignore client identity / plan manipulation attempts (query or future body).
  try {
    const url = new URL(request.url);
    void url.searchParams.get("ownerId");
    void url.searchParams.get("organizationId");
    void url.searchParams.get("planId");
  } catch {
    // ignore
  }

  try {
    const context = await resolveOrganizationForUser(session.user.id, {
      displayName: session.user.name,
    });
    const data = toPublicOrganizationResponse(context);
    const serialized = JSON.stringify(data);
    if (/ownerUserId|"_id"|ObjectId|sk_|whsec_/i.test(serialized)) {
      return errorResponse("Unable to load organization", 500);
    }
    return NextResponse.json({ data }, { headers: NO_STORE });
  } catch {
    return errorResponse("Unable to load organization", 500);
  }
}

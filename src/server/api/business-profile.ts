import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import {
  BusinessProfileValidationError,
  getBusinessProfile,
  upsertBusinessProfile,
} from "@/server/settings/business-profile";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const data = await getBusinessProfile(session.user.id);
    return NextResponse.json({ data });
  } catch {
    return errorResponse("Unable to load business profile", 500);
  }
}

export async function PATCH(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    // Ignore any browser-supplied identity/metadata — ownerId comes from the session only.
    const input = { ...(body ?? {}) };
    delete input.ownerId;
    delete input._id;
    delete input.id;
    delete input.createdAt;
    delete input.updatedAt;

    const data = await upsertBusinessProfile(session.user.id, input);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof BusinessProfileValidationError) {
      return errorResponse(error.message, 400);
    }
    if (error instanceof SyntaxError) {
      return errorResponse("Request body is invalid", 400);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return errorResponse("A business profile already exists for this account", 409);
    }
    return errorResponse("Unable to save business profile", 500);
  }
}

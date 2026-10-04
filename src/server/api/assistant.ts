import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  askBusinessAssistant,
  AssistantServiceError,
  AssistantValidationError,
  getAssistantConfigurationState,
} from "@/server/ai/business-assistant";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  return NextResponse.json({ data: getAssistantConfigurationState() }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const session = await getSession(request);
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
  // Explicitly ignore any client-supplied identity / plan fields.
  void record.ownerId;
  void record.userId;
  void record.organizationId;
  void record.planId;
  void record.limits;
  void record.status;

  try {
    const result = await askBusinessAssistant({
      ownerId: session.user.id,
      question: record.question,
    });
    return NextResponse.json({ data: result.data }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AssistantValidationError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof AssistantServiceError) {
      return errorResponse(error.message, error.status);
    }
    console.error("Assistant request failed", error instanceof Error ? error.name : "unknown");
    return errorResponse("Unable to process assistant request", 500);
  }
}

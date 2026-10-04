import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAiConfigured } from "@/server/ai/config";
import { summarizeBusinessInsights } from "@/server/ai/insight-summary";
import { getBusinessInsights } from "@/server/ai/insights";
import { AiProviderError } from "@/server/ai/provider";
import { EntitlementError } from "@/server/entitlements/errors";

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

  try {
    const result = await getBusinessInsights(session.user.id);
    return NextResponse.json(
      {
        data: {
          insights: result.insights,
          period: {
            label: result.period.label,
            start: result.period.start,
            end: result.period.end,
            timezone: result.period.timezone,
          },
          aiConfigured: isAiConfigured(),
        },
      },
      { headers: NO_STORE },
    );
  } catch {
    return errorResponse("Unable to load business insights", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  // Ignore any client-supplied identity/context fields.
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object") {
      void (body as Record<string, unknown>).ownerId;
      void (body as Record<string, unknown>).userId;
      void (body as Record<string, unknown>).organizationId;
      void (body as Record<string, unknown>).planId;
      void (body as Record<string, unknown>).limits;
      void (body as Record<string, unknown>).status;
      void (body as Record<string, unknown>).insights;
      void (body as Record<string, unknown>).prompt;
    }
  } catch {
    // Empty body is fine.
  }

  try {
    const result = await summarizeBusinessInsights({ ownerId: session.user.id });
    return NextResponse.json(
      {
        data: {
          insights: result.insights,
          period: result.period,
          summary: result.summary,
          aiAvailable: result.aiAvailable,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof EntitlementError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: error.status, headers: NO_STORE },
      );
    }
    if (error instanceof AiProviderError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Unable to generate insight summary", 500);
  }
}

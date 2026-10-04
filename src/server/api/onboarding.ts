import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { APP_HOME_PATH } from "@/lib/app-paths";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import { completeOnboardingIfReady, getOnboardingStatus } from "@/server/onboarding/status";

const NO_STORE = { "Cache-Control": "no-store" } as const;

async function sessionUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

function ignoreClientScope(request: Request, body?: unknown) {
  try {
    const url = new URL(request.url);
    void url.searchParams.get("ownerId");
    void url.searchParams.get("organizationId");
    void url.searchParams.get("planId");
  } catch {
    // ignore
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    void record.ownerId;
    void record.userId;
    void record.organizationId;
    void record.planId;
    void record.complete;
    void record.completed;
  }
}

export async function GET(request: Request) {
  const user = await sessionUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: NO_STORE });
  ignoreClientScope(request);

  try {
    const status = await getOnboardingStatus(user.id);
    const destination =
      (await isReadOnlyDemoUser(user.id)) || !status.shouldEnterOnboarding ? APP_HOME_PATH : "/onboarding";
    return NextResponse.json({ data: status, destination }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Unable to load onboarding" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const user = await sessionUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: NO_STORE });

  const body = await request.json().catch(() => ({}));
  ignoreClientScope(request, body);

  if (await isReadOnlyDemoUser(user.id)) {
    return NextResponse.json({ error: "Demo account is read-only" }, { status: 403, headers: NO_STORE });
  }

  try {
    const status = await completeOnboardingIfReady(user.id);
    return NextResponse.json({ data: status }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Unable to update onboarding" }, { status: 500, headers: NO_STORE });
  }
}

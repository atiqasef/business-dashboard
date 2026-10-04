import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDashboardData } from "@/server/dashboard/get-dashboard-data";

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
    const url = new URL(request.url);
    const days = url.searchParams.get("days");
    const data = await getDashboardData(session.user.id, { days });
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("days must be") || error.message.includes("whole number"))) {
      return errorResponse(error.message, 400);
    }
    return errorResponse("Unable to load dashboard", 500);
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getReportData } from "@/server/reports/get-report-data";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

function isValidationError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return (
    message.includes("Invalid report preset") ||
    message.includes("Custom range") ||
    message.includes("must be YYYY-MM-DD") ||
    message.includes("is invalid") ||
    message.includes("start must be") ||
    message.includes("cannot exceed")
  );
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const url = new URL(request.url);
    const data = await getReportData(session.user.id, {
      preset: url.searchParams.get("preset"),
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
    });
    return NextResponse.json({ data });
  } catch (error) {
    if (isValidationError(error)) {
      return errorResponse(error instanceof Error ? error.message : "Invalid report range", 400);
    }
    return errorResponse("Unable to load reports", 500);
  }
}

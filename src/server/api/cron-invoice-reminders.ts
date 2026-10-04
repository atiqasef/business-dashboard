import { NextResponse } from "next/server";
import { authorizeCronRequest, processInvoiceReminderCron } from "@/server/reminders/process-cron";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleCron(request: Request) {
  if (!authorizeCronRequest(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const summary = await processInvoiceReminderCron();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Invoice reminder cron failed", error instanceof Error ? error.name : "unknown");
    return errorResponse("Unable to process invoice reminders", 500);
  }
}

/** Vercel Cron invokes GET with Authorization: Bearer CRON_SECRET */
export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}

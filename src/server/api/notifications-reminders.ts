import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import { getReminderById, listReminders } from "@/server/reminders/list-reminders";
import { ReminderValidationError, retryInvoiceReminder } from "@/server/reminders/send-reminder";

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
    const result = await listReminders(session.user.id, {
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize"),
      search: url.searchParams.get("search"),
      status: url.searchParams.get("status"),
      type: url.searchParams.get("type"),
      datePreset: url.searchParams.get("datePreset"),
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("is invalid") ||
        error.message.includes("Invalid date preset") ||
        error.message.includes("Custom range") ||
        error.message.includes("must be YYYY-MM-DD") ||
        error.message.includes("start must be"))
    ) {
      return errorResponse(error.message, 400);
    }
    return errorResponse("Unable to load reminders", 500);
  }
}

export async function GET_BY_ID(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const id = (await context.params).id;
    const reminder = await getReminderById(session.user.id, id);
    return reminder ? NextResponse.json({ data: reminder }) : errorResponse("Reminder not found", 404);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) {
      return errorResponse("Invalid reminder id", 400);
    }
    return errorResponse("Unable to load reminder", 500);
  }
}

export async function RETRY(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const id = (await context.params).id;
    const result = await retryInvoiceReminder(session.user.id, id);

    if (!result.sent) {
      return NextResponse.json(
        { error: result.error, data: { reminder: result.reminder } },
        { status: result.status },
      );
    }

    return NextResponse.json({
      data: {
        sent: true,
        reminder: result.reminder,
        to: result.reminder.recipientEmail,
        invoiceNumber: result.reminder.invoiceNumber,
      },
    });
  } catch (error) {
    if (error instanceof ReminderValidationError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Unable to retry reminder", 500);
  }
}

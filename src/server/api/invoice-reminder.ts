import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import { ReminderValidationError, sendInvoiceReminder } from "@/server/reminders/send-reminder";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

/** Manual payment reminder for an owned invoice. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const invoiceId = (await context.params).id;
    const result = await sendInvoiceReminder({
      ownerId: session.user.id,
      invoiceId,
      type: "manual",
    });

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
    return errorResponse("Unable to send payment reminder", 500);
  }
}

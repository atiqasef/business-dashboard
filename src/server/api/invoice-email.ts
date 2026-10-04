import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import { getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection } from "@/server/db/models/invoice";
import { sendEmail } from "@/server/email/send-email";
import { EmailConfigurationError, EmailDeliveryError } from "@/server/email/types";
import { buildInvoiceEmailContent } from "@/server/invoices/email-content";
import { ensurePublicInvoiceUrl } from "@/server/invoices/public-access";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/server/invoices/pdf";
import { deriveInvoiceStatus } from "@/server/invoices/status";
import { getInvoiceBusinessBranding } from "@/server/settings/business-profile";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getId(value: unknown, field: string) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) throw new Error(`${field} is invalid`);
  return new ObjectId(value);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

/**
 * Emails the invoice PDF to the owned customer's authoritative email.
 * Demo users are blocked (external side effect). No client-supplied totals/recipient trusted.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  if (await isReadOnlyDemoUser(session.user.id)) {
    return errorResponse("Email sending is disabled for the demo account.", 403);
  }

  try {
    await ensureInvoiceIndexes();

    const id = getId((await context.params).id, "invoice id");
    const invoice = await getInvoicesCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);

    const customer = await getCustomersCollection().findOne({
      _id: invoice.customerId,
      ownerId: session.user.id,
    });
    if (!customer) return errorResponse("Customer not found", 404);

    const recipient = customer.email?.trim();
    if (!recipient) {
      return errorResponse("Customer needs a valid email address before this invoice can be emailed.", 422);
    }
    if (!isValidEmail(recipient)) {
      return errorResponse("Customer email address is invalid.", 422);
    }

    const status = deriveInvoiceStatus(invoice);
    const customerName = `${customer.firstName} ${customer.lastName}`.trim() || invoice.customerSnapshot.name;
    const branding = await getInvoiceBusinessBranding(session.user.id);
    const pdfBuffer = await buildInvoicePdfBuffer({
      invoice,
      status,
      customer: {
        name: customerName,
        email: customer.email ?? null,
        phone: customer.phone ?? invoice.customerSnapshot.phone ?? null,
        company: customer.company ?? null,
        address: customer.address ?? null,
        city: customer.city ?? null,
        country: customer.country ?? null,
      },
      branding,
    });

    const filename = invoicePdfFilename(invoice.invoiceNumber);
    const invoiceUrl = await ensurePublicInvoiceUrl(session.user.id, invoice._id!);
    const content = buildInvoiceEmailContent({
      invoice,
      status,
      customerName,
      branding,
      invoiceUrl,
    });

    const result = await sendEmail({
      to: recipient,
      subject: content.subject,
      html: content.html,
      text: content.text,
      // Display name only — EMAIL_FROM address remains server-controlled.
      fromDisplayName: branding.businessName !== "Ledger" ? branding.businessName : undefined,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return NextResponse.json({
      data: {
        sent: true,
        to: recipient,
        invoiceNumber: invoice.invoiceNumber,
        messageId: result.id,
      },
    });
  } catch (error) {
    if (error instanceof EmailConfigurationError) {
      return errorResponse(error.message, 503);
    }
    if (error instanceof EmailDeliveryError) {
      return errorResponse("Unable to send invoice email. Please try again later.", 502);
    }
    if (error instanceof Error && error.message.includes("is invalid")) {
      return errorResponse("Invalid invoice id", 400);
    }
    console.error("Invoice email failed", error instanceof Error ? error.name : "unknown");
    return errorResponse("Unable to send invoice email", 500);
  }
}

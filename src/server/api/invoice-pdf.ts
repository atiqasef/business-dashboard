import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection } from "@/server/db/models/invoice";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/server/invoices/pdf";
import { deriveInvoiceStatus } from "@/server/invoices/status";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getId(value: unknown, field: string) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) throw new Error(`${field} is invalid`);
  return new ObjectId(value);
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

/** Read-only PDF download. Demo users are allowed; nothing is mutated. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    await ensureInvoiceIndexes();

    const id = getId((await context.params).id, "invoice id");
    const invoice = await getInvoicesCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);

    const customer = await getCustomersCollection().findOne(
      { _id: invoice.customerId, ownerId: session.user.id },
      { projection: { company: 1, address: 1, city: 1, country: 1, firstName: 1, lastName: 1, email: 1, phone: 1 } },
    );

    // Derive status for display only — do not persist changes from the PDF route.
    const status = deriveInvoiceStatus(invoice);
    const pdfBuffer = await buildInvoicePdfBuffer({
      invoice,
      status,
      customer: {
        name: invoice.customerSnapshot.name || (customer ? `${customer.firstName} ${customer.lastName}`.trim() : "Customer"),
        email: invoice.customerSnapshot.email ?? customer?.email ?? null,
        phone: invoice.customerSnapshot.phone ?? customer?.phone ?? null,
        company: customer?.company ?? null,
        address: customer?.address ?? null,
        city: customer?.city ?? null,
        country: customer?.country ?? null,
      },
      businessName: "Ledger",
    });

    const filename = invoicePdfFilename(invoice.invoiceNumber);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) {
      return errorResponse("Invalid invoice id", 400);
    }
    return errorResponse("Unable to generate invoice PDF", 500);
  }
}

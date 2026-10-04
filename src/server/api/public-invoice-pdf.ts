import { NextResponse } from "next/server";
import { getCustomersCollection } from "@/server/db/models/customer";
import { resolvePublicInvoiceByToken } from "@/server/invoices/public-access";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/server/invoices/pdf";
import { deriveInvoiceStatus } from "@/server/invoices/status";
import { getInvoiceBusinessBranding } from "@/server/settings/business-profile";

function invalidLinkResponse() {
  return NextResponse.json(
    { error: "This invoice link is invalid or has expired." },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Customer-facing PDF download authorized solely by the public access token. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const resolved = await resolvePublicInvoiceByToken(token);
    if (!resolved.ok) return invalidLinkResponse();

    const { invoice, access } = resolved;
    const branding = await getInvoiceBusinessBranding(access.ownerId);
    const customer = await getCustomersCollection().findOne(
      { _id: invoice.customerId, ownerId: access.ownerId },
      {
        projection: {
          firstName: 1,
          lastName: 1,
          email: 1,
          phone: 1,
          company: 1,
          address: 1,
          city: 1,
          country: 1,
        },
      },
    );

    const status = deriveInvoiceStatus(invoice);
    const pdfBuffer = await buildInvoicePdfBuffer({
      invoice,
      status,
      customer: {
        name:
          (customer ? `${customer.firstName} ${customer.lastName}`.trim() : "") ||
          invoice.customerSnapshot.name,
        email: customer?.email ?? invoice.customerSnapshot.email ?? null,
        phone: customer?.phone ?? invoice.customerSnapshot.phone ?? null,
        company: customer?.company ?? null,
        address: customer?.address ?? null,
        city: customer?.city ?? null,
        country: customer?.country ?? null,
      },
      branding,
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
  } catch {
    return NextResponse.json(
      { error: "Unable to download invoice PDF." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

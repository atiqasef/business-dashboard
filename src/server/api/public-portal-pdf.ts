import { NextResponse } from "next/server";
import { CustomerPortalAccessError, getPortalInvoiceByNumber } from "@/server/portal/access";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/server/invoices/pdf";
import { deriveInvoiceStatus } from "@/server/invoices/status";

function invalidResponse() {
  return NextResponse.json(
    { error: "This portal link is invalid or has expired." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; invoiceNumber: string }> },
) {
  try {
    const { token, invoiceNumber } = await context.params;
    const { resolved, invoice } = await getPortalInvoiceByNumber(token, decodeURIComponent(invoiceNumber));
    const status = deriveInvoiceStatus(invoice);

    const pdfBuffer = await buildInvoicePdfBuffer({
      invoice,
      status,
      customer: {
        name: resolved.customer.name,
        email: resolved.customer.email,
        phone: resolved.customer.phone,
        company: resolved.customer.company,
        address: resolved.customer.address,
        city: resolved.customer.city,
        country: resolved.customer.country,
      },
      branding: resolved.business,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoicePdfFilename(invoice.invoiceNumber)}"`,
        "Content-Length": String(pdfBuffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) {
      if (error.status === 404) return invalidResponse();
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Unable to download invoice PDF." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { describe, expect, it } from "vitest";
import { GET as downloadInvoicePdf } from "@/server/api/invoice-pdf";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getPaymentsCollection } from "@/server/db/models/payment";
import { invoicePdfFilename } from "@/server/invoices/pdf";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { ObjectId } from "mongodb";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

describe("invoice PDF download", () => {
  it("rejects unauthenticated PDF requests", async () => {
    mockSession(null);
    const response = await downloadInvoicePdf(
      jsonRequest("GET", "http://localhost/api/invoices/000000000000000000000001/pdf"),
      params("000000000000000000000001"),
    );
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Authentication required" });
  });

  it("lets the authenticated owner download their invoice PDF without mutating data", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 50 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id, { tax: 5 });
    const invoiceId = String(invoice.data?.id);
    const invoiceNumber = String(invoice.data?.invoiceNumber);

    await createPaymentForInvoice(userA, invoiceId, 20);

    const invoiceObjectId = new ObjectId(invoiceId);
    const beforeInvoice = await getInvoicesCollection().findOne({ _id: invoiceObjectId });
    const beforePayments = await getPaymentsCollection().countDocuments({ ownerId: userA.id });
    const beforeUpdatedAt = beforeInvoice?.updatedAt.getTime();

    mockSession(userA);
    const response = await downloadInvoicePdf(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId}/pdf`),
      params(invoiceId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain(`filename="${invoicePdfFilename(invoiceNumber)}"`);

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(500);
    expect(body.subarray(0, 4).toString("utf8")).toBe("%PDF");

    const afterInvoice = await getInvoicesCollection().findOne({ _id: invoiceObjectId });
    expect(afterInvoice?.updatedAt.getTime()).toBe(beforeUpdatedAt);
    expect(afterInvoice?.paidAmount).toBe(beforeInvoice?.paidAmount);
    expect(afterInvoice?.outstandingAmount).toBe(beforeInvoice?.outstandingAmount);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id })).toBe(beforePayments);
  });

  it("hides another owner's invoice from the PDF endpoint", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 40 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userB);
    const response = await downloadInvoicePdf(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId}/pdf`),
      params(invoiceId),
    );

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: "Invoice not found" });
  });

  it("allows demo users to download an invoice PDF as a read operation", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id);
    const product = await seedProduct(demoUser.id, { price: 25 });
    const order = await seedOrder(demoUser.id, customer._id, product._id);

    // Seed invoice directly — demo users cannot mutate via POST.
    const now = new Date();
    const invoiceId = new ObjectId();
    await getInvoicesCollection().insertOne({
      _id: invoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-2026-009999",
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Demo Customer", email: "demo.customer@example.test" },
      items: [
        {
          productId: product._id,
          productName: product.name,
          quantity: 2,
          unitPrice: 25,
          lineTotal: 50,
        },
      ],
      subtotal: 50,
      discount: 0,
      tax: 0,
      total: 50,
      paidAmount: 0,
      outstandingAmount: 50,
      issueDate: now,
      status: "issued",
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const response = await downloadInvoicePdf(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId.toHexString()}/pdf`),
      params(invoiceId.toHexString()),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("rejects invalid invoice ids", async () => {
    mockSession(userA);
    const response = await downloadInvoicePdf(
      jsonRequest("GET", "http://localhost/api/invoices/not-an-id/pdf"),
      params("not-an-id"),
    );
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: "Invalid invoice id" });
  });
});

describe("invoice PDF helpers", () => {
  it("sanitizes download filenames from invoice numbers", () => {
    expect(invoicePdfFilename("INV-2026-000001")).toBe("invoice-INV-2026-000001.pdf");
    expect(invoicePdfFilename("INV/2026:001")).toBe("invoice-INV-2026-001.pdf");
  });
});

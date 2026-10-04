import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { POST as emailInvoice } from "@/server/api/invoice-email";
import { sendEmail } from "@/server/email/send-email";
import { EmailConfigurationError, EmailDeliveryError } from "@/server/email/types";
import { invoicePdfFilename } from "@/server/invoices/pdf";
import { getCustomersCollection } from "@/server/db/models/customer";
import { createInvoiceFromOrder } from "../helpers/billing";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

vi.mock("@/server/email/send-email", () => ({
  sendEmail: vi.fn(),
}));

describe("invoice email delivery", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "email_test_123" });
  });

  it("rejects unauthenticated email requests", async () => {
    mockSession(null);
    const response = await emailInvoice(
      jsonRequest("POST", "http://localhost/api/invoices/000000000000000000000001/email", {}),
      params("000000000000000000000001"),
    );
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Authentication required" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends an invoice email with the generated PDF attachment for the owner", async () => {
    const customer = await seedCustomer(userA.id, {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada.owner@example.test",
    });
    const product = await seedProduct(userA.id, { price: 40, name: "Notebook" });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id, { tax: 2 });
    const invoiceId = String(invoice.data?.id);
    const invoiceNumber = String(invoice.data?.invoiceNumber);

    mockSession(userA);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {
        ownerId: userB.id,
        to: "spoof@example.test",
        total: 1,
      }),
      params(invoiceId),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      data: {
        sent: true,
        to: "ada.owner@example.test",
        invoiceNumber,
        messageId: "email_test_123",
      },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(sendEmail).mock.calls[0]?.[0];
    expect(payload?.to).toBe("ada.owner@example.test");
    expect(payload?.subject).toContain(invoiceNumber);
    expect(payload?.html).toContain(invoiceNumber);
    expect(payload?.text).toContain(invoiceNumber);
    expect(payload?.attachments).toHaveLength(1);
    expect(payload?.attachments?.[0]?.filename).toBe(invoicePdfFilename(invoiceNumber));
    expect(payload?.attachments?.[0]?.contentType).toBe("application/pdf");
    expect(payload?.attachments?.[0]?.content.byteLength).toBeGreaterThan(500);
    expect(payload?.attachments?.[0]?.content.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("hides another owner's invoice from the email endpoint", async () => {
    const customer = await seedCustomer(userA.id, { email: "owner-a@example.test" });
    const product = await seedProduct(userA.id, { price: 20 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userB);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {}),
      params(invoiceId),
    );

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: "Invoice not found" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rejects customers without an email address", async () => {
    const customer = await seedCustomer(userA.id, { email: undefined });
    await getCustomersCollection().updateOne({ _id: customer._id }, { $unset: { email: "" } });
    const product = await seedProduct(userA.id, { price: 15 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userA);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {}),
      params(invoiceId),
    );

    expect(response.status).toBe(422);
    expect(await readJson(response)).toEqual({
      error: "Customer needs a valid email address before this invoice can be emailed.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks demo accounts from sending real email", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id, { email: "demo.customer@example.test" });
    const product = await seedProduct(demoUser.id, { price: 12 });
    const order = await seedOrder(demoUser.id, customer._id, product._id);

    // Seed invoice directly — demo users cannot create invoices via POST.
    const now = new Date();
    const invoiceId = new ObjectId();
    const { getInvoicesCollection } = await import("@/server/db/models/invoice");
    await getInvoicesCollection().insertOne({
      _id: invoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-2026-008888",
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Demo Customer", email: "demo.customer@example.test" },
      items: [{ productId: product._id, productName: product.name, quantity: 1, unitPrice: 12, lineTotal: 12 }],
      subtotal: 12,
      discount: 0,
      tax: 0,
      total: 12,
      paidAmount: 0,
      outstandingAmount: 12,
      issueDate: now,
      status: "issued",
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId.toHexString()}/email`, {}),
      params(invoiceId.toHexString()),
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "Email sending is disabled for the demo account.",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns a configuration error when email is not configured", async () => {
    const customer = await seedCustomer(userA.id, { email: "config@example.test" });
    const product = await seedProduct(userA.id, { price: 18 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    vi.mocked(sendEmail).mockRejectedValueOnce(new EmailConfigurationError("Email is not configured. Set RESEND_API_KEY and EMAIL_FROM."));

    mockSession(userA);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {}),
      params(invoiceId),
    );

    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({
      error: "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
    });
  });

  it("handles email provider failures safely", async () => {
    const customer = await seedCustomer(userA.id, { email: "fail@example.test" });
    const product = await seedProduct(userA.id, { price: 22 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    vi.mocked(sendEmail).mockRejectedValueOnce(new EmailDeliveryError("provider down"));

    mockSession(userA);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {}),
      params(invoiceId),
    );

    expect(response.status).toBe(502);
    expect(await readJson(response)).toEqual({
      error: "Unable to send invoice email. Please try again later.",
    });
  });
});

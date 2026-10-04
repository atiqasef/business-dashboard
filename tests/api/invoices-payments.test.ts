import { describe, expect, it } from "vitest";
import { GET as listInvoices, POST as createInvoice, GET_BY_ID as getInvoice, PATCH as patchInvoice, DELETE as cancelInvoice } from "@/server/api/invoices";
import { GET as listPayments, POST as createPayment, DELETE as voidPayment } from "@/server/api/payments";
import { getDashboardData } from "@/server/dashboard/get-dashboard-data";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getPaymentsCollection } from "@/server/db/models/payment";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

describe("invoice authorization and ownership", () => {
  it("rejects unauthenticated invoice access", async () => {
    mockSession(null);
    expect((await listInvoices(jsonRequest("GET", "http://localhost/api/invoices"))).status).toBe(401);
    expect((await createInvoice(jsonRequest("POST", "http://localhost/api/invoices", { orderId: "x" }))).status).toBe(401);
  });

  it("creates an invoice from an owned order with server-side totals and numbering", async () => {
    const customer = await seedCustomer(userA.id, { firstName: "Maya", lastName: "Chen", email: "maya@example.test" });
    const product = await seedProduct(userA.id, { name: "Notebook", price: 20 });
    const order = await seedOrder(userA.id, customer._id, product._id, {
      subtotal: 40,
      discount: 5,
      total: 35,
      items: [{ productId: product._id, quantity: 2, unitPrice: 20, lineTotal: 40 }],
    });

    const { response, data } = await createInvoiceFromOrder(userA, order.id, { tax: 2.5 });
    expect(response.status).toBe(201);
    expect(data?.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(data).toMatchObject({
      subtotal: 40,
      discount: 5,
      tax: 2.5,
      total: 37.5,
      paidAmount: 0,
      outstandingAmount: 37.5,
      status: "issued",
      orderId: order.id,
      customerId: customer.id,
    });
    expect((data?.customerSnapshot as { name: string }).name).toBe("Maya Chen");
  });

  it("prevents duplicate active invoices and cross-owner invoice creation/access", async () => {
    const customerA = await seedCustomer(userA.id);
    const productA = await seedProduct(userA.id);
    const orderA = await seedOrder(userA.id, customerA._id, productA._id);
    const first = await createInvoiceFromOrder(userA, orderA.id);
    expect(first.response.status).toBe(201);

    const duplicate = await createInvoiceFromOrder(userA, orderA.id);
    expect(duplicate.response.status).toBe(409);

    mockSession(userB);
    const foreignCreate = await createInvoice(
      jsonRequest("POST", "http://localhost/api/invoices", { orderId: orderA.id, tax: 0, issue: true }),
    );
    expect(foreignCreate.status).toBe(404);

    const foreignGet = await getInvoice(
      jsonRequest("GET", `http://localhost/api/invoices/${first.data?.id}`),
      params(String(first.data?.id)),
    );
    expect(foreignGet.status).toBe(404);
  });

  it("supports invoice list filtering and rejects protected field updates", async () => {
    const customer = await seedCustomer(userA.id, { firstName: "Priya" });
    const product = await seedProduct(userA.id);
    const order = await seedOrder(userA.id, customer._id, product._id);
    const created = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(created.data?.id);

    mockSession(userA);
    const listed = await readJson(await listInvoices(jsonRequest("GET", "http://localhost/api/invoices?search=INV&status=issued")));
    expect((listed?.data as unknown[]).length).toBe(1);

    const patch = await patchInvoice(
      jsonRequest("PATCH", `http://localhost/api/invoices/${invoiceId}`, { ownerId: userB.id, total: 1 }),
      params(invoiceId),
    );
    expect(patch.status).toBe(400);
  });
});

describe("payment workflows and invoice status", () => {
  it("records partial and full payments, rejects overpayment, and updates status", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 50 });
    const order = await seedOrder(userA.id, customer._id, product._id, {
      subtotal: 100,
      discount: 0,
      total: 100,
      items: [{ productId: product._id, quantity: 2, unitPrice: 50, lineTotal: 100 }],
    });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    const partial = await createPaymentForInvoice(userA, invoiceId, 40);
    expect(partial.response.status).toBe(201);
    expect(partial.data?.invoice).toMatchObject({
      paidAmount: 40,
      outstandingAmount: 60,
      status: "partially_paid",
    });

    const overpay = await createPaymentForInvoice(userA, invoiceId, 61);
    expect(overpay.response.status).toBe(409);

    const zero = await createPaymentForInvoice(userA, invoiceId, 0);
    expect(zero.response.status).toBe(400);

    const remainder = await createPaymentForInvoice(userA, invoiceId, 60, { paymentMethod: "card" });
    expect(remainder.response.status).toBe(201);
    expect(remainder.data?.invoice).toMatchObject({
      paidAmount: 100,
      outstandingAmount: 0,
      status: "paid",
    });

    mockSession(userA);
    const detail = await readJson(await getInvoice(jsonRequest("GET", `http://localhost/api/invoices/${invoiceId}`), params(invoiceId)));
    expect((detail?.data as { payments: unknown[] }).payments).toHaveLength(2);
  });

  it("blocks payments against another owner's invoice and supports voiding", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id);
    const order = await seedOrder(userA.id, customer._id, product._id, { total: 40, subtotal: 40 });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);
    const payment = await createPaymentForInvoice(userA, invoiceId, 15);
    const paymentId = String((payment.data?.payment as { id: string }).id);

    mockSession(userB);
    const foreignPayment = await createPayment(
      jsonRequest("POST", "http://localhost/api/payments", {
        invoiceId,
        amount: 10,
        paymentMethod: "cash",
      }),
    );
    expect(foreignPayment.status).toBe(404);

    mockSession(userA);
    const voided = await voidPayment(jsonRequest("DELETE", `http://localhost/api/payments/${paymentId}`), params(paymentId));
    const voidBody = await readJson(voided);
    expect(voided.status).toBe(200);
    expect(voidBody?.data).toMatchObject({
      payment: { voidedAt: expect.any(String) },
      invoice: { paidAmount: 0, outstandingAmount: 40, status: "issued" },
    });

    const payments = await getPaymentsCollection().find({ ownerId: userA.id, invoiceId: (await getInvoicesCollection().findOne({}))!._id }).toArray();
    expect(payments[0]?.voidedAt).toBeTruthy();
  });

  it("cancels unpaid invoices and rejects cancel when payments exist", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id);
    const order = await seedOrder(userA.id, customer._id, product._id, { total: 20, subtotal: 20 });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userA);
    const cancelled = await cancelInvoice(jsonRequest("DELETE", `http://localhost/api/invoices/${invoiceId}`), params(invoiceId));
    expect(cancelled.status).toBe(200);
    expect((await readJson(cancelled))?.data).toMatchObject({ status: "cancelled" });

    const order2 = await seedOrder(userA.id, customer._id, product._id, { total: 20, subtotal: 20 });
    const invoice2 = await createInvoiceFromOrder(userA, order2.id);
    const invoice2Id = String(invoice2.data?.id);
    await createPaymentForInvoice(userA, invoice2Id, 5);
    mockSession(userA);
    const blocked = await cancelInvoice(jsonRequest("DELETE", `http://localhost/api/invoices/${invoice2Id}`), params(invoice2Id));
    expect(blocked.status).toBe(409);
  });
});

describe("demo account invoice/payment restrictions", () => {
  it("allows demo reads but blocks invoice and payment mutations", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id);
    const product = await seedProduct(demoUser.id);
    const order = await seedOrder(demoUser.id, customer._id, product._id, { total: 20, subtotal: 20 });

    // Seed invoice as a normal write path by temporarily using API with demo user should fail;
    // insert via helper after creating with userA pattern: create through API will be blocked.
    // Create invoice document using owner demo by calling create while mocked as demo after inserting via order owner path:
    // Use createInvoiceFromOrder which uses demo session - expect 403.
    const blockedCreate = await createInvoiceFromOrder(demoUser, order.id);
    expect(blockedCreate.response.status).toBe(403);

    // Create invoice using direct collection for read tests.
    mockSession(userA);
    // Can't create for demo order as userA. Insert directly:
    const { nextInvoiceNumber } = await import("@/server/db/models/invoice-sequence");
    const { ensureInvoiceIndexes, getInvoicesCollection } = await import("@/server/db/models/invoice");
    await ensureInvoiceIndexes();
    const now = new Date();
    const invoiceNumber = await nextInvoiceNumber(demoUser.id, now);
    const insert = await getInvoicesCollection().insertOne({
      ownerId: demoUser.id,
      invoiceNumber,
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Atiq" },
      items: [{ productId: product._id, productName: "Notebook", quantity: 1, unitPrice: 20, lineTotal: 20 }],
      subtotal: 20,
      discount: 0,
      tax: 0,
      total: 20,
      paidAmount: 0,
      outstandingAmount: 20,
      issueDate: now,
      status: "issued",
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const list = await listInvoices(jsonRequest("GET", "http://localhost/api/invoices"));
    expect(list.status).toBe(200);
    expect(((await readJson(list))?.data as unknown[]).length).toBe(1);

    const pay = await createPayment(
      jsonRequest("POST", "http://localhost/api/payments", {
        invoiceId: insert.insertedId.toHexString(),
        amount: 5,
        paymentMethod: "cash",
      }),
    );
    expect(pay.status).toBe(403);

    const cancel = await cancelInvoice(
      jsonRequest("DELETE", `http://localhost/api/invoices/${insert.insertedId.toHexString()}`),
      params(insert.insertedId.toHexString()),
    );
    expect(cancel.status).toBe(403);
  });
});

describe("dashboard receivables metrics", () => {
  it("reports outstanding, collected, unpaid, and overdue separately from order revenue", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 50 });
    const order = await seedOrder(userA.id, customer._id, product._id, {
      total: 100,
      subtotal: 100,
      status: "completed",
      items: [{ productId: product._id, quantity: 2, unitPrice: 50, lineTotal: 100 }],
    });
    const invoice = await createInvoiceFromOrder(userA, order.id, {
      dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await createPaymentForInvoice(userA, String(invoice.data?.id), 25);

    const data = await getDashboardData(userA.id);
    expect(data.summary.totalRevenue).toBe(100);
    expect(data.summary.collectedPayments).toBe(25);
    expect(data.summary.outstandingReceivables).toBe(75);
    expect(data.summary.unpaidInvoiceCount).toBe(1);
    expect(data.summary.overdueInvoiceCount).toBe(1);
  });
});

describe("payment list auth", () => {
  it("rejects unauthenticated payment listing", async () => {
    mockSession(null);
    expect((await listPayments(jsonRequest("GET", "http://localhost/api/payments"))).status).toBe(401);
  });
});

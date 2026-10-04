import { describe, expect, it } from "vitest";
import { GET as listInvoices } from "@/server/api/invoices";
import {
  GET as listPayments,
  GET_BY_ID as getPayment,
  POST as createPayment,
  DELETE as voidPayment,
} from "@/server/api/payments";
import { getDashboardData } from "@/server/dashboard/get-dashboard-data";
import { listPayments as listPaymentsData } from "@/server/payments/list-payments";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

describe("payments management authorization", () => {
  it("rejects unauthenticated list, detail, create, and void", async () => {
    mockSession(null);
    expect((await listPayments(jsonRequest("GET", "http://localhost/api/payments"))).status).toBe(401);
    expect(
      (await getPayment(jsonRequest("GET", "http://localhost/api/payments/000000000000000000000001"), params("000000000000000000000001")))
        .status,
    ).toBe(401);
    expect(
      (
        await createPayment(
          jsonRequest("POST", "http://localhost/api/payments", {
            invoiceId: "000000000000000000000001",
            amount: 10,
            paymentMethod: "cash",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await voidPayment(
          jsonRequest("DELETE", "http://localhost/api/payments/000000000000000000000001"),
          params("000000000000000000000001"),
        )
      ).status,
    ).toBe(401);
  });

  it("scopes list and detail to the session owner and hides foreign payments", async () => {
    const customerA = await seedCustomer(userA.id, { firstName: "Alice", email: "alice@example.test" });
    const productA = await seedProduct(userA.id, { price: 40 });
    const orderA = await seedOrder(userA.id, customerA._id, productA._id, { total: 40, subtotal: 40 });
    const invoiceA = await createInvoiceFromOrder(userA, orderA.id);
    const paymentA = await createPaymentForInvoice(userA, String(invoiceA.data?.id), 15, {
      reference: "REF-ALICE",
      paymentDate: daysAgo(1).toISOString(),
    });

    const customerB = await seedCustomer(userB.id, { firstName: "Bob" });
    const productB = await seedProduct(userB.id, { price: 100 });
    const orderB = await seedOrder(userB.id, customerB._id, productB._id, { total: 100, subtotal: 100 });
    const invoiceB = await createInvoiceFromOrder(userB, orderB.id);
    await createPaymentForInvoice(userB, String(invoiceB.data?.id), 100);

    mockSession(userA);
    const listed = await listPayments(jsonRequest("GET", "http://localhost/api/payments?pageSize=20"));
    const listedBody = await readJson(listed);
    expect(listed.status).toBe(200);
    expect((listedBody?.data as unknown[]).length).toBe(1);
    expect((listedBody?.data as Array<{ customerName: string }>)[0]?.customerName).toBe("Alice Lovelace");
    expect(listedBody?.summary).toMatchObject({
      totalCollected: 15,
      paymentCount: 1,
      activePaymentCount: 1,
      averagePayment: 15,
    });

    const paymentId = String((paymentA.data as { payment: { id: string } }).payment.id);
    const detail = await getPayment(jsonRequest("GET", `http://localhost/api/payments/${paymentId}`), params(paymentId));
    expect(detail.status).toBe(200);
    expect((await readJson(detail))?.data).toMatchObject({
      id: paymentId,
      invoiceNumber: invoiceA.data?.invoiceNumber,
      customerName: "Alice Lovelace",
      status: "active",
    });

    mockSession(userB);
    const foreignDetail = await getPayment(
      jsonRequest("GET", `http://localhost/api/payments/${paymentId}`),
      params(paymentId),
    );
    expect(foreignDetail.status).toBe(404);
    expect(await readJson(foreignDetail)).toEqual({ error: "Payment not found" });
  });
});

describe("payments management search filters pagination summary", () => {
  it("supports invoice/customer/reference search, method/status/date filters, and pagination", async () => {
    const customer = await seedCustomer(userA.id, { firstName: "Priya", lastName: "Shah", email: "priya@example.test" });
    const product = await seedProduct(userA.id, { price: 50 });
    const order = await seedOrder(userA.id, customer._id, product._id, { total: 100, subtotal: 100 });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);
    const invoiceNumber = String(invoice.data?.invoiceNumber);

    await createPaymentForInvoice(userA, invoiceId, 20, {
      reference: "WIRE-100",
      paymentMethod: "bank_transfer",
      paymentDate: daysAgo(2).toISOString(),
    });
    await createPaymentForInvoice(userA, invoiceId, 30, {
      reference: "CARD-200",
      paymentMethod: "card",
      paymentDate: daysAgo(40).toISOString(),
    });
    const voidable = await createPaymentForInvoice(userA, invoiceId, 10, {
      reference: "CASH-300",
      paymentMethod: "cash",
      paymentDate: daysAgo(1).toISOString(),
    });
    const voidableId = String((voidable.data as { payment: { id: string } }).payment.id);
    mockSession(userA);
    await voidPayment(jsonRequest("DELETE", `http://localhost/api/payments/${voidableId}`), params(voidableId));

    const byInvoice = await listPaymentsData(userA.id, { search: invoiceNumber, pageSize: 20 });
    expect(byInvoice.data.length).toBe(3);
    expect(byInvoice.data.every((payment) => payment.invoiceNumber === invoiceNumber)).toBe(true);

    const byCustomer = await listPaymentsData(userA.id, { search: "Priya", pageSize: 20 });
    expect(byCustomer.data.length).toBe(3);

    const byReference = await listPaymentsData(userA.id, { search: "WIRE-100", pageSize: 20 });
    expect(byReference.data).toHaveLength(1);
    expect(byReference.data[0]?.reference).toBe("WIRE-100");

    const byMethod = await listPaymentsData(userA.id, { paymentMethod: "card", pageSize: 20 });
    expect(byMethod.data).toHaveLength(1);
    expect(byMethod.data[0]?.paymentMethod).toBe("card");

    const activeOnly = await listPaymentsData(userA.id, { status: "active", pageSize: 20 });
    expect(activeOnly.data.every((payment) => payment.status === "active")).toBe(true);
    expect(activeOnly.summary.totalCollected).toBe(50);
    expect(activeOnly.summary.activePaymentCount).toBe(2);

    const voidedOnly = await listPaymentsData(userA.id, { status: "voided", pageSize: 20 });
    expect(voidedOnly.data).toHaveLength(1);
    expect(voidedOnly.summary.totalCollected).toBe(0);

    const last30 = await listPaymentsData(userA.id, { datePreset: "last_30_days", status: "active", pageSize: 20 });
    expect(last30.data.map((payment) => payment.reference).sort()).toEqual(["WIRE-100"]);

    const page1 = await listPaymentsData(userA.id, { page: 1, pageSize: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const page2 = await listPaymentsData(userA.id, { page: 2, pageSize: 2 });
    expect(page2.data).toHaveLength(1);

    const dashboard = await getDashboardData(userA.id);
    expect(page1.summary.outstandingReceivables).toBe(dashboard.summary.outstandingReceivables);
  });
});

describe("payments management mutations and demo", () => {
  it("rejects foreign invoice payment creation and ignores spoofed ownerId", async () => {
    const customerA = await seedCustomer(userA.id);
    const productA = await seedProduct(userA.id, { price: 25 });
    const orderA = await seedOrder(userA.id, customerA._id, productA._id, { total: 25, subtotal: 25 });
    const invoiceA = await createInvoiceFromOrder(userA, orderA.id);

    mockSession(userB);
    const foreign = await createPayment(
      jsonRequest("POST", "http://localhost/api/payments", {
        invoiceId: invoiceA.data?.id,
        amount: 5,
        paymentMethod: "cash",
        ownerId: userA.id,
      }),
    );
    expect(foreign.status).toBe(404);

    mockSession(userA);
    const overpay = await createPayment(
      jsonRequest("POST", "http://localhost/api/payments", {
        invoiceId: invoiceA.data?.id,
        amount: 999,
        paymentMethod: "cash",
      }),
    );
    expect(overpay.status).toBe(409);
  });

  it("allows demo read and rejects demo create/void", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id, { firstName: "Demo" });
    const product = await seedProduct(demoUser.id, { price: 20 });
    const order = await seedOrder(demoUser.id, customer._id, product._id, { total: 20, subtotal: 20 });

    // Seed invoice/payment directly — demo cannot mutate through APIs.
    const { getInvoicesCollection } = await import("@/server/db/models/invoice");
    const { getPaymentsCollection } = await import("@/server/db/models/payment");
    const { ObjectId } = await import("mongodb");
    const now = new Date();
    const invoiceId = new ObjectId();
    const paymentId = new ObjectId();
    await getInvoicesCollection().insertOne({
      _id: invoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-2026-000777",
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Demo Customer", email: "demo.customer@example.test" },
      items: [{ productId: product._id, productName: product.name, quantity: 1, unitPrice: 20, lineTotal: 20 }],
      subtotal: 20,
      discount: 0,
      tax: 0,
      total: 20,
      paidAmount: 5,
      outstandingAmount: 15,
      issueDate: now,
      status: "partially_paid",
      createdAt: now,
      updatedAt: now,
    });
    await getPaymentsCollection().insertOne({
      _id: paymentId,
      ownerId: demoUser.id,
      invoiceId,
      orderId: order._id,
      customerId: customer._id,
      amount: 5,
      paymentMethod: "cash",
      paymentDate: now,
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const listed = await listPayments(jsonRequest("GET", "http://localhost/api/payments"));
    expect(listed.status).toBe(200);
    expect(((await readJson(listed))?.data as unknown[]).length).toBe(1);

    const detail = await getPayment(
      jsonRequest("GET", `http://localhost/api/payments/${paymentId.toHexString()}`),
      params(paymentId.toHexString()),
    );
    expect(detail.status).toBe(200);

    const create = await createPayment(
      jsonRequest("POST", "http://localhost/api/payments", {
        invoiceId: invoiceId.toHexString(),
        amount: 5,
        paymentMethod: "cash",
      }),
    );
    expect(create.status).toBe(403);

    const voided = await voidPayment(
      jsonRequest("DELETE", `http://localhost/api/payments/${paymentId.toHexString()}`),
      params(paymentId.toHexString()),
    );
    expect(voided.status).toBe(403);
  });

  it("lists payable invoices for payment recording without loading drafts or paid invoices", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 30 });
    const order = await seedOrder(userA.id, customer._id, product._id, { total: 30, subtotal: 30 });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    await createPaymentForInvoice(userA, String(invoice.data?.id), 30);

    const order2 = await seedOrder(userA.id, customer._id, product._id, { total: 30, subtotal: 30 });
    const openInvoice = await createInvoiceFromOrder(userA, order2.id);

    mockSession(userA);
    const payable = await listInvoices(jsonRequest("GET", "http://localhost/api/invoices?payable=1"));
    const body = await readJson(payable);
    expect(payable.status).toBe(200);
    const ids = ((body?.data as Array<{ id: string }>) ?? []).map((item) => item.id);
    expect(ids).toContain(String(openInvoice.data?.id));
    expect(ids).not.toContain(String(invoice.data?.id));
  });
});

import { describe, expect, it } from "vitest";
import { GET as getReports } from "@/server/api/reports";
import { getPaymentsCollection } from "@/server/db/models/payment";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { percentChange, resolveReportRange, startOfUtcDay } from "@/server/reports/date-range";
import { getReportData } from "@/server/reports/get-report-data";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { mockSession, userA, userB } from "../helpers/auth";
import { seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, readJson } from "../helpers/http";

function daysAgo(days: number, hour = 12) {
  const today = startOfUtcDay(new Date());
  const date = new Date(today);
  date.setUTCDate(today.getUTCDate() - days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

describe("reports authorization", () => {
  it("rejects unauthenticated report requests", async () => {
    mockSession(null);
    const response = await getReports(jsonRequest("GET", "http://localhost/api/reports"));
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Authentication required" });
  });

  it("ignores client-supplied ownerId and isolates owners", async () => {
    const customerA = await seedCustomer(userA.id, { firstName: "Alice" });
    const productA = await seedProduct(userA.id, { price: 20 });
    await seedOrder(userA.id, customerA._id, productA._id, {
      total: 40,
      subtotal: 40,
      status: "completed",
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });

    const customerB = await seedCustomer(userB.id, { firstName: "Bob" });
    const productB = await seedProduct(userB.id, { price: 100 });
    await seedOrder(userB.id, customerB._id, productB._id, {
      total: 500,
      subtotal: 500,
      status: "completed",
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    });

    mockSession(userA);
    const response = await getReports(
      jsonRequest("GET", "http://localhost/api/reports?ownerId=user-b&userId=user-b&preset=last_30_days"),
    );
    const body = await readJson(response);
    const data = body?.data as {
      summary: { orderRevenue: number; totalOrders: number };
      topCustomers: Array<{ name: string; revenue: number }>;
    };

    expect(response.status).toBe(200);
    expect(data.summary.orderRevenue).toBe(40);
    expect(data.summary.totalOrders).toBe(1);
    expect(data.topCustomers.map((customer) => customer.name)).toEqual(["Alice Lovelace"]);
  });
});

describe("report date ranges", () => {
  it("defaults to last 30 days and validates custom ranges", () => {
    const range = resolveReportRange({});
    expect(range.preset).toBe("last_30_days");
    expect(range.granularity).toBe("day");

    const seven = resolveReportRange({ preset: "last_7_days" });
    expect(seven.preset).toBe("last_7_days");
    const span =
      Math.floor((seven.end.getTime() - seven.start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    expect(span).toBe(7);

    expect(() => resolveReportRange({ preset: "nope" })).toThrow("Invalid report preset");
    expect(() => resolveReportRange({ preset: "custom" })).toThrow("Custom range requires");
    expect(() =>
      resolveReportRange({ preset: "custom", start: "2026-02-01", end: "2026-01-01" }),
    ).toThrow("start must be on or before end");
  });

  it("aggregates last-7-days and last-30-days revenue correctly", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 10 });

    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 25,
      subtotal: 25,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 75,
      subtotal: 75,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
    });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 999,
      subtotal: 999,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
    });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "cancelled",
      total: 50,
      subtotal: 50,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });

    const last7 = await getReportData(userA.id, { preset: "last_7_days" });
    expect(last7.summary.orderRevenue).toBe(25);
    expect(last7.summary.totalOrders).toBe(2);
    expect(last7.summary.cancelledOrders).toBe(1);
    expect(last7.summary.averageOrderValue).toBe(25);

    const last30 = await getReportData(userA.id, { preset: "last_30_days" });
    expect(last30.summary.orderRevenue).toBe(100);
    expect(last30.summary.revenueOrderCount).toBe(2);
    expect(last30.summary.averageOrderValue).toBe(50);
  });
});

describe("report aggregations", () => {
  it("aggregates payment collections separately from order revenue", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 50, stock: 20 });
    const order = await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 100,
      subtotal: 100,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    });

    const { data: invoice } = await createInvoiceFromOrder(userA, order.id);
    expect(invoice?.id).toBeTruthy();
    await createPaymentForInvoice(userA, String(invoice!.id), 40, {
      paymentDate: daysAgo(1).toISOString(),
    });

    const data = await getReportData(userA.id, { preset: "last_30_days" });
    expect(data.summary.orderRevenue).toBe(100);
    expect(data.summary.paymentsCollected).toBe(40);
    expect(data.receivables.periodPaymentsCollected).toBe(40);
    expect(data.receivables.outstanding).toBe(60);
    expect(data.paymentTrend.some((point) => point.value === 40)).toBe(true);
  });

  it("aggregates invoice status and receivables for the owner only", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 30 });
    const order = await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 60,
      subtotal: 60,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });
    const { data: invoice } = await createInvoiceFromOrder(userA, order.id);
    await createPaymentForInvoice(userA, String(invoice!.id), 20);

    const foreignCustomer = await seedCustomer(userB.id);
    const foreignProduct = await seedProduct(userB.id);
    const foreignOrder = await seedOrder(userB.id, foreignCustomer._id, foreignProduct._id, {
      status: "completed",
      total: 500,
      subtotal: 500,
    });
    await createInvoiceFromOrder(userB, foreignOrder.id);

    const data = await getReportData(userA.id, { preset: "last_30_days" });
    const issuedLike = data.invoiceStatusBreakdown.filter((row) => row.count > 0);
    expect(issuedLike.some((row) => row.status === "partially_paid" || row.status === "issued")).toBe(true);
    expect(data.receivables.totalInvoiced).toBe(60);
    expect(data.receivables.totalPaid).toBe(20);
    expect(data.receivables.outstanding).toBe(40);
  });

  it("aggregates top products and top customers for the selected period", async () => {
    const alice = await seedCustomer(userA.id, { firstName: "Alice" });
    const bob = await seedCustomer(userA.id, { firstName: "Bob", lastName: "Builder" });
    const notebook = await seedProduct(userA.id, { name: "Notebook", sku: "NOTE-R1", price: 10 });
    const lamp = await seedProduct(userA.id, { name: "Lamp", sku: "LAMP-R1", price: 40 });

    await seedOrder(userA.id, alice._id, notebook._id, {
      status: "completed",
      total: 20,
      subtotal: 20,
      items: [{ productId: notebook._id, quantity: 2, unitPrice: 10, lineTotal: 20 }],
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    });
    await seedOrder(userA.id, bob._id, lamp._id, {
      status: "completed",
      total: 80,
      subtotal: 80,
      items: [{ productId: lamp._id, quantity: 2, unitPrice: 40, lineTotal: 80 }],
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    });

    const data = await getReportData(userA.id, { preset: "last_30_days" });
    expect(data.topProducts[0]).toMatchObject({ name: "Lamp", revenue: 80, quantitySold: 2 });
    expect(data.topProducts[1]).toMatchObject({ name: "Notebook", revenue: 20, quantitySold: 2 });
    expect(data.topCustomers[0]).toMatchObject({ name: "Bob Builder", revenue: 80, orders: 1 });
    expect(data.topCustomers[1]).toMatchObject({ name: "Alice Lovelace", revenue: 20, orders: 1 });
  });

  it("returns empty-friendly zeros and neutral previous-period comparison", async () => {
    const data = await getReportData(userA.id, { preset: "last_30_days" });
    expect(data.summary.orderRevenue).toBe(0);
    expect(data.summary.paymentsCollected).toBe(0);
    expect(data.topProducts).toEqual([]);
    expect(data.topCustomers).toEqual([]);
    expect(data.comparison.hasPreviousActivity).toBe(false);
    expect(data.comparison.orderRevenueChangePct).toBeNull();
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(20, 10)).toBe(100);
  });

  it("computes previous-period comparison when history exists", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 10 });

    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 100,
      subtotal: 100,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
    });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 50,
      subtotal: 50,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
    });

    const data = await getReportData(userA.id, { preset: "last_30_days" });
    expect(data.summary.orderRevenue).toBe(100);
    expect(data.comparison.hasPreviousActivity).toBe(true);
    expect(data.comparison.previousOrderRevenue).toBe(50);
    expect(data.comparison.orderRevenueChangePct).toBe(100);
  });

  it("excludes voided payments from collection totals", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 25 });
    const order = await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 50,
      subtotal: 50,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    });
    const { data: invoice } = await createInvoiceFromOrder(userA, order.id);
    await createPaymentForInvoice(userA, String(invoice!.id), 15);

    const payment = await getPaymentsCollection().findOne({ ownerId: userA.id });
    expect(payment).toBeTruthy();
    await getPaymentsCollection().updateOne(
      { _id: payment!._id },
      { $set: { voidedAt: new Date(), updatedAt: new Date() } },
    );
    await getInvoicesCollection().updateOne(
      { _id: payment!.invoiceId },
      { $set: { paidAmount: 0, outstandingAmount: 50, status: "issued", updatedAt: new Date() } },
    );

    const data = await getReportData(userA.id, { preset: "last_30_days" });
    expect(data.summary.paymentsCollected).toBe(0);
  });
});

describe("reports API validation", () => {
  it("returns 400 for invalid date parameters", async () => {
    mockSession(userA);
    const response = await getReports(
      jsonRequest("GET", "http://localhost/api/reports?preset=custom&start=bad&end=2026-01-02"),
    );
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(String(body?.error)).toContain("YYYY-MM-DD");
  });
});

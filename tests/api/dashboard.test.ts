import { describe, expect, it } from "vitest";
import { GET as getDashboard } from "@/server/api/dashboard";
import { getDashboardData, resolveTrendDays } from "@/server/dashboard/get-dashboard-data";
import { DASHBOARD_RECENT_ORDERS_LIMIT, DASHBOARD_TREND_DAYS } from "@/server/dashboard/constants";
import { getOrdersCollection } from "@/server/db/models/order";
import { mockSession, userA, userB } from "../helpers/auth";
import { seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, readJson } from "../helpers/http";

describe("dashboard authorization", () => {
  it("rejects unauthenticated dashboard requests", async () => {
    mockSession(null);
    const response = await getDashboard(jsonRequest("GET", "http://localhost/api/dashboard"));
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: "Authentication required" });
  });

  it("ignores client-supplied ownerId and returns only the session owner's data", async () => {
    const customerA = await seedCustomer(userA.id, { firstName: "Alice" });
    const productA = await seedProduct(userA.id, { price: 20 });
    await seedOrder(userA.id, customerA._id, productA._id, { total: 40, subtotal: 40, status: "completed" });

    const customerB = await seedCustomer(userB.id, { firstName: "Bob" });
    const productB = await seedProduct(userB.id, { price: 100 });
    await seedOrder(userB.id, customerB._id, productB._id, { total: 500, subtotal: 500, status: "completed" });

    mockSession(userA);
    const response = await getDashboard(
      jsonRequest("GET", "http://localhost/api/dashboard?ownerId=user-b&userId=user-b"),
    );
    const body = await readJson(response);
    const data = body?.data as {
      summary: { totalCustomers: number; totalOrders: number; totalRevenue: number };
      recentOrders: Array<{ customerName: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.summary.totalCustomers).toBe(1);
    expect(data.summary.totalOrders).toBe(1);
    expect(data.summary.totalRevenue).toBe(40);
    expect(data.recentOrders.map((order) => order.customerName)).toEqual(["Alice Lovelace"]);
  });
});

describe("dashboard summary metrics", () => {
  it("returns zeroed metrics for an empty workspace", async () => {
    const data = await getDashboardData(userA.id);

    expect(data.summary).toMatchObject({
      totalCustomers: 0,
      totalProducts: 0,
      totalOrders: 0,
      totalRevenue: 0,
      pendingOrders: 0,
      confirmedOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      lowStockProducts: 0,
    });
    expect(data.recentOrders).toEqual([]);
    expect(data.recentCustomers).toEqual([]);
    expect(data.lowStockProducts).toEqual([]);
    expect(data.topProducts).toEqual([]);
    expect(data.revenueTrend).toHaveLength(DASHBOARD_TREND_DAYS);
    expect(data.revenueTrend.every((point) => point.revenue === 0 && point.orderCount === 0)).toBe(true);
  });

  it("counts status totals and excludes cancelled orders from revenue", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 25, stock: 3 });

    await seedOrder(userA.id, customer._id, product._id, { status: "pending", total: 10, subtotal: 10 });
    await seedOrder(userA.id, customer._id, product._id, { status: "confirmed", total: 20, subtotal: 20 });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 35,
      subtotal: 40,
      discount: 5,
    });
    await seedOrder(userA.id, customer._id, product._id, { status: "cancelled", total: 999, subtotal: 999 });

    const data = await getDashboardData(userA.id);

    expect(data.summary.totalCustomers).toBe(1);
    expect(data.summary.totalProducts).toBe(1);
    expect(data.summary.totalOrders).toBe(4);
    expect(data.summary.pendingOrders).toBe(1);
    expect(data.summary.confirmedOrders).toBe(1);
    expect(data.summary.completedOrders).toBe(1);
    expect(data.summary.cancelledOrders).toBe(1);
    expect(data.summary.totalRevenue).toBe(65);
    expect(data.summary.lowStockProducts).toBe(1);
    expect(data.statusDistribution).toEqual([
      { status: "pending", count: 1 },
      { status: "confirmed", count: 1 },
      { status: "completed", count: 1 },
      { status: "cancelled", count: 1 },
    ]);
  });
});

describe("dashboard recent orders and insights", () => {
  it("returns newest owner-scoped orders first and respects the limit", async () => {
    const customer = await seedCustomer(userA.id, { firstName: "Maya" });
    const product = await seedProduct(userA.id, { price: 12 });

    for (let index = 0; index < DASHBOARD_RECENT_ORDERS_LIMIT + 3; index += 1) {
      await seedOrder(userA.id, customer._id, product._id, {
        status: "pending",
        createdAt: new Date(Date.UTC(2026, 2, 1 + index, 12)),
        updatedAt: new Date(Date.UTC(2026, 2, 1 + index, 12)),
        total: 12,
        subtotal: 12,
      });
    }

    const foreignCustomer = await seedCustomer(userB.id);
    const foreignProduct = await seedProduct(userB.id);
    await seedOrder(userB.id, foreignCustomer._id, foreignProduct._id, {
      createdAt: new Date(Date.UTC(2026, 3, 1, 12)),
      updatedAt: new Date(Date.UTC(2026, 3, 1, 12)),
    });

    const data = await getDashboardData(userA.id);
    expect(data.recentOrders).toHaveLength(DASHBOARD_RECENT_ORDERS_LIMIT);
    expect(data.recentOrders.every((order) => order.customerName === "Maya Lovelace")).toBe(true);

    const newestFirst = data.recentOrders.every((order, index, list) => {
      if (index === 0) return true;
      return new Date(order.createdAt).getTime() <= new Date(list[index - 1].createdAt).getTime();
    });
    expect(newestFirst).toBe(true);
  });

  it("aggregates top products and low-stock items for the owner only", async () => {
    const customer = await seedCustomer(userA.id);
    const notebook = await seedProduct(userA.id, { name: "Notebook", sku: "NOTE-1", price: 10, stock: 2 });
    const lamp = await seedProduct(userA.id, { name: "Lamp", sku: "LAMP-1", price: 40, stock: 50 });
    await seedProduct(userB.id, { name: "Foreign", sku: "FOR-1", price: 5, stock: 1 });

    await getOrdersCollection().insertOne({
      ownerId: userA.id,
      customerId: customer._id,
      items: [
        { productId: notebook._id, quantity: 2, unitPrice: 10, lineTotal: 20 },
        { productId: lamp._id, quantity: 1, unitPrice: 40, lineTotal: 40 },
      ],
      subtotal: 60,
      discount: 0,
      total: 60,
      status: "completed",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const data = await getDashboardData(userA.id);
    expect(data.lowStockProducts.map((product) => product.sku)).toEqual(["NOTE-1"]);
    expect(data.topProducts[0]).toMatchObject({ sku: "LAMP-1", revenue: 40, quantitySold: 1 });
    expect(data.topProducts[1]).toMatchObject({ sku: "NOTE-1", revenue: 20, quantitySold: 2 });
  });
});

describe("dashboard revenue trend", () => {
  it("aggregates daily revenue in range and validates days parameter", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 15 });
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 15));

    await seedOrder(userA.id, customer._id, product._id, {
      status: "completed",
      total: 30,
      subtotal: 30,
      createdAt: todayUtc,
      updatedAt: todayUtc,
    });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "cancelled",
      total: 100,
      subtotal: 100,
      createdAt: todayUtc,
      updatedAt: todayUtc,
    });

    const data = await getDashboardData(userA.id, { days: 7 });
    expect(data.revenueTrend).toHaveLength(7);
    const todayPoint = data.revenueTrend[data.revenueTrend.length - 1];
    expect(todayPoint.revenue).toBe(30);
    expect(todayPoint.orderCount).toBe(1);

    expect(resolveTrendDays(null)).toBe(DASHBOARD_TREND_DAYS);
    expect(() => resolveTrendDays(3)).toThrow("days must be between");
    expect(() => resolveTrendDays("abc")).toThrow("days must be a whole number");

    mockSession(userA);
    const invalid = await getDashboard(jsonRequest("GET", "http://localhost/api/dashboard?days=999"));
    expect(invalid.status).toBe(400);
  });

  it("keeps discounted order totals consistent with stored order totals", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 50 });
    await seedOrder(userA.id, customer._id, product._id, {
      status: "confirmed",
      subtotal: 50,
      discount: 12.5,
      total: 37.5,
      items: [{ productId: product._id, quantity: 1, unitPrice: 50, lineTotal: 50 }],
    });

    const data = await getDashboardData(userA.id);
    expect(data.summary.totalRevenue).toBe(37.5);
    expect(data.recentOrders[0]?.total).toBe(37.5);
  });
});

describe("dashboard data isolation helpers", () => {
  it("never returns another owner's recent customers or products", async () => {
    await seedCustomer(userB.id, { firstName: "Hidden" });
    await seedProduct(userB.id, { name: "Hidden Product", stock: 1 });

    const data = await getDashboardData(userA.id);
    expect(data.recentCustomers).toEqual([]);
    expect(data.lowStockProducts).toEqual([]);
    expect(data.summary.totalCustomers).toBe(0);
    expect(data.summary.totalProducts).toBe(0);
  });
});

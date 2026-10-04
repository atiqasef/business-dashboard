import { ObjectId } from "mongodb";
import { ensureCustomerIndexes, getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection } from "@/server/db/models/invoice";
import { ensureOrderIndexes, getOrdersCollection, orderStatuses, type OrderStatus } from "@/server/db/models/order";
import { ensureProductIndexes, getProductsCollection } from "@/server/db/models/product";
import {
  DASHBOARD_LOW_STOCK_LIMIT,
  DASHBOARD_LOW_STOCK_THRESHOLD,
  DASHBOARD_RECENT_CUSTOMERS_LIMIT,
  DASHBOARD_RECENT_ORDERS_LIMIT,
  DASHBOARD_TOP_PRODUCTS_LIMIT,
  DASHBOARD_TREND_DAYS,
  DASHBOARD_TREND_DAYS_MAX,
  DASHBOARD_TREND_DAYS_MIN,
  REVENUE_ORDER_STATUSES,
} from "@/server/dashboard/constants";
import type { DashboardData, DashboardStatusCount, DashboardTrendPoint } from "@/server/dashboard/types";

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatUtcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeMoney(value: number) {
  return Number(Number(value).toFixed(2));
}

export function resolveTrendDays(rawDays?: number | string | null) {
  if (rawDays === undefined || rawDays === null || rawDays === "") return DASHBOARD_TREND_DAYS;
  const parsed = typeof rawDays === "number" ? rawDays : Number.parseInt(String(rawDays), 10);
  if (!Number.isInteger(parsed)) throw new Error("days must be a whole number");
  if (parsed < DASHBOARD_TREND_DAYS_MIN || parsed > DASHBOARD_TREND_DAYS_MAX) {
    throw new Error(`days must be between ${DASHBOARD_TREND_DAYS_MIN} and ${DASHBOARD_TREND_DAYS_MAX}`);
  }
  return parsed;
}

function emptyStatusCounts(): Record<OrderStatus, number> {
  return {
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  };
}

function buildTrendSeries(days: number, end: Date, points: Array<{ date: string; revenue: number; orderCount: number }>) {
  const byDate = new Map(points.map((point) => [point.date, point]));
  const series: DashboardTrendPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - offset);
    const key = formatUtcDay(day);
    const match = byDate.get(key);
    series.push({
      date: key,
      revenue: match ? normalizeMoney(match.revenue) : 0,
      orderCount: match?.orderCount ?? 0,
    });
  }

  return series;
}

export async function getDashboardData(ownerId: string, options?: { days?: number | string | null }): Promise<DashboardData> {
  if (!ownerId || typeof ownerId !== "string") {
    throw new Error("ownerId is required");
  }

  const days = resolveTrendDays(options?.days);
  const rangeEnd = startOfUtcDay(new Date());
  const rangeStart = new Date(rangeEnd);
  rangeStart.setUTCDate(rangeEnd.getUTCDate() - (days - 1));

  await Promise.all([ensureCustomerIndexes(), ensureProductIndexes(), ensureOrderIndexes(), ensureInvoiceIndexes()]);

  const customers = getCustomersCollection();
  const products = getProductsCollection();
  const orders = getOrdersCollection();
  const invoices = getInvoicesCollection();
  const ownerFilter = { ownerId };
  const now = new Date();

  await invoices.updateMany(
    {
      ownerId,
      status: { $in: ["issued", "partially_paid"] },
      dueDate: { $lt: now },
      outstandingAmount: { $gt: 0 },
    },
    { $set: { status: "overdue", updatedAt: now } },
  );

  const [
    totalCustomers,
    totalProducts,
    lowStockProductsCount,
    statusGroups,
    revenueGroups,
    invoiceFinance,
    unpaidInvoiceCount,
    overdueInvoiceCount,
    recentOrderDocs,
    recentCustomerDocs,
    lowStockDocs,
    trendGroups,
    topProductGroups,
  ] = await Promise.all([
    customers.countDocuments(ownerFilter),
    products.countDocuments(ownerFilter),
    products.countDocuments({ ownerId, stock: { $lte: DASHBOARD_LOW_STOCK_THRESHOLD } }),
    orders
      .aggregate<{ _id: OrderStatus; count: number }>([
        { $match: ownerFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: null; totalRevenue: number; totalOrders: number }>([
        { $match: { ownerId, status: { $in: REVENUE_ORDER_STATUSES } } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$total" },
            totalOrders: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    invoices
      .aggregate<{ _id: null; outstandingReceivables: number; collectedPayments: number }>([
        { $match: { ownerId, status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: null,
            outstandingReceivables: { $sum: "$outstandingAmount" },
            collectedPayments: { $sum: "$paidAmount" },
          },
        },
      ])
      .toArray(),
    invoices.countDocuments({ ownerId, status: { $ne: "cancelled" }, outstandingAmount: { $gt: 0 } }),
    invoices.countDocuments({ ownerId, status: "overdue" }),
    orders
      .aggregate<Record<string, unknown>>([
        { $match: ownerFilter },
        { $sort: { createdAt: -1, _id: -1 } },
        { $limit: DASHBOARD_RECENT_ORDERS_LIMIT },
        {
          $lookup: {
            from: "customers",
            let: { customerId: "$customerId", owner: "$ownerId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ["$_id", "$$customerId"] }, { $eq: ["$ownerId", "$$owner"] }],
                  },
                },
              },
              { $project: { firstName: 1, lastName: 1 } },
            ],
            as: "customer",
          },
        },
        { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            status: 1,
            total: 1,
            createdAt: 1,
            itemCount: { $size: "$items" },
            customerFirstName: "$customer.firstName",
            customerLastName: "$customer.lastName",
          },
        },
      ])
      .toArray(),
    customers
      .find(ownerFilter, { projection: { firstName: 1, lastName: 1, email: 1, company: 1, createdAt: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(DASHBOARD_RECENT_CUSTOMERS_LIMIT)
      .toArray(),
    products
      .find(
        { ownerId, stock: { $lte: DASHBOARD_LOW_STOCK_THRESHOLD } },
        { projection: { name: 1, sku: 1, stock: 1 } },
      )
      .sort({ stock: 1, updatedAt: -1 })
      .limit(DASHBOARD_LOW_STOCK_LIMIT)
      .toArray(),
    orders
      .aggregate<{ _id: string; revenue: number; orderCount: number }>([
        {
          $match: {
            ownerId,
            status: { $in: REVENUE_ORDER_STATUSES },
            createdAt: { $gte: rangeStart, $lte: new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000 - 1) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" },
            },
            revenue: { $sum: "$total" },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: ObjectId; quantitySold: number; revenue: number }>([
        { $match: { ownerId, status: { $in: REVENUE_ORDER_STATUSES } } },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            quantitySold: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.lineTotal" },
          },
        },
        { $sort: { revenue: -1, quantitySold: -1 } },
        { $limit: DASHBOARD_TOP_PRODUCTS_LIMIT },
      ])
      .toArray(),
  ]);

  const statusCounts = emptyStatusCounts();
  for (const group of statusGroups) {
    if (orderStatuses.includes(group._id)) statusCounts[group._id] = group.count;
  }

  const totalOrders = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const totalRevenue = normalizeMoney(revenueGroups[0]?.totalRevenue ?? 0);

  const productIds = topProductGroups.map((group) => group._id);
  const topProductDocs = productIds.length
    ? await products
        .find({ _id: { $in: productIds }, ownerId }, { projection: { name: 1, sku: 1 } })
        .toArray()
    : [];
  const productsById = new Map(topProductDocs.map((product) => [product._id?.toHexString() ?? "", product]));

  const statusDistribution: DashboardStatusCount[] = orderStatuses.map((status) => ({
    status,
    count: statusCounts[status],
  }));

  return {
    summary: {
      totalCustomers,
      totalProducts,
      totalOrders,
      totalRevenue,
      pendingOrders: statusCounts.pending,
      confirmedOrders: statusCounts.confirmed,
      completedOrders: statusCounts.completed,
      cancelledOrders: statusCounts.cancelled,
      lowStockProducts: lowStockProductsCount,
      outstandingReceivables: normalizeMoney(invoiceFinance[0]?.outstandingReceivables ?? 0),
      collectedPayments: normalizeMoney(invoiceFinance[0]?.collectedPayments ?? 0),
      unpaidInvoiceCount,
      overdueInvoiceCount,
    },
    recentOrders: recentOrderDocs.map((order) => {
      const firstName = typeof order.customerFirstName === "string" ? order.customerFirstName : "";
      const lastName = typeof order.customerLastName === "string" ? order.customerLastName : "";
      const customerName = `${firstName} ${lastName}`.trim() || "Unknown customer";
      return {
        id: (order._id as ObjectId).toHexString(),
        customerName,
        createdAt: (order.createdAt as Date).toISOString(),
        itemCount: Number(order.itemCount ?? 0),
        total: normalizeMoney(Number(order.total ?? 0)),
        status: order.status as OrderStatus,
      };
    }),
    recentCustomers: recentCustomerDocs.map((customer) => ({
      id: customer._id!.toHexString(),
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email ?? null,
      company: customer.company ?? null,
      createdAt: customer.createdAt.toISOString(),
    })),
    lowStockProducts: lowStockDocs.map((product) => ({
      id: product._id!.toHexString(),
      name: product.name,
      sku: product.sku,
      stock: product.stock,
    })),
    topProducts: topProductGroups.map((group) => {
      const id = group._id.toHexString();
      const product = productsById.get(id);
      return {
        id,
        name: product?.name ?? "Unknown product",
        sku: product?.sku ?? "—",
        quantitySold: group.quantitySold,
        revenue: normalizeMoney(group.revenue),
      };
    }),
    statusDistribution,
    revenueTrend: buildTrendSeries(
      days,
      rangeEnd,
      trendGroups.map((group) => ({
        date: group._id,
        revenue: group.revenue,
        orderCount: group.orderCount,
      })),
    ),
    range: {
      days,
      start: rangeStart.toISOString(),
      end: new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
    },
  };
}

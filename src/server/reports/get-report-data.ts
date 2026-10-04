import { ObjectId } from "mongodb";
import { DASHBOARD_LOW_STOCK_THRESHOLD, REVENUE_ORDER_STATUSES } from "@/server/dashboard/constants";
import { ensureCustomerIndexes, getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection, invoiceStatuses, type InvoiceStatus } from "@/server/db/models/invoice";
import { ensureOrderIndexes, getOrdersCollection, orderStatuses, type OrderStatus } from "@/server/db/models/order";
import { ensurePaymentIndexes, getPaymentsCollection } from "@/server/db/models/payment";
import { ensureProductIndexes, getProductsCollection } from "@/server/db/models/product";
import {
  REPORT_LOW_STOCK_LIMIT,
  REPORT_OUT_OF_STOCK_LIMIT,
  REPORT_TOP_CUSTOMERS_LIMIT,
  REPORT_TOP_PRODUCTS_LIMIT,
} from "@/server/reports/constants";
import {
  buildBucketSeries,
  percentChange,
  resolveReportRange,
  type ReportGranularity,
} from "@/server/reports/date-range";
import type { ReportData } from "@/server/reports/types";

function normalizeMoney(value: number) {
  return Number(Number(value).toFixed(2));
}

function emptyOrderStatusCounts(): Record<OrderStatus, number> {
  return {
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  };
}

function bucketExpression(dateField: string, granularity: ReportGranularity) {
  if (granularity === "month") {
    return {
      $dateToString: { format: "%Y-%m", date: `$${dateField}`, timezone: "UTC" },
    };
  }
  if (granularity === "week") {
    return {
      $dateToString: {
        format: "%Y-%m-%d",
        date: {
          $dateTrunc: {
            date: `$${dateField}`,
            unit: "week",
            binSize: 1,
            timezone: "UTC",
            startOfWeek: "monday",
          },
        },
        timezone: "UTC",
      },
    };
  }
  return {
    $dateToString: { format: "%Y-%m-%d", date: `$${dateField}`, timezone: "UTC" },
  };
}

function activePaymentMatch(ownerId: string, start: Date, end: Date) {
  return {
    ownerId,
    paymentDate: { $gte: start, $lte: end },
    voidedAt: { $exists: false },
  };
}

export async function getReportData(
  ownerId: string,
  options?: { preset?: string | null; start?: string | null; end?: string | null },
): Promise<ReportData> {
  if (!ownerId || typeof ownerId !== "string") {
    throw new Error("ownerId is required");
  }

  const range = resolveReportRange({
    preset: options?.preset,
    start: options?.start,
    end: options?.end,
  });

  await Promise.all([
    ensureCustomerIndexes(),
    ensureProductIndexes(),
    ensureOrderIndexes(),
    ensureInvoiceIndexes(),
    ensurePaymentIndexes(),
  ]);

  const customers = getCustomersCollection();
  const products = getProductsCollection();
  const orders = getOrdersCollection();
  const invoices = getInvoicesCollection();
  const payments = getPaymentsCollection();
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

  const periodOrderMatch = { ownerId, createdAt: { $gte: range.start, $lte: range.end } };
  const previousOrderMatch = { ownerId, createdAt: { $gte: range.previousStart, $lte: range.previousEnd } };
  const revenuePeriodMatch = {
    ownerId,
    status: { $in: REVENUE_ORDER_STATUSES },
    createdAt: { $gte: range.start, $lte: range.end },
  };
  const revenuePreviousMatch = {
    ownerId,
    status: { $in: REVENUE_ORDER_STATUSES },
    createdAt: { $gte: range.previousStart, $lte: range.previousEnd },
  };
  const dateBucket = bucketExpression("createdAt", range.granularity);
  const paymentBucket = bucketExpression("paymentDate", range.granularity);

  const [
    periodStatusGroups,
    periodRevenueGroups,
    previousRevenueGroups,
    previousOrderCount,
    periodPaymentGroups,
    previousPaymentGroups,
    revenueTrendGroups,
    orderTrendGroups,
    paymentTrendGroups,
    invoiceStatusGroups,
    receivablesGroups,
    overdueGroups,
    periodInvoicedGroups,
    topProductGroups,
    topCustomerGroups,
    customersInPeriod,
    totalCustomers,
    lowStockCount,
    outOfStockCount,
    lowStockDocs,
    outOfStockDocs,
  ] = await Promise.all([
    orders
      .aggregate<{ _id: OrderStatus; count: number }>([
        { $match: periodOrderMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: null; orderRevenue: number; revenueOrderCount: number }>([
        { $match: revenuePeriodMatch },
        {
          $group: {
            _id: null,
            orderRevenue: { $sum: "$total" },
            revenueOrderCount: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: null; orderRevenue: number }>([
        { $match: revenuePreviousMatch },
        { $group: { _id: null, orderRevenue: { $sum: "$total" } } },
      ])
      .toArray(),
    orders.countDocuments(previousOrderMatch),
    payments
      .aggregate<{ _id: null; total: number }>([
        { $match: activePaymentMatch(ownerId, range.start, range.end) },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    payments
      .aggregate<{ _id: null; total: number }>([
        { $match: activePaymentMatch(ownerId, range.previousStart, range.previousEnd) },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: string; value: number }>([
        { $match: revenuePeriodMatch },
        { $group: { _id: dateBucket, value: { $sum: "$total" } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: string; orderCount: number; revenueOrders: number }>([
        { $match: periodOrderMatch },
        {
          $group: {
            _id: dateBucket,
            orderCount: { $sum: 1 },
            revenueOrders: {
              $sum: {
                $cond: [{ $in: ["$status", REVENUE_ORDER_STATUSES] }, 1, 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    payments
      .aggregate<{ _id: string; value: number }>([
        { $match: activePaymentMatch(ownerId, range.start, range.end) },
        { $group: { _id: paymentBucket, value: { $sum: "$amount" } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    invoices
      .aggregate<{ _id: InvoiceStatus; count: number; total: number; outstanding: number }>([
        { $match: { ownerId } },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            total: { $sum: "$total" },
            outstanding: { $sum: "$outstandingAmount" },
          },
        },
      ])
      .toArray(),
    invoices
      .aggregate<{ _id: null; totalInvoiced: number; totalPaid: number; outstanding: number }>([
        { $match: { ownerId, status: { $ne: "cancelled" } } },
        {
          $group: {
            _id: null,
            totalInvoiced: { $sum: "$total" },
            totalPaid: { $sum: "$paidAmount" },
            outstanding: { $sum: "$outstandingAmount" },
          },
        },
      ])
      .toArray(),
    invoices
      .aggregate<{ _id: null; overdue: number; count: number }>([
        { $match: { ownerId, status: "overdue" } },
        {
          $group: {
            _id: null,
            overdue: { $sum: "$outstandingAmount" },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    invoices
      .aggregate<{ _id: null; periodInvoiced: number }>([
        {
          $match: {
            ownerId,
            status: { $ne: "cancelled" },
            issueDate: { $gte: range.start, $lte: range.end },
          },
        },
        { $group: { _id: null, periodInvoiced: { $sum: "$total" } } },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: ObjectId; quantitySold: number; revenue: number }>([
        { $match: revenuePeriodMatch },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.productId",
            quantitySold: { $sum: "$items.quantity" },
            revenue: { $sum: "$items.lineTotal" },
          },
        },
        { $sort: { revenue: -1, quantitySold: -1 } },
        { $limit: REPORT_TOP_PRODUCTS_LIMIT },
      ])
      .toArray(),
    orders
      .aggregate<{ _id: ObjectId; orders: number; revenue: number }>([
        { $match: revenuePeriodMatch },
        {
          $group: {
            _id: "$customerId",
            orders: { $sum: 1 },
            revenue: { $sum: "$total" },
          },
        },
        { $sort: { revenue: -1, orders: -1 } },
        { $limit: REPORT_TOP_CUSTOMERS_LIMIT },
      ])
      .toArray(),
    customers.countDocuments({ ownerId, createdAt: { $gte: range.start, $lte: range.end } }),
    customers.countDocuments({ ownerId }),
    products.countDocuments({
      ownerId,
      stock: { $gt: 0, $lte: DASHBOARD_LOW_STOCK_THRESHOLD },
    }),
    products.countDocuments({ ownerId, stock: { $lte: 0 } }),
    products
      .find(
        { ownerId, stock: { $gt: 0, $lte: DASHBOARD_LOW_STOCK_THRESHOLD } },
        { projection: { name: 1, sku: 1, stock: 1 } },
      )
      .sort({ stock: 1, updatedAt: -1 })
      .limit(REPORT_LOW_STOCK_LIMIT)
      .toArray(),
    products
      .find({ ownerId, stock: { $lte: 0 } }, { projection: { name: 1, sku: 1, stock: 1 } })
      .sort({ updatedAt: -1 })
      .limit(REPORT_OUT_OF_STOCK_LIMIT)
      .toArray(),
  ]);

  const statusCounts = emptyOrderStatusCounts();
  for (const group of periodStatusGroups) {
    if (orderStatuses.includes(group._id)) statusCounts[group._id] = group.count;
  }

  const totalOrders = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const orderRevenue = normalizeMoney(periodRevenueGroups[0]?.orderRevenue ?? 0);
  const revenueOrderCount = periodRevenueGroups[0]?.revenueOrderCount ?? 0;
  const averageOrderValue = revenueOrderCount > 0 ? normalizeMoney(orderRevenue / revenueOrderCount) : 0;
  const paymentsCollected = normalizeMoney(periodPaymentGroups[0]?.total ?? 0);
  const previousOrderRevenue = normalizeMoney(previousRevenueGroups[0]?.orderRevenue ?? 0);
  const previousPaymentsCollected = normalizeMoney(previousPaymentGroups[0]?.total ?? 0);
  const previousOrders = previousOrderCount;
  const hasPreviousActivity =
    previousOrderRevenue > 0 || previousOrders > 0 || previousPaymentsCollected > 0;

  const productIds = topProductGroups.map((group) => group._id);
  const customerIds = topCustomerGroups.map((group) => group._id);

  const [topProductDocs, topCustomerDocs] = await Promise.all([
    productIds.length
      ? products.find({ _id: { $in: productIds }, ownerId }, { projection: { name: 1, sku: 1 } }).toArray()
      : Promise.resolve([]),
    customerIds.length
      ? customers
          .find({ _id: { $in: customerIds }, ownerId }, { projection: { firstName: 1, lastName: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);

  const productsById = new Map(topProductDocs.map((product) => [product._id?.toHexString() ?? "", product]));
  const customersById = new Map(topCustomerDocs.map((customer) => [customer._id?.toHexString() ?? "", customer]));

  const invoiceByStatus = new Map(invoiceStatusGroups.map((group) => [group._id, group]));
  const invoiceStatusBreakdown = invoiceStatuses.map((status) => {
    const match = invoiceByStatus.get(status);
    return {
      status,
      count: match?.count ?? 0,
      total: normalizeMoney(match?.total ?? 0),
      outstanding: normalizeMoney(match?.outstanding ?? 0),
    };
  });

  const revenueSeries = buildBucketSeries(
    range.start,
    range.end,
    range.granularity,
    revenueTrendGroups.map((group) => ({ key: group._id, value: group.value })),
  );
  const orderSeries = buildBucketSeries(
    range.start,
    range.end,
    range.granularity,
    orderTrendGroups.map((group) => ({
      key: group._id,
      value: group.orderCount,
      secondary: group.revenueOrders,
    })),
  );
  const paymentSeries = buildBucketSeries(
    range.start,
    range.end,
    range.granularity,
    paymentTrendGroups.map((group) => ({ key: group._id, value: group.value })),
  );

  return {
    range: {
      preset: range.preset,
      label: range.label,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      previousStart: range.previousStart.toISOString(),
      previousEnd: range.previousEnd.toISOString(),
      granularity: range.granularity,
    },
    summary: {
      orderRevenue,
      totalOrders,
      pendingOrders: statusCounts.pending,
      confirmedOrders: statusCounts.confirmed,
      completedOrders: statusCounts.completed,
      cancelledOrders: statusCounts.cancelled,
      revenueOrderCount,
      averageOrderValue,
      paymentsCollected,
      outstandingReceivables: normalizeMoney(receivablesGroups[0]?.outstanding ?? 0),
      overdueReceivables: normalizeMoney(overdueGroups[0]?.overdue ?? 0),
      overdueInvoiceCount: overdueGroups[0]?.count ?? 0,
      customersInPeriod,
      totalCustomers,
    },
    comparison: {
      orderRevenueChangePct: hasPreviousActivity ? percentChange(orderRevenue, previousOrderRevenue) : null,
      ordersChangePct: hasPreviousActivity ? percentChange(totalOrders, previousOrders) : null,
      paymentsCollectedChangePct: hasPreviousActivity
        ? percentChange(paymentsCollected, previousPaymentsCollected)
        : null,
      previousOrderRevenue,
      previousOrders,
      previousPaymentsCollected,
      hasPreviousActivity,
    },
    revenueTrend: revenueSeries.map((point) => ({
      key: point.key,
      label: point.label,
      value: point.value,
    })),
    orderTrend: orderSeries.map((point) => ({
      key: point.key,
      label: point.label,
      orderCount: point.value,
      revenueOrders: point.secondary,
    })),
    paymentTrend: paymentSeries.map((point) => ({
      key: point.key,
      label: point.label,
      value: point.value,
    })),
    orderStatusBreakdown: orderStatuses.map((status) => ({
      status,
      count: statusCounts[status],
    })),
    invoiceStatusBreakdown,
    receivables: {
      totalInvoiced: normalizeMoney(receivablesGroups[0]?.totalInvoiced ?? 0),
      totalPaid: normalizeMoney(receivablesGroups[0]?.totalPaid ?? 0),
      outstanding: normalizeMoney(receivablesGroups[0]?.outstanding ?? 0),
      overdue: normalizeMoney(overdueGroups[0]?.overdue ?? 0),
      periodInvoiced: normalizeMoney(periodInvoicedGroups[0]?.periodInvoiced ?? 0),
      periodPaymentsCollected: paymentsCollected,
    },
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
    topCustomers: topCustomerGroups.map((group) => {
      const id = group._id.toHexString();
      const customer = customersById.get(id);
      const name = customer ? `${customer.firstName} ${customer.lastName}`.trim() : "Unknown customer";
      return {
        id,
        name: name || "Unknown customer",
        orders: group.orders,
        revenue: normalizeMoney(group.revenue),
      };
    }),
    inventory: {
      lowStockCount,
      outOfStockCount,
      lowStockProducts: lowStockDocs.map((product) => ({
        id: product._id!.toHexString(),
        name: product.name,
        sku: product.sku,
        stock: product.stock,
      })),
      outOfStockProducts: outOfStockDocs.map((product) => ({
        id: product._id!.toHexString(),
        name: product.name,
        sku: product.sku,
        stock: product.stock,
      })),
    },
  };
}

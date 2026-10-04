import { getDashboardData } from "@/server/dashboard/get-dashboard-data";
import { ensureInvoiceIndexes, getInvoicesCollection } from "@/server/db/models/invoice";
import { ensurePaymentIndexes, getPaymentsCollection } from "@/server/db/models/payment";
import { getReportData } from "@/server/reports/get-report-data";
import type { ReportPreset } from "@/server/reports/date-range";
import { reportPresets } from "@/server/reports/date-range";

const TOP_N = 8;
const FOLLOW_UP_LIMIT = 8;

export type AssistantBusinessContext = {
  period: {
    label: string;
    start: string;
    end: string;
    previousLabel: string;
    previousStart: string;
    previousEnd: string;
  };
  summary: {
    orderRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    pendingOrders: number;
    cancelledOrders: number;
    paymentsCollected: number;
    outstandingReceivables: number;
    overdueReceivables: number;
    overdueInvoiceCount: number;
    totalCustomers: number;
    customersInPeriod: number;
    lowStockCount: number;
    outOfStockCount: number;
  };
  comparison: {
    orderRevenueChangePct: number | null;
    ordersChangePct: number | null;
    paymentsCollectedChangePct: number | null;
    previousOrderRevenue: number;
    previousOrders: number;
    previousPaymentsCollected: number;
  };
  orderStatusBreakdown: Array<{ status: string; count: number }>;
  invoiceStatusBreakdown: Array<{ status: string; count: number; total: number; outstanding: number }>;
  receivables: {
    totalInvoiced: number;
    totalPaid: number;
    outstanding: number;
    overdue: number;
    periodInvoiced: number;
    periodPaymentsCollected: number;
  };
  topProducts: Array<{ name: string; sku: string; quantitySold: number; revenue: number }>;
  topCustomers: Array<{ name: string; orders: number; revenue: number }>;
  inventory: {
    lowStockProducts: Array<{ name: string; sku: string; stock: number }>;
    outOfStockProducts: Array<{ name: string; sku: string; stock: number }>;
  };
  payments: {
    periodCount: number;
    methodBreakdown: Array<{ method: string; count: number; amount: number }>;
  };
  followUps: {
    overdueInvoices: Array<{
      invoiceNumber: string;
      customerName: string;
      outstanding: number;
      dueDate: string | null;
      status: string;
    }>;
    pendingOrders: number;
  };
  dashboardSnapshot: {
    customerCount: number;
    productCount: number;
    orderCount: number;
    revenue: number;
    pendingOrders: number;
    lowStockCount: number;
  };
};

function normalizeMoney(value: number) {
  return Number(Number(value).toFixed(2));
}

/** Infer a safe report preset from natural language; defaults to last_30_days. */
export function inferReportPreset(question: string): ReportPreset {
  const q = question.toLowerCase();
  if (/\b(last\s*7|past\s*week|this\s*week|7\s*days)\b/.test(q)) return "last_7_days";
  if (/\b(last\s*90|past\s*90|quarter|90\s*days)\b/.test(q)) return "last_90_days";
  if (/\b(previous\s*year|last\s*year)\b/.test(q)) return "previous_year";
  if (/\b(this\s*year|ytd|year\s*to\s*date)\b/.test(q)) return "this_year";
  if (/\b(last\s*30|past\s*30|this\s*month|last\s*month|compare|vs\.?|versus)\b/.test(q)) {
    return "last_30_days";
  }
  if (reportPresets.includes("last_30_days")) return "last_30_days";
  return "last_30_days";
}

function sanitizeText(value: string | undefined | null, max = 80) {
  if (!value) return "Unknown";
  // Collapse control characters; keep printable content as data only.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || "Unknown";
}

/**
 * Builds a compact, owner-scoped analytics DTO for the model.
 * Never includes ownerId, Mongo IDs, tokens, Stripe IDs, or secrets.
 */
export async function buildAssistantBusinessContext(
  ownerId: string,
  question: string,
): Promise<{ context: AssistantBusinessContext; preset: ReportPreset }> {
  if (!ownerId) throw new Error("ownerId is required");

  const preset = inferReportPreset(question);
  await Promise.all([ensureInvoiceIndexes(), ensurePaymentIndexes()]);

  const [report, dashboard] = await Promise.all([
    getReportData(ownerId, { preset }),
    getDashboardData(ownerId, { days: preset === "last_7_days" ? 7 : 30 }),
  ]);

  const now = new Date();

  const [overdueInvoices, paymentGroups, paymentCount] = await Promise.all([
    getInvoicesCollection()
      .find(
        {
          ownerId,
          status: { $nin: ["draft", "cancelled", "paid"] },
          outstandingAmount: { $gt: 0 },
          dueDate: { $exists: true, $type: "date", $lt: now },
        },
        {
          projection: {
            invoiceNumber: 1,
            customerSnapshot: 1,
            outstandingAmount: 1,
            dueDate: 1,
            status: 1,
          },
        },
      )
      .sort({ dueDate: 1, outstandingAmount: -1 })
      .limit(FOLLOW_UP_LIMIT)
      .toArray(),
    getPaymentsCollection()
      .aggregate<{ _id: string; count: number; amount: number }>([
        {
          $match: {
            ownerId,
            paymentDate: { $gte: new Date(report.range.start), $lte: new Date(report.range.end) },
            voidedAt: { $exists: false },
          },
        },
        {
          $group: {
            _id: "$paymentMethod",
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
        { $sort: { amount: -1 } },
        { $limit: 8 },
      ])
      .toArray(),
    getPaymentsCollection().countDocuments({
      ownerId,
      paymentDate: { $gte: new Date(report.range.start), $lte: new Date(report.range.end) },
      voidedAt: { $exists: false },
    }),
  ]);

  const context: AssistantBusinessContext = {
    period: {
      label: report.range.label,
      start: report.range.start.slice(0, 10),
      end: report.range.end.slice(0, 10),
      previousLabel: "Previous comparable period",
      previousStart: report.range.previousStart.slice(0, 10),
      previousEnd: report.range.previousEnd.slice(0, 10),
    },
    summary: {
      orderRevenue: report.summary.orderRevenue,
      totalOrders: report.summary.totalOrders,
      averageOrderValue: report.summary.averageOrderValue,
      pendingOrders: report.summary.pendingOrders,
      cancelledOrders: report.summary.cancelledOrders,
      paymentsCollected: report.summary.paymentsCollected,
      outstandingReceivables: report.summary.outstandingReceivables,
      overdueReceivables: report.summary.overdueReceivables,
      overdueInvoiceCount: report.summary.overdueInvoiceCount,
      totalCustomers: report.summary.totalCustomers,
      customersInPeriod: report.summary.customersInPeriod,
      lowStockCount: report.inventory.lowStockCount,
      outOfStockCount: report.inventory.outOfStockCount,
    },
    comparison: {
      orderRevenueChangePct: report.comparison.orderRevenueChangePct,
      ordersChangePct: report.comparison.ordersChangePct,
      paymentsCollectedChangePct: report.comparison.paymentsCollectedChangePct,
      previousOrderRevenue: report.comparison.previousOrderRevenue,
      previousOrders: report.comparison.previousOrders,
      previousPaymentsCollected: report.comparison.previousPaymentsCollected,
    },
    orderStatusBreakdown: report.orderStatusBreakdown.map((row) => ({
      status: row.status,
      count: row.count,
    })),
    invoiceStatusBreakdown: report.invoiceStatusBreakdown.map((row) => ({
      status: row.status,
      count: row.count,
      total: row.total,
      outstanding: row.outstanding,
    })),
    receivables: { ...report.receivables },
    topProducts: report.topProducts.slice(0, TOP_N).map((product) => ({
      name: sanitizeText(product.name),
      sku: sanitizeText(product.sku, 40),
      quantitySold: product.quantitySold,
      revenue: product.revenue,
    })),
    topCustomers: report.topCustomers.slice(0, TOP_N).map((customer) => ({
      name: sanitizeText(customer.name),
      orders: customer.orders,
      revenue: customer.revenue,
    })),
    inventory: {
      lowStockProducts: report.inventory.lowStockProducts.slice(0, TOP_N).map((product) => ({
        name: sanitizeText(product.name),
        sku: sanitizeText(product.sku, 40),
        stock: product.stock,
      })),
      outOfStockProducts: report.inventory.outOfStockProducts.slice(0, TOP_N).map((product) => ({
        name: sanitizeText(product.name),
        sku: sanitizeText(product.sku, 40),
        stock: product.stock,
      })),
    },
    payments: {
      periodCount: paymentCount,
      methodBreakdown: paymentGroups.map((group) => ({
        method: sanitizeText(group._id || "unknown", 40),
        count: group.count,
        amount: normalizeMoney(group.amount),
      })),
    },
    followUps: {
      overdueInvoices: overdueInvoices.map((invoice) => ({
        invoiceNumber: sanitizeText(invoice.invoiceNumber, 40),
        customerName: sanitizeText(invoice.customerSnapshot?.name),
        outstanding: normalizeMoney(invoice.outstandingAmount),
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
        status: invoice.status,
      })),
      pendingOrders: report.summary.pendingOrders,
    },
    dashboardSnapshot: {
      customerCount: dashboard.summary.totalCustomers,
      productCount: dashboard.summary.totalProducts,
      orderCount: dashboard.summary.totalOrders,
      revenue: dashboard.summary.totalRevenue,
      pendingOrders: dashboard.summary.pendingOrders,
      lowStockCount: dashboard.summary.lowStockProducts,
    },
  };

  return { context, preset };
}

/** Asserts the serialized context does not contain dangerous internal fields. */
export function assertSafeAssistantContext(context: AssistantBusinessContext) {
  const json = JSON.stringify(context);
  const forbidden = [
    /"ownerId"/i,
    /"_id"/i,
    /"tokenHash"/i,
    /"accessToken"/i,
    /"apiKey"/i,
    /"BETTER_AUTH_SECRET"/i,
    /"pi_[A-Za-z0-9]+/,
    /"cs_[A-Za-z0-9]+/,
    /"sk_[A-Za-z0-9]+/,
    /"whsec_[A-Za-z0-9]+/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(json)) {
      throw new Error("Assistant context failed safety checks");
    }
  }
  return json;
}

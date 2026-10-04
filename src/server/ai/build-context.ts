import { getDashboardData } from "@/server/dashboard/get-dashboard-data";
import { ensureInvoiceIndexes, getInvoicesCollection } from "@/server/db/models/invoice";
import { ensurePaymentIndexes, getPaymentsCollection } from "@/server/db/models/payment";
import { getReportData } from "@/server/reports/get-report-data";
import { endOfUtcDay, startOfUtcDay, type ReportPreset } from "@/server/reports/date-range";

const TOP_N = 10;
const FOLLOW_UP_LIMIT = 10;
const DUE_SOON_DAYS = 7;
const MAX_CONTEXT_JSON_CHARS = 12_000;

export type AssistantPeriodQuery = {
  preset?: string | null;
  start?: string | null;
  end?: string | null;
};

export type AssistantBusinessContext = {
  period: {
    label: string;
    start: string;
    end: string;
    previousLabel: string;
    previousStart: string;
    previousEnd: string;
    timezone: "UTC";
    comparisonBasis: string;
  };
  dataQuality: {
    hasCustomers: boolean;
    hasProducts: boolean;
    hasOrdersInPeriod: boolean;
    hasInvoices: boolean;
    hasPaymentsInPeriod: boolean;
    orderSampleSize: number;
    invoiceOverdueSampleSize: number;
    guidance: string;
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
    dueSoonInvoices: Array<{
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

function formatUtcDate(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * Map natural-language period phrases onto Reports date-range options.
 * Uses the same UTC semantics as `resolveReportRange` / `getReportData`.
 */
export function inferAssistantPeriod(question: string): AssistantPeriodQuery {
  const q = question.toLowerCase();
  const today = startOfUtcDay(new Date());

  if (/\byesterday\b/.test(q)) {
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    const day = formatUtcDate(yesterday);
    return { preset: "custom", start: day, end: day };
  }

  if (/\btoday\b/.test(q)) {
    const day = formatUtcDate(today);
    return { preset: "custom", start: day, end: day };
  }

  // Prefer calendar "this month" when both months are mentioned (comparison uses equal-length previous window).
  if (/\b(this\s*month|current\s*month)\b/.test(q)) {
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { preset: "custom", start: formatUtcDate(first), end: formatUtcDate(today) };
  }

  if (/\b(last\s*month|previous\s*month)\b/.test(q)) {
    const firstThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const lastPrev = startOfUtcDay(new Date(firstThisMonth.getTime() - 1));
    const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
    return { preset: "custom", start: formatUtcDate(firstPrev), end: formatUtcDate(lastPrev) };
  }

  if (/\b(last\s*7|past\s*week|this\s*week|7\s*days)\b/.test(q)) return { preset: "last_7_days" };
  if (/\b(last\s*90|past\s*90|quarter|90\s*days)\b/.test(q)) return { preset: "last_90_days" };
  if (/\b(previous\s*year|last\s*year)\b/.test(q)) return { preset: "previous_year" };
  if (/\b(this\s*year|ytd|year\s*to\s*date)\b/.test(q)) return { preset: "this_year" };
  if (/\b(last\s*30|past\s*30|30\s*days|compare|vs\.?|versus|previous\s*period)\b/.test(q)) {
    return { preset: "last_30_days" };
  }
  return { preset: "last_30_days" };
}

/** @deprecated Prefer inferAssistantPeriod — kept for compatibility with simple preset checks. */
export function inferReportPreset(question: string): ReportPreset | "custom" {
  const inferred = inferAssistantPeriod(question);
  return (inferred.preset as ReportPreset | "custom") || "last_30_days";
}

function sanitizeText(value: string | undefined | null, max = 80) {
  if (!value) return "Unknown";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || "Unknown";
}

function mapInvoiceFollowUp(invoice: {
  invoiceNumber: string;
  customerSnapshot?: { name?: string };
  outstandingAmount: number;
  dueDate?: Date;
  status: string;
}) {
  return {
    invoiceNumber: sanitizeText(invoice.invoiceNumber, 40),
    customerName: sanitizeText(invoice.customerSnapshot?.name),
    outstanding: normalizeMoney(invoice.outstandingAmount),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
    status: invoice.status,
  };
}

/**
 * Builds a compact, owner-scoped analytics DTO for the model.
 * Never includes ownerId, Mongo IDs, tokens, Stripe IDs, or secrets.
 */
export async function buildAssistantBusinessContext(
  ownerId: string,
  question: string,
): Promise<{ context: AssistantBusinessContext; periodQuery: AssistantPeriodQuery }> {
  if (!ownerId) throw new Error("ownerId is required");

  const periodQuery = inferAssistantPeriod(question);
  await Promise.all([ensureInvoiceIndexes(), ensurePaymentIndexes()]);

  const reportDaysHint =
    periodQuery.preset === "last_7_days" || (periodQuery.start && periodQuery.end && periodQuery.start === periodQuery.end)
      ? 7
      : 30;

  const [report, dashboard] = await Promise.all([
    getReportData(ownerId, periodQuery),
    getDashboardData(ownerId, { days: reportDaysHint }),
  ]);

  const now = new Date();
  const dueSoonEnd = endOfUtcDay(new Date(now));
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + DUE_SOON_DAYS);

  const invoiceProjection = {
    invoiceNumber: 1,
    customerSnapshot: 1,
    outstandingAmount: 1,
    dueDate: 1,
    status: 1,
  } as const;

  const [overdueInvoices, dueSoonInvoices, paymentGroups, paymentCount] = await Promise.all([
    getInvoicesCollection()
      .find(
        {
          ownerId,
          status: { $nin: ["draft", "cancelled", "paid"] },
          outstandingAmount: { $gt: 0 },
          dueDate: { $exists: true, $type: "date", $lt: now },
        },
        { projection: invoiceProjection },
      )
      .sort({ dueDate: 1, outstandingAmount: -1 })
      .limit(FOLLOW_UP_LIMIT)
      .toArray(),
    getInvoicesCollection()
      .find(
        {
          ownerId,
          status: { $nin: ["draft", "cancelled", "paid"] },
          outstandingAmount: { $gt: 0 },
          dueDate: { $exists: true, $type: "date", $gte: now, $lte: dueSoonEnd },
        },
        { projection: invoiceProjection },
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
        { $limit: TOP_N },
      ])
      .toArray(),
    getPaymentsCollection().countDocuments({
      ownerId,
      paymentDate: { $gte: new Date(report.range.start), $lte: new Date(report.range.end) },
      voidedAt: { $exists: false },
    }),
  ]);

  const orderSampleSize = report.summary.totalOrders;
  const context: AssistantBusinessContext = {
    period: {
      label: report.range.label,
      start: report.range.start.slice(0, 10),
      end: report.range.end.slice(0, 10),
      previousLabel: "Previous comparable period",
      previousStart: report.range.previousStart.slice(0, 10),
      previousEnd: report.range.previousEnd.slice(0, 10),
      timezone: "UTC",
      comparisonBasis: "Equal-length previous UTC window from Reports date-range logic",
    },
    dataQuality: {
      hasCustomers: report.summary.totalCustomers > 0,
      hasProducts: dashboard.summary.totalProducts > 0,
      hasOrdersInPeriod: orderSampleSize > 0,
      hasInvoices: report.receivables.totalInvoiced > 0 || report.summary.overdueInvoiceCount > 0,
      hasPaymentsInPeriod: paymentCount > 0,
      orderSampleSize,
      invoiceOverdueSampleSize: report.summary.overdueInvoiceCount,
      guidance:
        orderSampleSize < 3
          ? "Insufficient order sample for trend claims; avoid phrases like trending upward/downward."
          : "Enough orders for cautious period comparisons using supplied comparison metrics.",
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
      overdueInvoices: overdueInvoices.map(mapInvoiceFollowUp),
      dueSoonInvoices: dueSoonInvoices.map(mapInvoiceFollowUp),
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

  return { context, periodQuery };
}

function shrinkContextForBudget(context: AssistantBusinessContext): AssistantBusinessContext {
  return {
    ...context,
    topProducts: context.topProducts.slice(0, 5),
    topCustomers: context.topCustomers.slice(0, 5),
    inventory: {
      lowStockProducts: context.inventory.lowStockProducts.slice(0, 5),
      outOfStockProducts: context.inventory.outOfStockProducts.slice(0, 5),
    },
    followUps: {
      ...context.followUps,
      overdueInvoices: context.followUps.overdueInvoices.slice(0, 5),
      dueSoonInvoices: context.followUps.dueSoonInvoices.slice(0, 5),
    },
    payments: {
      ...context.payments,
      methodBreakdown: context.payments.methodBreakdown.slice(0, 5),
    },
  };
}

/** Asserts the serialized context does not contain dangerous internal fields. */
export function assertSafeAssistantContext(context: AssistantBusinessContext) {
  let working = context;
  let json = JSON.stringify(working);
  if (json.length > MAX_CONTEXT_JSON_CHARS) {
    working = shrinkContextForBudget(working);
    json = JSON.stringify(working);
  }

  const forbidden = [
    /"ownerId"/i,
    /"_id"/i,
    /"tokenHash"/i,
    /"accessToken"/i,
    /"apiKey"/i,
    /"BETTER_AUTH_SECRET"/i,
    /"OPENAI_API_KEY"/i,
    /"STRIPE_SECRET_KEY"/i,
    /"STRIPE_WEBHOOK_SECRET"/i,
    /"MONGODB_URI"/i,
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

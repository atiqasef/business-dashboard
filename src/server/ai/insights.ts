import {
  type AssistantBusinessContext,
  buildAssistantBusinessContext,
} from "@/server/ai/build-context";
import {
  INSIGHT_THRESHOLDS,
  type BusinessInsight,
  type InsightSeverity,
} from "@/server/ai/insight-types";
import { DUE_SOON_WINDOW_DAYS } from "@/server/reminders/constants";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function severityRank(severity: InsightSeverity) {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

/**
 * Derives proactive insights from authoritative analytics context.
 * Does not call OpenAI — facts come only from server-calculated metrics.
 */
export function deriveBusinessInsights(context: AssistantBusinessContext): BusinessInsight[] {
  const insights: BusinessInsight[] = [];
  const period = context.period.label;
  const { summary, comparison, dataQuality, followUps, inventory } = context;

  const canCompareRevenue =
    dataQuality.orderSampleSize >= INSIGHT_THRESHOLDS.minOrdersForComparison &&
    comparison.previousOrderRevenue > 0 &&
    comparison.orderRevenueChangePct !== null;

  if (canCompareRevenue && comparison.orderRevenueChangePct! <= -INSIGHT_THRESHOLDS.revenueChangePct) {
    const change = comparison.orderRevenueChangePct!;
    insights.push({
      id: "revenue_decline",
      type: "revenue_decline",
      severity: change <= -20 ? "high" : "medium",
      title: `Revenue is down ${formatPct(change).replace("+", "")}`,
      summary: `FACT: Order revenue was ${formatMoney(summary.orderRevenue)} versus ${formatMoney(comparison.previousOrderRevenue)} in the previous comparable period (${formatPct(change)}).`,
      period,
      metrics: [
        { label: "Current revenue", value: formatMoney(summary.orderRevenue) },
        { label: "Previous revenue", value: formatMoney(comparison.previousOrderRevenue) },
        { label: "Change", value: formatPct(change) },
        { label: "Orders", value: String(summary.totalOrders) },
      ],
      recommendation:
        "INTERPRETATION: The decline aligns with period order volume changes. RECOMMENDATION: Review pending/cancelled orders and overdue receivables.",
      source: "Sales analytics",
    });
  } else if (canCompareRevenue && comparison.orderRevenueChangePct! >= INSIGHT_THRESHOLDS.revenueChangePct) {
    const change = comparison.orderRevenueChangePct!;
    insights.push({
      id: "revenue_growth",
      type: "revenue_growth",
      severity: change >= 20 ? "medium" : "info",
      title: `Revenue is up ${formatPct(change)}`,
      summary: `FACT: Order revenue was ${formatMoney(summary.orderRevenue)} versus ${formatMoney(comparison.previousOrderRevenue)} previously (${formatPct(change)}).`,
      period,
      metrics: [
        { label: "Current revenue", value: formatMoney(summary.orderRevenue) },
        { label: "Previous revenue", value: formatMoney(comparison.previousOrderRevenue) },
        { label: "Change", value: formatPct(change) },
      ],
      recommendation: "RECOMMENDATION: Note which products and customers contributed most so you can reinforce what is working.",
      source: "Sales analytics",
    });
  }

  if (summary.overdueInvoiceCount > 0 && summary.overdueReceivables > 0) {
    const top = followUps.overdueInvoices.slice(0, 3);
    const refs = top
      .map((row) => `${row.invoiceNumber} (${row.customerName}, ${formatMoney(row.outstanding)})`)
      .join("; ");
    insights.push({
      id: "overdue_receivables",
      type: "overdue_receivables",
      severity: summary.overdueInvoiceCount >= 3 || summary.overdueReceivables >= 1000 ? "high" : "medium",
      title: `${summary.overdueInvoiceCount} overdue invoice${summary.overdueInvoiceCount === 1 ? "" : "s"}`,
      summary: `FACT: ${summary.overdueInvoiceCount} invoice${summary.overdueInvoiceCount === 1 ? " is" : "s are"} overdue with ${formatMoney(summary.overdueReceivables)} outstanding.${refs ? ` Examples: ${refs}.` : ""}`,
      period,
      metrics: [
        { label: "Overdue count", value: String(summary.overdueInvoiceCount) },
        { label: "Overdue amount", value: formatMoney(summary.overdueReceivables) },
      ],
      recommendation:
        "INTERPRETATION: Overdue balances may slow cash collection. RECOMMENDATION: Prioritize follow-up on the oldest overdue invoices.",
      source: "Invoice analytics",
    });
  }

  if (followUps.dueSoonInvoices.length > 0) {
    const dueSoonTotal = followUps.dueSoonInvoices.reduce((sum, row) => sum + row.outstanding, 0);
    insights.push({
      id: "due_soon",
      type: "due_soon",
      severity: "info",
      title: `${followUps.dueSoonInvoices.length} invoice${followUps.dueSoonInvoices.length === 1 ? "" : "s"} due soon`,
      summary: `FACT: ${followUps.dueSoonInvoices.length} unpaid invoice${followUps.dueSoonInvoices.length === 1 ? " is" : "s are"} due within the next ${DUE_SOON_WINDOW_DAYS} days (${formatMoney(dueSoonTotal)} outstanding).`,
      period,
      metrics: [
        { label: "Due soon", value: String(followUps.dueSoonInvoices.length) },
        { label: "Amount", value: formatMoney(dueSoonTotal) },
      ],
      recommendation: "RECOMMENDATION: Confirm payment plans before these invoices become overdue.",
      source: "Follow-up candidates",
    });
  }

  if (summary.lowStockCount > 0 || summary.outOfStockCount > 0) {
    const names = [...inventory.outOfStockProducts, ...inventory.lowStockProducts]
      .slice(0, 3)
      .map((product) => product.name)
      .join(", ");
    insights.push({
      id: "low_stock",
      type: "low_stock",
      severity: summary.outOfStockCount > 0 ? "medium" : "info",
      title:
        summary.outOfStockCount > 0
          ? `${summary.outOfStockCount} out-of-stock product${summary.outOfStockCount === 1 ? "" : "s"}`
          : `${summary.lowStockCount} low-stock product${summary.lowStockCount === 1 ? "" : "s"}`,
      summary: `FACT: Inventory shows ${summary.lowStockCount} low-stock and ${summary.outOfStockCount} out-of-stock product${summary.outOfStockCount === 1 ? "" : "s"}.${names ? ` Examples: ${names}.` : ""}`,
      period,
      metrics: [
        { label: "Low stock", value: String(summary.lowStockCount) },
        { label: "Out of stock", value: String(summary.outOfStockCount) },
      ],
      recommendation: "RECOMMENDATION: Review replenishment before the next sales cycle.",
      source: "Product analytics",
    });
  }

  if (summary.pendingOrders >= INSIGHT_THRESHOLDS.pendingOrdersMedium) {
    insights.push({
      id: "pending_orders",
      type: "pending_orders",
      severity: summary.pendingOrders >= INSIGHT_THRESHOLDS.pendingOrdersHigh ? "medium" : "info",
      title: `${summary.pendingOrders} pending orders`,
      summary: `FACT: ${summary.pendingOrders} order${summary.pendingOrders === 1 ? " is" : "s are"} currently pending in the selected period.`,
      period,
      metrics: [{ label: "Pending orders", value: String(summary.pendingOrders) }],
      recommendation: "RECOMMENDATION: Clear pending orders that are waiting on confirmation or fulfillment.",
      source: "Sales analytics",
    });
  }

  if (
    summary.totalOrders >= INSIGHT_THRESHOLDS.minOrdersForCancellation &&
    summary.cancelledOrders / summary.totalOrders >= INSIGHT_THRESHOLDS.cancellationRate
  ) {
    const rate = Number(((summary.cancelledOrders / summary.totalOrders) * 100).toFixed(1));
    insights.push({
      id: "cancellation_signal",
      type: "cancellation_signal",
      severity: rate >= 25 ? "high" : "medium",
      title: `Cancellations at ${rate}%`,
      summary: `FACT: ${summary.cancelledOrders} of ${summary.totalOrders} orders were cancelled (${rate}%) in ${period}.`,
      period,
      metrics: [
        { label: "Cancelled", value: String(summary.cancelledOrders) },
        { label: "Total orders", value: String(summary.totalOrders) },
        { label: "Rate", value: `${rate}%` },
      ],
      recommendation:
        "INTERPRETATION: Elevated cancellations may reduce realized revenue. RECOMMENDATION: Review why orders are being cancelled.",
      source: "Sales analytics",
    });
  }

  const invoiced = context.receivables.totalInvoiced;
  const outstanding = context.receivables.outstanding;
  if (
    invoiced > 0 &&
    outstanding / invoiced >= INSIGHT_THRESHOLDS.outstandingShareOfInvoiced &&
    (summary.overdueInvoiceCount > 0 || outstanding > summary.paymentsCollected)
  ) {
    const share = Number(((outstanding / invoiced) * 100).toFixed(1));
    insights.push({
      id: "payment_collection",
      type: "payment_collection",
      severity: share >= 40 ? "high" : "medium",
      title: "Receivables collection pressure",
      summary: `FACT: ${formatMoney(outstanding)} is outstanding of ${formatMoney(invoiced)} invoiced (${share}%). Period collections were ${formatMoney(summary.paymentsCollected)}.`,
      period,
      metrics: [
        { label: "Outstanding", value: formatMoney(outstanding) },
        { label: "Total invoiced", value: formatMoney(invoiced) },
        { label: "Period collected", value: formatMoney(summary.paymentsCollected) },
      ],
      recommendation:
        "INTERPRETATION: A large unpaid share can strain cash flow. RECOMMENDATION: Focus collection on overdue and due-soon invoices.",
      source: "Payment analytics",
    });
  }

  return insights
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id))
    .slice(0, INSIGHT_THRESHOLDS.maxVisibleInsights);
}

/** Owner-scoped deterministic insights for the last 30 days (Reports UTC window). */
export async function getBusinessInsights(ownerId: string) {
  if (!ownerId) throw new Error("ownerId is required");
  const built = await buildAssistantBusinessContext(ownerId, "Compare revenue with the previous period");
  return {
    insights: deriveBusinessInsights(built.context),
    period: built.context.period,
    dataQuality: built.context.dataQuality,
  };
}

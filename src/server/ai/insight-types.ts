export const insightTypes = [
  "revenue_decline",
  "revenue_growth",
  "overdue_receivables",
  "due_soon",
  "low_stock",
  "pending_orders",
  "cancellation_signal",
  "payment_collection",
] as const;

export type InsightType = (typeof insightTypes)[number];
export type InsightSeverity = "info" | "medium" | "high";

export type InsightMetric = {
  label: string;
  value: string;
};

export type BusinessInsight = {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  summary: string;
  period?: string;
  metrics?: InsightMetric[];
  recommendation?: string;
  source: string;
};

/** Deterministic thresholds for proactive insights (UTC last-30-days analytics). */
export const INSIGHT_THRESHOLDS = {
  revenueChangePct: 10,
  minOrdersForComparison: 3,
  minOrdersForCancellation: 5,
  cancellationRate: 0.15,
  pendingOrdersMedium: 3,
  pendingOrdersHigh: 8,
  outstandingShareOfInvoiced: 0.25,
  maxVisibleInsights: 5,
} as const;

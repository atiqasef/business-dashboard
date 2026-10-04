import type { InvoiceStatus } from "@/server/db/models/invoice";
import type { OrderStatus } from "@/server/db/models/order";
import type { ReportGranularity, ReportPreset } from "@/server/reports/date-range";

export type ReportTrendPoint = {
  key: string;
  label: string;
  value: number;
};

export type ReportOrderTrendPoint = {
  key: string;
  label: string;
  orderCount: number;
  revenueOrders: number;
};

export type ReportOrderStatusCount = {
  status: OrderStatus;
  count: number;
};

export type ReportInvoiceStatusRow = {
  status: InvoiceStatus;
  count: number;
  total: number;
  outstanding: number;
};

export type ReportTopProduct = {
  id: string;
  name: string;
  sku: string;
  quantitySold: number;
  revenue: number;
};

export type ReportTopCustomer = {
  id: string;
  name: string;
  orders: number;
  revenue: number;
};

export type ReportInventoryProduct = {
  id: string;
  name: string;
  sku: string;
  stock: number;
};

export type ReportComparison = {
  orderRevenueChangePct: number | null;
  ordersChangePct: number | null;
  paymentsCollectedChangePct: number | null;
  previousOrderRevenue: number;
  previousOrders: number;
  previousPaymentsCollected: number;
  hasPreviousActivity: boolean;
};

export type ReportData = {
  range: {
    preset: ReportPreset;
    label: string;
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
    granularity: ReportGranularity;
  };
  summary: {
    orderRevenue: number;
    totalOrders: number;
    pendingOrders: number;
    confirmedOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    revenueOrderCount: number;
    averageOrderValue: number;
    paymentsCollected: number;
    /** Current outstanding balance across all non-cancelled invoices (not limited to the selected period). */
    outstandingReceivables: number;
    overdueReceivables: number;
    overdueInvoiceCount: number;
    customersInPeriod: number;
    totalCustomers: number;
  };
  comparison: ReportComparison;
  revenueTrend: ReportTrendPoint[];
  orderTrend: ReportOrderTrendPoint[];
  paymentTrend: ReportTrendPoint[];
  orderStatusBreakdown: ReportOrderStatusCount[];
  invoiceStatusBreakdown: ReportInvoiceStatusRow[];
  receivables: {
    /** Current portfolio totals (as of now). */
    totalInvoiced: number;
    totalPaid: number;
    outstanding: number;
    overdue: number;
    /** Selected-period invoice/payment activity. */
    periodInvoiced: number;
    periodPaymentsCollected: number;
  };
  topProducts: ReportTopProduct[];
  topCustomers: ReportTopCustomer[];
  inventory: {
    lowStockCount: number;
    outOfStockCount: number;
    lowStockProducts: ReportInventoryProduct[];
    outOfStockProducts: ReportInventoryProduct[];
  };
};

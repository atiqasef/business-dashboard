import type { OrderStatus } from "@/server/db/models/order";

export type DashboardSummary = {
  totalCustomers: number;
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  confirmedOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  lowStockProducts: number;
};

export type DashboardRecentOrder = {
  id: string;
  customerName: string;
  createdAt: string;
  itemCount: number;
  total: number;
  status: OrderStatus;
};

export type DashboardRecentCustomer = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  createdAt: string;
};

export type DashboardLowStockProduct = {
  id: string;
  name: string;
  sku: string;
  stock: number;
};

export type DashboardTopProduct = {
  id: string;
  name: string;
  sku: string;
  quantitySold: number;
  revenue: number;
};

export type DashboardStatusCount = {
  status: OrderStatus;
  count: number;
};

export type DashboardTrendPoint = {
  date: string;
  revenue: number;
  orderCount: number;
};

export type DashboardData = {
  summary: DashboardSummary;
  recentOrders: DashboardRecentOrder[];
  recentCustomers: DashboardRecentCustomer[];
  lowStockProducts: DashboardLowStockProduct[];
  topProducts: DashboardTopProduct[];
  statusDistribution: DashboardStatusCount[];
  revenueTrend: DashboardTrendPoint[];
  range: {
    days: number;
    start: string;
    end: string;
  };
};

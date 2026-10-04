import type { OrderStatus } from "@/server/db/models/order";

/** Orders that contribute to dashboard revenue (excludes cancelled). */
export const REVENUE_ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed", "completed"];

export const DASHBOARD_RECENT_ORDERS_LIMIT = 8;
export const DASHBOARD_RECENT_CUSTOMERS_LIMIT = 5;
export const DASHBOARD_LOW_STOCK_THRESHOLD = 10;
export const DASHBOARD_LOW_STOCK_LIMIT = 5;
export const DASHBOARD_TOP_PRODUCTS_LIMIT = 5;
export const DASHBOARD_TREND_DAYS = 30;
export const DASHBOARD_TREND_DAYS_MIN = 7;
export const DASHBOARD_TREND_DAYS_MAX = 90;

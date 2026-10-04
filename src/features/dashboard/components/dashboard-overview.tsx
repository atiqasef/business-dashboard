import Link from "next/link";
import {
  Boxes,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Package,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { TablePlaceholder } from "@/components/ui/placeholders";
import { BusinessInsightsPanel } from "@/features/dashboard/components/business-insights-panel";
import { OnboardingDashboardPrompt } from "@/features/onboarding/components/onboarding-checklist";
import type { OnboardingStatus } from "@/server/onboarding/status";
import type { BusinessInsight } from "@/server/ai/insight-types";
import { DASHBOARD_LOW_STOCK_THRESHOLD } from "@/server/dashboard/constants";
import type { DashboardData } from "@/server/dashboard/types";
import type { OrderStatus } from "@/server/db/models/order";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatHeadingDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function statusTone(status: OrderStatus) {
  switch (status) {
    case "completed":
      return "positive" as const;
    case "confirmed":
      return "accent" as const;
    case "cancelled":
      return "neutral" as const;
    default:
      return "warning" as const;
  }
}

function statusLabel(status: OrderStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function DashboardOverview({
  userName,
  readOnlyDemo,
  data,
  insights = [],
  insightsPeriodLabel = "Last 30 days",
  aiConfigured = false,
  onboarding = null,
}: {
  userName: string;
  readOnlyDemo: boolean;
  data: DashboardData;
  insights?: BusinessInsight[];
  insightsPeriodLabel?: string;
  aiConfigured?: boolean;
  onboarding?: OnboardingStatus | null;
}) {
  const { summary, recentOrders, recentCustomers, lowStockProducts, topProducts, statusDistribution, revenueTrend } = data;
  const maxTrendRevenue = Math.max(...revenueTrend.map((point) => point.revenue), 0);
  const fulfilledShare = summary.totalOrders
    ? Math.round((summary.completedOrders / summary.totalOrders) * 100)
    : 0;
  const activeShare = summary.totalOrders
    ? Math.round(((summary.pendingOrders + summary.confirmedOrders) / summary.totalOrders) * 100)
    : 0;
  const completedRevenueShare = summary.totalOrders
    ? Math.round((summary.completedOrders / summary.totalOrders) * 100)
    : 0;

  const metrics = [
    {
      label: "Total revenue",
      value: formatMoney(summary.totalRevenue),
      detail: "Order revenue · excludes cancelled",
      icon: CircleDollarSign,
      tone: "accent" as const,
      accent: formatNumber(summary.completedOrders) + " completed",
    },
    {
      label: "Total orders",
      value: formatNumber(summary.totalOrders),
      detail: `${formatNumber(summary.pendingOrders)} pending · ${formatNumber(summary.confirmedOrders)} confirmed`,
      icon: ShoppingCart,
      tone: "green" as const,
      accent: formatNumber(summary.cancelledOrders) + " cancelled",
    },
    {
      label: "Customers",
      value: formatNumber(summary.totalCustomers),
      detail: "Active customer records",
      icon: Users,
      tone: "blue" as const,
      accent: recentCustomers.length ? `${recentCustomers.length} recent` : "No recent activity",
    },
    {
      label: "Products",
      value: formatNumber(summary.totalProducts),
      detail: "Catalog size",
      icon: Boxes,
      tone: "orange" as const,
      accent: `${formatNumber(summary.lowStockProducts)} low stock`,
    },
  ];

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">{formatHeadingDate()}</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Good morning, {userName || "there"}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Live business metrics from your customers, products, and orders.</p>
          {readOnlyDemo ? <Badge tone="accent" className="mt-3">Read-only demo</Badge> : null}
        </div>
        <div className="flex flex-col gap-3 self-start sm:flex-row">
          <Link href="/orders"><Button variant="secondary"><ShoppingCart className="size-4" aria-hidden="true" />View orders</Button></Link>
          <Link href="/invoices"><Button variant="secondary"><FileText className="size-4" aria-hidden="true" />View invoices</Button></Link>
        </div>
      </div>

      {onboarding ? <OnboardingDashboardPrompt status={onboarding} /> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Business overview">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label} padding="compact" className="min-h-36">
              <div className="flex items-start justify-between">
                <span
                  className={`grid size-10 place-items-center rounded-xl ${
                    metric.tone === "accent"
                      ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      : metric.tone === "green"
                        ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                        : metric.tone === "blue"
                          ? "bg-[var(--blue-soft)] text-[var(--blue)]"
                          : "bg-[var(--warning-soft)] text-[var(--warning)]"
                  }`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-4 text-sm text-[var(--muted)]">{metric.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <p className="text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p>
                <span className={`text-xs font-semibold ${metric.tone === "orange" ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}>{metric.accent}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">{metric.detail}</p>
            </Card>
          );
        })}
      </section>

      <section className="mt-5" aria-label="Business insights">
        <BusinessInsightsPanel
          insights={insights}
          periodLabel={insightsPeriodLabel}
          aiConfigured={aiConfigured}
        />
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Receivables overview">
        {[
          {
            label: "Outstanding receivables",
            value: formatMoney(summary.outstandingReceivables),
            detail: "Unpaid invoice balances",
            accent: `${formatNumber(summary.unpaidInvoiceCount)} unpaid`,
            icon: Wallet,
            tone: "warning" as const,
            href: "/payments",
          },
          {
            label: "Collected payments",
            value: formatMoney(summary.collectedPayments),
            detail: "Paid amount on active invoices",
            accent: "View payments",
            icon: CircleDollarSign,
            tone: "positive" as const,
            href: "/payments",
          },
          {
            label: "Overdue invoices",
            value: formatNumber(summary.overdueInvoiceCount),
            detail: "Past due with balance remaining",
            accent: summary.overdueInvoiceCount ? "Needs follow-up" : "None overdue",
            icon: FileText,
            tone: "accent" as const,
            href: "/invoices",
          },
          {
            label: "Order revenue",
            value: formatMoney(summary.totalRevenue),
            detail: "From non-cancelled orders",
            accent: "Separate from collections",
            icon: ShoppingCart,
            tone: "blue" as const,
          },
        ].map((metric) => {
          const Icon = metric.icon;
          const card = (
            <Card padding="compact" className="min-h-32 transition-colors hover:border-[var(--line-strong)]">
              <div className="flex items-start justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="text-xs font-semibold text-[var(--muted)]">{metric.accent}</span>
              </div>
              <p className="mt-4 text-sm text-[var(--muted)]">{metric.label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{metric.detail}</p>
            </Card>
          );
          return "href" in metric && metric.href ? (
            <Link
              key={metric.label}
              href={metric.href}
              className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              {card}
            </Link>
          ) : (
            <div key={metric.label}>{card}</div>
          );
        })}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
        <Card>
          <CardHeading>
            <div>
              <h2 className="text-base font-semibold">Revenue trend</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Last {data.range.days} days · non-cancelled orders</p>
            </div>
          </CardHeading>
          <div className="mt-7 flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold tracking-[-0.035em]">{formatMoney(summary.totalRevenue)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {formatNumber(revenueTrend.reduce((sum, point) => sum + point.orderCount, 0))} orders in range
              </p>
            </div>
          </div>
          {revenueTrend.every((point) => point.revenue === 0) ? (
            <div className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-5 py-10 text-center">
              <p className="text-sm font-semibold">No revenue in this period</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Create orders to see your daily revenue trend.</p>
            </div>
          ) : (
            <>
              <div className="relative mt-8 h-52 border-b border-l border-[var(--line)] px-2 pb-2 pt-3">
                <div className="pointer-events-none absolute inset-x-0 top-1/4 border-t border-dashed border-[var(--line)]" />
                <div className="pointer-events-none absolute inset-x-0 top-2/4 border-t border-dashed border-[var(--line)]" />
                <div className="pointer-events-none absolute inset-x-0 top-3/4 border-t border-dashed border-[var(--line)]" />
                <div className="relative flex h-full items-end justify-between gap-1 sm:gap-1.5">
                  {revenueTrend.map((point) => {
                    const height = maxTrendRevenue > 0 ? Math.max((point.revenue / maxTrendRevenue) * 100, point.revenue > 0 ? 6 : 0) : 0;
                    return (
                      <span
                        key={point.date}
                        className="chart-bar min-w-0 flex-1"
                        style={{ height: `${height}%` }}
                        title={`${point.date}: ${formatMoney(point.revenue)} · ${point.orderCount} orders`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 flex justify-between pl-2 text-[11px] text-[var(--muted)]">
                <span>{formatDate(revenueTrend[0]?.date ?? data.range.start)}</span>
                <span>{formatDate(revenueTrend[revenueTrend.length - 1]?.date ?? data.range.end)}</span>
              </div>
            </>
          )}
        </Card>

        <Card>
          <CardHeading>
            <div>
              <h2 className="text-base font-semibold">Inventory watch</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Products at or below {DASHBOARD_LOW_STOCK_THRESHOLD} units</p>
            </div>
            <Link href="/products" aria-label="View products">
              <Button variant="icon" className="size-8"><ChevronRight className="size-4" aria-hidden="true" /></Button>
            </Link>
          </CardHeading>
          {lowStockProducts.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-4 py-8 text-center">
              <p className="text-sm font-semibold">No low-stock products</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Stock levels look healthy right now.</p>
            </div>
          ) : (
            <div className="mt-5 divide-y divide-[var(--line)]">
              {lowStockProducts.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">
                    <Package className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{item.sku}</p>
                  </div>
                  <Badge tone={item.stock <= 5 ? "warning" : "accent"}>{item.stock} left</Badge>
                </div>
              ))}
            </div>
          )}
          <p className="mt-5 rounded-2xl bg-[var(--surface-soft)] px-4 py-3 text-sm text-[var(--muted)]">
            <span className="font-medium text-[var(--ink)]">{formatNumber(summary.lowStockProducts)} products</span> need attention before the next restock cycle.
          </p>
        </Card>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
        <Card padding="none">
          <div className="p-5 sm:p-6">
            <CardHeading>
              <div>
                <h2 className="text-base font-semibold">Recent orders</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Latest activity from your customers</p>
              </div>
              <Link href="/orders">
                <Button variant="ghost" className="h-9 px-2 text-xs">View all <ChevronRight className="size-3.5" aria-hidden="true" /></Button>
              </Link>
            </CardHeading>
          </div>
          {recentOrders.length === 0 ? (
            <div className="px-5 pb-6 sm:px-6">
              <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-4 py-10 text-center">
                <p className="text-sm font-semibold">No orders yet</p>
                <p className="mt-1 text-sm text-[var(--muted)]">When you create orders, they will show up here.</p>
              </div>
            </div>
          ) : (
            <TablePlaceholder>
              <table className="w-full text-left">
                <thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Order</th>
                    <th className="hidden px-5 py-3 font-semibold sm:table-cell">Customer</th>
                    <th className="hidden px-5 py-3 font-semibold md:table-cell">Date</th>
                    <th className="hidden px-5 py-3 font-semibold lg:table-cell">Items</th>
                    <th className="px-5 py-3 font-semibold">Amount</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="text-sm">
                      <td className="px-5 py-4 font-semibold">
                        #{order.id.slice(-6).toUpperCase()}
                        <span className="mt-1 block text-xs font-normal text-[var(--muted)] sm:hidden">{order.customerName}</span>
                      </td>
                      <td className="hidden px-5 py-4 text-[var(--muted)] sm:table-cell">{order.customerName}</td>
                      <td className="hidden px-5 py-4 text-[var(--muted)] md:table-cell">{formatDateTime(order.createdAt)}</td>
                      <td className="hidden px-5 py-4 text-[var(--muted)] lg:table-cell">{order.itemCount}</td>
                      <td className="px-5 py-4 font-medium">{formatMoney(order.total)}</td>
                      <td className="px-5 py-4"><Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablePlaceholder>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeading>
              <div>
                <h2 className="text-base font-semibold">Order status</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Distribution across your workspace</p>
              </div>
              <ClipboardList className="size-5 text-[var(--muted)]" aria-hidden="true" />
            </CardHeading>
            <div className="mt-6 space-y-4">
              {statusDistribution.map((entry) => {
                const percent = summary.totalOrders ? Math.round((entry.count / summary.totalOrders) * 100) : 0;
                return (
                  <div key={entry.status}>
                    <div className="mb-2 flex justify-between text-sm">
                      <span className="text-[var(--muted)]">{statusLabel(entry.status)}</span>
                      <span className="font-semibold">{formatNumber(entry.count)} · {percent}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--surface-soft)]">
                      <div
                        className={`h-2 rounded-full ${
                          entry.status === "completed"
                            ? "bg-[var(--positive)]"
                            : entry.status === "confirmed"
                              ? "bg-[var(--accent)]"
                              : entry.status === "cancelled"
                                ? "bg-[var(--line-strong)]"
                                : "bg-[var(--warning)]"
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-7 border-t border-[var(--line)] pt-5">
              <p className="text-sm font-semibold">{summary.totalOrders === 0 ? "Start with your first order." : "Keep the momentum going."}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                {summary.totalOrders === 0
                  ? "Add customers and products, then create an order to unlock live analytics."
                  : `${fulfilledShare}% completed · ${activeShare}% in progress · ${completedRevenueShare}% of orders fully closed.`}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeading>
              <div>
                <h2 className="text-base font-semibold">Top products</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">By revenue from non-cancelled orders</p>
              </div>
            </CardHeading>
            {topProducts.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-4 py-8 text-center">
                <p className="text-sm font-semibold">No product sales yet</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Order line items will rank products here.</p>
              </div>
            ) : (
              <div className="mt-5 divide-y divide-[var(--line)]">
                {topProducts.map((product) => (
                  <div key={product.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{product.name}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{product.sku} · {formatNumber(product.quantitySold)} sold</p>
                    </div>
                    <p className="text-sm font-semibold">{formatMoney(product.revenue)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeading>
              <div>
                <h2 className="text-base font-semibold">Recent customers</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Newest records in your workspace</p>
              </div>
              <Link href="/customers" aria-label="View customers">
                <Button variant="icon" className="size-8"><ChevronRight className="size-4" aria-hidden="true" /></Button>
              </Link>
            </CardHeading>
            {recentCustomers.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-4 py-8 text-center">
                <p className="text-sm font-semibold">No customers yet</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Add a customer to populate this list.</p>
              </div>
            ) : (
              <div className="mt-5 divide-y divide-[var(--line)]">
                {recentCustomers.map((customer) => (
                  <div key={customer.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-semibold">{customer.name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {customer.company || customer.email || "No contact details"} · {formatDate(customer.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>
    </main>
  );
}

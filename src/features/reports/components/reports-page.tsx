"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  CircleDollarSign,
  Package,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DASHBOARD_LOW_STOCK_THRESHOLD } from "@/server/dashboard/constants";
import { reportPresets, type ReportPreset } from "@/server/reports/date-range";
import type { ReportData } from "@/server/reports/types";
import { OrdersTrendChart, PaymentTrendChart, RevenueTrendChart } from "@/features/reports/components/report-charts";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPct(value: number | null) {
  if (value === null) return "No previous-period data";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}% vs previous period`;
}

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toDateInputValue(iso: string) {
  return iso.slice(0, 10);
}

const presetLabels: Record<ReportPreset, string> = {
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_year: "This year",
  previous_year: "Previous year",
  custom: "Custom range",
};

export function ReportsPage({
  data,
  readOnlyDemo,
  rangeError,
}: {
  data: ReportData;
  readOnlyDemo: boolean;
  rangeError?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [preset, setPreset] = useState<ReportPreset>(data.range.preset);
  const [customStart, setCustomStart] = useState(toDateInputValue(data.range.start));
  const [customEnd, setCustomEnd] = useState(toDateInputValue(data.range.end));

  function applyRange(nextPreset: ReportPreset, start?: string, end?: string) {
    const params = new URLSearchParams();
    params.set("preset", nextPreset);
    if (nextPreset === "custom" && start && end) {
      params.set("start", start);
      params.set("end", end);
    }
    startTransition(() => {
      router.push(`/reports?${params.toString()}`);
    });
  }

  function onPresetChange(next: ReportPreset) {
    setPreset(next);
    if (next !== "custom") applyRange(next);
  }

  function onCustomSubmit(event: FormEvent) {
    event.preventDefault();
    applyRange("custom", customStart, customEnd);
  }

  const { summary, comparison, receivables, inventory } = data;
  const metrics = [
    {
      label: "Order revenue",
      value: formatMoney(summary.orderRevenue),
      detail: "Same definition as Dashboard · excludes cancelled",
      icon: CircleDollarSign,
      change: comparison.orderRevenueChangePct,
    },
    {
      label: "Orders",
      value: formatNumber(summary.totalOrders),
      detail: `${summary.completedOrders} completed · ${summary.pendingOrders} pending · ${summary.cancelledOrders} cancelled`,
      icon: ShoppingCart,
      change: comparison.ordersChangePct,
    },
    {
      label: "Payments collected",
      value: formatMoney(summary.paymentsCollected),
      detail: "Cash collected in selected period",
      icon: Wallet,
      change: comparison.paymentsCollectedChangePct,
    },
    {
      label: "Outstanding receivables",
      value: formatMoney(summary.outstandingReceivables),
      detail: "Current balance as of now · not period-limited",
      icon: CircleDollarSign,
      change: null as number | null,
      fixedNote: `${formatMoney(summary.overdueReceivables)} overdue`,
    },
    {
      label: "Average order value",
      value: formatMoney(summary.averageOrderValue),
      detail: "Order revenue ÷ revenue-eligible orders",
      icon: CircleDollarSign,
      change: null as number | null,
      fixedNote: `${formatNumber(summary.revenueOrderCount)} revenue orders`,
    },
    {
      label: "Customers",
      value: formatNumber(summary.customersInPeriod),
      detail: `New in period · ${formatNumber(summary.totalCustomers)} total`,
      icon: Users,
      change: null as number | null,
      fixedNote: `${formatNumber(summary.totalCustomers)} total customers`,
    },
  ];

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Reports</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Reports</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Deeper sales, collection, and inventory analysis for {data.range.label}. Order revenue and payment
            collections are tracked separately.
          </p>
          {readOnlyDemo ? (
            <p className="mt-3 text-xs font-medium text-[var(--muted)]">Demo account · view only</p>
          ) : null}
        </div>

        <div className="w-full max-w-xl rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:p-5">
          <label htmlFor="report-preset" className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">
            Date range
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              id="report-preset"
              className="h-10 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)]"
              value={preset}
              disabled={isPending}
              onChange={(event) => onPresetChange(event.target.value as ReportPreset)}
            >
              {reportPresets.map((value) => (
                <option key={value} value={value}>
                  {presetLabels[value]}
                </option>
              ))}
            </select>
            {isPending ? (
              <span className="text-xs font-medium text-[var(--muted)]" aria-live="polite">
                Updating…
              </span>
            ) : null}
          </div>

          {preset === "custom" ? (
            <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={onCustomSubmit}>
              <div>
                <label htmlFor="report-start" className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  Start
                </label>
                <Input
                  id="report-start"
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="report-end" className="mb-1 block text-xs font-medium text-[var(--muted)]">
                  End
                </label>
                <Input
                  id="report-end"
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  required
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="primary" disabled={isPending} className="w-full sm:w-auto">
                  Apply
                </Button>
              </div>
            </form>
          ) : null}

          {rangeError ? (
            <p className="mt-3 text-xs font-medium text-[var(--warning)]" role="alert">
              {rangeError}. Showing Last 30 days instead.
            </p>
          ) : null}
        </div>
      </div>

      {!comparison.hasPreviousActivity ? (
        <p className="mb-4 text-sm text-[var(--muted)]">No previous-period data for growth comparison.</p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Summary metrics">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p>
                </div>
                <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--ink)]">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{metric.detail}</p>
              <p className="mt-2 text-xs font-medium text-[var(--ink)]">
                {"fixedNote" in metric && metric.fixedNote
                  ? metric.fixedNote
                  : formatPct(metric.change)}
              </p>
            </Card>
          );
        })}
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-3" aria-label="Trends">
        <Card className="xl:col-span-2">
          <CardHeading>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Revenue trend</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Order revenue by {data.range.granularity} · USD
              </p>
            </div>
          </CardHeading>
          <div className="mt-4">
            <RevenueTrendChart data={data.revenueTrend} />
          </div>
        </Card>

        <Card>
          <CardHeading>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Orders trend</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Order count over time</p>
            </div>
          </CardHeading>
          <div className="mt-4">
            <OrdersTrendChart data={data.orderTrend} />
          </div>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeading>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Payment collection trend</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Cash collected from invoice payments · distinct from order revenue
              </p>
            </div>
          </CardHeading>
          <div className="mt-4">
            <PaymentTrendChart data={data.paymentTrend} />
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Invoices and receivables">
        <Card>
          <CardHeading>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Invoice status</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Current invoice portfolio</p>
            </div>
          </CardHeading>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs tracking-[0.12em] text-[var(--muted)] uppercase">
                <tr>
                  <th className="px-2 py-2 font-bold">Status</th>
                  <th className="px-2 py-2 font-bold">Count</th>
                  <th className="px-2 py-2 font-bold">Amount</th>
                  <th className="px-2 py-2 font-bold">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {data.invoiceStatusBreakdown.every((row) => row.count === 0) ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-8 text-[var(--muted)]">
                      No invoices yet.
                    </td>
                  </tr>
                ) : (
                  data.invoiceStatusBreakdown.map((row) => (
                    <tr key={row.status} className="border-t border-[var(--line)]">
                      <td className="px-2 py-3">
                        <Badge tone={row.status === "overdue" ? "warning" : row.status === "paid" ? "positive" : "neutral"}>
                          {statusLabel(row.status)}
                        </Badge>
                      </td>
                      <td className="px-2 py-3">{formatNumber(row.count)}</td>
                      <td className="px-2 py-3 font-medium">{formatMoney(row.total)}</td>
                      <td className="px-2 py-3 text-[var(--muted)]">{formatMoney(row.outstanding)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeading>
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.02em]">Receivables</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Current balances vs period activity</p>
            </div>
          </CardHeading>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              { label: "Total invoiced (current)", value: formatMoney(receivables.totalInvoiced) },
              { label: "Total paid (current)", value: formatMoney(receivables.totalPaid) },
              { label: "Outstanding (current)", value: formatMoney(receivables.outstanding) },
              { label: "Overdue (current)", value: formatMoney(receivables.overdue) },
              { label: "Invoiced in period", value: formatMoney(receivables.periodInvoiced) },
              { label: "Collected in period", value: formatMoney(receivables.periodPaymentsCollected) },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-[var(--surface-soft)] px-4 py-3">
                <dt className="text-xs font-medium text-[var(--muted)]">{item.label}</dt>
                <dd className="mt-1 text-lg font-semibold tracking-[-0.02em]">{item.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Top products and customers">
        <Card padding="none">
          <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Top products</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">By order revenue in selected period</p>
          </div>
          {data.topProducts.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[var(--muted)] sm:px-6">No product sales for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold sm:px-6">Product</th>
                    <th className="px-5 py-3 font-bold">Qty</th>
                    <th className="px-5 py-3 font-bold sm:pr-8">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((product) => (
                    <tr key={product.id} className="border-t border-[var(--line)]">
                      <td className="px-5 py-3 sm:px-6">
                        <p className="font-medium">{product.name}</p>
                        <p className="text-xs text-[var(--muted)]">{product.sku}</p>
                      </td>
                      <td className="px-5 py-3">{formatNumber(product.quantitySold)}</td>
                      <td className="px-5 py-3 font-medium sm:pr-8">{formatMoney(product.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padding="none">
          <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Top customers</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">By order revenue in selected period</p>
          </div>
          {data.topCustomers.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[var(--muted)] sm:px-6">No customer sales for this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-bold sm:px-6">Customer</th>
                    <th className="px-5 py-3 font-bold">Orders</th>
                    <th className="px-5 py-3 font-bold sm:pr-8">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topCustomers.map((customer) => (
                    <tr key={customer.id} className="border-t border-[var(--line)]">
                      <td className="px-5 py-3 font-medium sm:px-6">{customer.name}</td>
                      <td className="px-5 py-3">{formatNumber(customer.orders)}</td>
                      <td className="px-5 py-3 font-medium sm:pr-8">{formatMoney(customer.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Inventory insights">
        <Card padding="none">
          <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">Low stock</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Stock ≤ {DASHBOARD_LOW_STOCK_THRESHOLD} (current)
                </p>
              </div>
              <Badge tone="warning">{formatNumber(inventory.lowStockCount)}</Badge>
            </div>
          </div>
          {inventory.lowStockProducts.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[var(--muted)] sm:px-6">No low-stock products.</div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {inventory.lowStockProducts.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-[var(--muted)]">{product.sku}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Package className="size-4 text-[var(--muted)]" aria-hidden="true" />
                    {formatNumber(product.stock)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="none">
          <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.02em]">Out of stock</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Stock at or below zero (current)</p>
              </div>
              <Badge tone="neutral">{formatNumber(inventory.outOfStockCount)}</Badge>
            </div>
          </div>
          {inventory.outOfStockProducts.length === 0 ? (
            <div className="px-5 py-10 text-sm text-[var(--muted)] sm:px-6">No out-of-stock products.</div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {inventory.outOfStockProducts.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-[var(--muted)]">{product.sku}</p>
                  </div>
                  <span className="text-sm font-semibold">{formatNumber(product.stock)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </main>
  );
}

"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportOrderTrendPoint, ReportTrendPoint } from "@/server/reports/types";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatMoneyExact(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-6 text-center text-sm text-[var(--muted)]">
      {message}
    </div>
  );
}

function ChartTooltipShell({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; color?: string }>;
  label?: string;
  valueFormatter: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--ink)]">{label}</p>
      <ul className="mt-1 space-y-1 text-[var(--muted)]">
        {payload.map((entry) => (
          <li key={entry.name}>
            <span className="mr-2 inline-block size-2 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
            {entry.name}: {valueFormatter(Number(entry.value ?? 0))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RevenueTrendChart({ data }: { data: ReportTrendPoint[] }) {
  const hasData = data.some((point) => point.value > 0);
  if (!hasData) return <ChartEmpty message="No sales data for this period." />;

  return (
    <div className="h-72 w-full" role="img" aria-label="Order revenue trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(value) => formatMoney(Number(value))}
          />
          <Tooltip content={<ChartTooltipShell valueFormatter={formatMoneyExact} />} />
          <Area
            type="monotone"
            dataKey="value"
            name="Order revenue"
            stroke="var(--accent)"
            fill="url(#revenueFill)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrdersTrendChart({ data }: { data: ReportOrderTrendPoint[] }) {
  const hasData = data.some((point) => point.orderCount > 0);
  if (!hasData) return <ChartEmpty message="No orders for this period." />;

  return (
    <div className="h-72 w-full" role="img" aria-label="Orders trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<ChartTooltipShell valueFormatter={(value) => String(value)} />} />
          <Bar dataKey="orderCount" name="Orders" fill="var(--ink)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaymentTrendChart({ data }: { data: ReportTrendPoint[] }) {
  const hasData = data.some((point) => point.value > 0);
  if (!hasData) return <ChartEmpty message="No payments collected in this period." />;

  return (
    <div className="h-72 w-full" role="img" aria-label="Payment collection trend chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="paymentFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--positive)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(value) => formatMoney(Number(value))}
          />
          <Tooltip content={<ChartTooltipShell valueFormatter={formatMoneyExact} />} />
          <Area
            type="monotone"
            dataKey="value"
            name="Payments collected"
            stroke="var(--positive)"
            fill="url(#paymentFill)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

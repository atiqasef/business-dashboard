import { endOfUtcDay, startOfUtcDay } from "@/server/reports/date-range";

export const paymentDatePresets = ["all_time", "last_7_days", "last_30_days", "last_90_days", "custom"] as const;
export type PaymentDatePreset = (typeof paymentDatePresets)[number];

export type ResolvedPaymentDateRange = {
  preset: PaymentDatePreset;
  start: Date | null;
  end: Date | null;
  label: string;
};

function parseUtcDateOnly(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${field} is invalid`);
  }
  return date;
}

export function resolvePaymentDateRange(input: {
  preset?: string | null;
  start?: string | null;
  end?: string | null;
}): ResolvedPaymentDateRange {
  const rawPreset = (input.preset ?? "all_time").trim() || "all_time";
  if (!paymentDatePresets.includes(rawPreset as PaymentDatePreset)) {
    throw new Error("Invalid date preset");
  }
  const preset = rawPreset as PaymentDatePreset;
  const today = startOfUtcDay(new Date());

  if (preset === "all_time") {
    return { preset, start: null, end: null, label: "All time" };
  }

  if (preset === "custom") {
    if (!input.start || !input.end) throw new Error("Custom range requires start and end dates");
    const start = startOfUtcDay(parseUtcDateOnly(input.start, "start"));
    const end = endOfUtcDay(parseUtcDateOnly(input.end, "end"));
    if (start.getTime() > end.getTime()) throw new Error("start must be on or before end");
    return { preset, start, end, label: `${input.start} → ${input.end}` };
  }

  const end = endOfUtcDay(today);
  const start = startOfUtcDay(new Date(today));
  if (preset === "last_7_days") {
    start.setUTCDate(today.getUTCDate() - 6);
    return { preset, start, end, label: "Last 7 days" };
  }
  if (preset === "last_30_days") {
    start.setUTCDate(today.getUTCDate() - 29);
    return { preset, start, end, label: "Last 30 days" };
  }
  start.setUTCDate(today.getUTCDate() - 89);
  return { preset, start, end, label: "Last 90 days" };
}

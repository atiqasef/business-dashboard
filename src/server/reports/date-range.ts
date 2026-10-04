export const reportPresets = [
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_year",
  "previous_year",
  "custom",
] as const;

export type ReportPreset = (typeof reportPresets)[number];
export type ReportGranularity = "day" | "week" | "month";

export type ResolvedReportRange = {
  preset: ReportPreset;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  granularity: ReportGranularity;
  label: string;
};

export function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date) {
  return new Date(startOfUtcDay(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}

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

function daySpanInclusive(start: Date, end: Date) {
  return Math.floor((startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function resolveGranularity(start: Date, end: Date, preset: ReportPreset): ReportGranularity {
  if (preset === "this_year" || preset === "previous_year") return "month";
  const days = daySpanInclusive(start, end);
  if (days > 62) return "week";
  return "day";
}

function shiftRangeBack(start: Date, end: Date) {
  const lengthMs = end.getTime() - start.getTime() + 1;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - lengthMs + 1);
  return { previousStart, previousEnd };
}

export function resolveReportRange(input: {
  preset?: string | null;
  start?: string | null;
  end?: string | null;
}): ResolvedReportRange {
  const rawPreset = (input.preset ?? "last_30_days").trim();
  if (!reportPresets.includes(rawPreset as ReportPreset)) {
    throw new Error("Invalid report preset");
  }
  const preset = rawPreset as ReportPreset;
  const today = startOfUtcDay(new Date());

  let start: Date;
  let end: Date;
  let label: string;

  switch (preset) {
    case "last_7_days": {
      end = endOfUtcDay(today);
      start = startOfUtcDay(new Date(today));
      start.setUTCDate(today.getUTCDate() - 6);
      label = "Last 7 days";
      break;
    }
    case "last_30_days": {
      end = endOfUtcDay(today);
      start = startOfUtcDay(new Date(today));
      start.setUTCDate(today.getUTCDate() - 29);
      label = "Last 30 days";
      break;
    }
    case "last_90_days": {
      end = endOfUtcDay(today);
      start = startOfUtcDay(new Date(today));
      start.setUTCDate(today.getUTCDate() - 89);
      label = "Last 90 days";
      break;
    }
    case "this_year": {
      start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      end = endOfUtcDay(today);
      label = `This year (${today.getUTCFullYear()})`;
      break;
    }
    case "previous_year": {
      const year = today.getUTCFullYear() - 1;
      start = new Date(Date.UTC(year, 0, 1));
      end = endOfUtcDay(new Date(Date.UTC(year, 11, 31)));
      label = `Previous year (${year})`;
      break;
    }
    case "custom": {
      if (!input.start || !input.end) throw new Error("Custom range requires start and end dates");
      start = startOfUtcDay(parseUtcDateOnly(input.start, "start"));
      end = endOfUtcDay(parseUtcDateOnly(input.end, "end"));
      if (start.getTime() > end.getTime()) throw new Error("start must be on or before end");
      const maxDays = 366;
      if (daySpanInclusive(start, end) > maxDays) throw new Error(`Custom range cannot exceed ${maxDays} days`);
      label = `${input.start} → ${input.end}`;
      break;
    }
  }

  const { previousStart, previousEnd } = shiftRangeBack(start, end);
  return {
    preset,
    start,
    end,
    previousStart,
    previousEnd,
    granularity: resolveGranularity(start, end, preset),
    label,
  };
}

export function formatBucketKey(date: Date, granularity: ReportGranularity) {
  if (granularity === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (granularity === "week") {
    const day = startOfUtcDay(date);
    const dayNum = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 1 - dayNum);
    return day.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export function buildBucketSeries(
  start: Date,
  end: Date,
  granularity: ReportGranularity,
  points: Array<{ key: string; value: number; secondary?: number }>,
) {
  const byKey = new Map(points.map((point) => [point.key, point]));
  const series: Array<{ key: string; label: string; value: number; secondary: number }> = [];
  const cursor = startOfUtcDay(start);
  const last = startOfUtcDay(end);

  if (granularity === "month") {
    cursor.setUTCDate(1);
  } else if (granularity === "week") {
    const dayNum = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() + 1 - dayNum);
  }

  while (cursor.getTime() <= last.getTime()) {
    const key = formatBucketKey(cursor, granularity);
    if (!series.some((item) => item.key === key)) {
      const match = byKey.get(key);
      series.push({
        key,
        label: key,
        value: match ? Number(Number(match.value).toFixed(2)) : 0,
        secondary: match?.secondary ?? 0,
      });
    }

    if (granularity === "month") {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    } else if (granularity === "week") {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return series;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

import { ObjectId } from "mongodb";
import { ensureInvoiceIndexes, getInvoicesCollection, type InvoiceStatus } from "@/server/db/models/invoice";
import {
  ensureInvoiceReminderIndexes,
  getInvoiceRemindersCollection,
  reminderStatuses,
  reminderTypes,
  toInvoiceReminderResponse,
  type ReminderStatus,
  type ReminderType,
} from "@/server/db/models/invoice-reminder";
import { endOfUtcDay, startOfUtcDay } from "@/server/reports/date-range";
import {
  DEFAULT_REMINDER_PAGE_SIZE,
  DUE_SOON_WINDOW_DAYS,
  MAX_REMINDER_PAGE_SIZE,
} from "@/server/reminders/constants";
export type ReminderDatePreset = "all_time" | "last_7_days" | "last_30_days" | "last_90_days" | "custom";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function resolveReminderDateRange(input: {
  datePreset?: string | null;
  start?: string | null;
  end?: string | null;
}) {
  const preset = ((input.datePreset ?? "all_time").trim() || "all_time") as ReminderDatePreset;
  const allowed: ReminderDatePreset[] = ["all_time", "last_7_days", "last_30_days", "last_90_days", "custom"];
  if (!allowed.includes(preset)) throw new Error("Invalid date preset");

  if (preset === "all_time") return { preset, start: null as Date | null, end: null as Date | null, label: "All time" };

  const today = startOfUtcDay(new Date());
  if (preset === "custom") {
    if (!input.start || !input.end) throw new Error("Custom range requires start and end dates");
    const start = startOfUtcDay(parseUtcDateOnly(input.start, "start"));
    const end = endOfUtcDay(parseUtcDateOnly(input.end, "end"));
    if (start.getTime() > end.getTime()) throw new Error("start must be on or before end");
    return { preset, start, end, label: `${input.start} → ${input.end}` };
  }

  const end = endOfUtcDay(today);
  const start = startOfUtcDay(new Date(today));
  const days = preset === "last_7_days" ? 6 : preset === "last_30_days" ? 29 : 89;
  start.setUTCDate(today.getUTCDate() - days);
  return {
    preset,
    start,
    end,
    label: preset === "last_7_days" ? "Last 7 days" : preset === "last_30_days" ? "Last 30 days" : "Last 90 days",
  };
}

export async function getNotificationOverview(ownerId: string) {
  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceReminderIndexes()]);

  const now = new Date();
  const dueSoonEnd = new Date(now);
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + DUE_SOON_WINDOW_DAYS);

  const excludedStatuses: InvoiceStatus[] = ["draft", "cancelled", "paid"];
  const openInvoiceFilter = {
    ownerId,
    status: { $nin: excludedStatuses },
    outstandingAmount: { $gt: 0 },
  };

  const [overdueInvoices, dueSoonInvoices, sentCount, failedCount] = await Promise.all([
    getInvoicesCollection().countDocuments({
      ...openInvoiceFilter,
      dueDate: { $lt: now },
    }),
    getInvoicesCollection().countDocuments({
      ...openInvoiceFilter,
      dueDate: { $gte: now, $lte: dueSoonEnd },
    }),
    getInvoiceRemindersCollection().countDocuments({ ownerId, status: "sent" }),
    getInvoiceRemindersCollection().countDocuments({ ownerId, status: "failed" }),
  ]);

  return {
    overdueInvoices,
    dueSoonInvoices,
    remindersSent: sentCount,
    remindersFailed: failedCount,
  };
}

export async function listReminders(
  ownerId: string,
  options: {
    page?: string | null;
    pageSize?: string | null;
    search?: string | null;
    status?: string | null;
    type?: string | null;
    datePreset?: string | null;
    start?: string | null;
    end?: string | null;
  } = {},
) {
  if (!ownerId || typeof ownerId !== "string") throw new Error("ownerId is required");

  const page = Math.max(Number.parseInt(String(options.page ?? "1"), 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(Number.parseInt(String(options.pageSize ?? String(DEFAULT_REMINDER_PAGE_SIZE)), 10) || DEFAULT_REMINDER_PAGE_SIZE, 1),
    MAX_REMINDER_PAGE_SIZE,
  );

  const statusRaw = options.status?.trim() || "all";
  if (statusRaw !== "all" && !reminderStatuses.includes(statusRaw as ReminderStatus)) {
    throw new Error("status is invalid");
  }

  const typeRaw = options.type?.trim() || "all";
  if (typeRaw !== "all" && !reminderTypes.includes(typeRaw as ReminderType)) {
    throw new Error("type is invalid");
  }

  const range = resolveReminderDateRange({
    datePreset: options.datePreset,
    start: options.start,
    end: options.end,
  });

  await ensureInvoiceReminderIndexes();

  const filter: Record<string, unknown> = { ownerId };
  if (statusRaw !== "all") filter.status = statusRaw;
  if (typeRaw !== "all") filter.type = typeRaw;
  if (range.start && range.end) filter.createdAt = { $gte: range.start, $lte: range.end };

  const search = options.search?.trim();
  if (search) {
    const escaped = escapeRegExp(search);
    const or: Record<string, unknown>[] = [
      { invoiceNumber: { $regex: escaped, $options: "i" } },
      { customerName: { $regex: escaped, $options: "i" } },
      { recipientEmail: { $regex: escaped, $options: "i" } },
    ];
    if (/^[a-fA-F0-9]{24}$/.test(search)) {
      or.push({ _id: new ObjectId(search) });
      or.push({ invoiceId: new ObjectId(search) });
    }
    filter.$or = or;
  }

  const collection = getInvoiceRemindersCollection();
  const [reminders, total, overview] = await Promise.all([
    collection
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(filter),
    getNotificationOverview(ownerId),
  ]);

  return {
    data: reminders.map(toInvoiceReminderResponse),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
    overview,
    range: {
      preset: range.preset,
      label: range.label,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
    },
  };
}

export async function getReminderById(ownerId: string, reminderId: string) {
  if (!ObjectId.isValid(reminderId)) throw new Error("reminder id is invalid");
  await ensureInvoiceReminderIndexes();
  const reminder = await getInvoiceRemindersCollection().findOne({
    _id: new ObjectId(reminderId),
    ownerId,
  });
  return reminder ? toInvoiceReminderResponse(reminder) : null;
}

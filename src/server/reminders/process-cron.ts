import { ObjectId } from "mongodb";
import { ensureCustomerIndexes, getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection, type InvoiceStatus } from "@/server/db/models/invoice";
import {
  ensureInvoiceReminderIndexes,
  getInvoiceRemindersCollection,
  type ReminderType,
} from "@/server/db/models/invoice-reminder";
import {
  AUTOMATED_REMINDER_COOLDOWN_DAYS,
  DUE_SOON_WINDOW_DAYS,
  REMINDER_CRON_BATCH_LIMIT,
} from "@/server/reminders/constants";
import { isInvoiceEligibleForReminder, sendInvoiceReminder } from "@/server/reminders/send-reminder";

export type ReminderCronSummary = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
};

async function recentlySent(ownerId: string, invoiceId: ObjectId, type: ReminderType) {
  const since = new Date(Date.now() - AUTOMATED_REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  const match = await getInvoiceRemindersCollection().findOne({
    ownerId,
    invoiceId,
    type,
    status: "sent",
    createdAt: { $gte: since },
  });
  return Boolean(match);
}

/**
 * Processes a bounded batch of due-soon and overdue invoice reminders across all owners.
 * Safe to retry — cooldowns prevent duplicate sends.
 */
export async function processInvoiceReminderCron(): Promise<ReminderCronSummary> {
  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceReminderIndexes(), ensureCustomerIndexes()]);

  const now = new Date();
  const dueSoonEnd = new Date(now);
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + DUE_SOON_WINDOW_DAYS);

  const summary: ReminderCronSummary = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  const excludedStatuses: InvoiceStatus[] = ["draft", "cancelled", "paid"];
  const candidates = await getInvoicesCollection()
    .find(
      {
        status: { $nin: excludedStatuses },
        outstandingAmount: { $gt: 0 },
        dueDate: { $exists: true, $type: "date", $lte: dueSoonEnd },
      },
      {
        projection: {
          ownerId: 1,
          customerId: 1,
          status: 1,
          total: 1,
          paidAmount: 1,
          outstandingAmount: 1,
          dueDate: 1,
        },
      },
    )
    .sort({ dueDate: 1, _id: 1 })
    .limit(REMINDER_CRON_BATCH_LIMIT * 3)
    .toArray();

  for (const invoice of candidates) {
    if (summary.processed >= REMINDER_CRON_BATCH_LIMIT) break;
    if (!invoice._id || !invoice.dueDate) {
      summary.skipped += 1;
      continue;
    }
    if (!isInvoiceEligibleForReminder(invoice, now)) {
      summary.skipped += 1;
      continue;
    }

    const customer = await getCustomersCollection().findOne(
      { _id: invoice.customerId, ownerId: invoice.ownerId },
      { projection: { email: 1 } },
    );
    if (!customer?.email?.trim()) {
      summary.skipped += 1;
      continue;
    }

    const type: ReminderType = invoice.dueDate.getTime() < now.getTime() ? "overdue" : "due_soon";
    if (type === "due_soon" && invoice.dueDate.getTime() > dueSoonEnd.getTime()) {
      summary.skipped += 1;
      continue;
    }

    if (await recentlySent(invoice.ownerId, invoice._id, type)) {
      summary.skipped += 1;
      continue;
    }

    summary.processed += 1;
    try {
      const result = await sendInvoiceReminder({
        ownerId: invoice.ownerId,
        invoiceId: invoice._id.toHexString(),
        type,
      });
      if (result.sent) summary.sent += 1;
      else summary.failed += 1;
    } catch {
      // Cooldown/validation races — count as skipped and continue the batch.
      summary.skipped += 1;
      summary.processed -= 1;
    }
  }

  return summary;
}

export function authorizeCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret === secret;
}

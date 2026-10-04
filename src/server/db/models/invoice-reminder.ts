import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export const reminderTypes = ["due_soon", "overdue", "manual"] as const;
export type ReminderType = (typeof reminderTypes)[number];

export const reminderStatuses = ["sent", "failed"] as const;
export type ReminderStatus = (typeof reminderStatuses)[number];

export interface InvoiceReminderDocument {
  _id?: ObjectId;
  ownerId: string;
  invoiceId: ObjectId;
  customerId: ObjectId;
  invoiceNumber: string;
  customerName: string;
  type: ReminderType;
  recipientEmail: string;
  status: ReminderStatus;
  sentAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  providerMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getInvoiceRemindersCollection(): Collection<InvoiceReminderDocument> {
  return db.collection<InvoiceReminderDocument>("invoice-reminders");
}

export async function ensureInvoiceReminderIndexes() {
  if (!indexesPromise) {
    indexesPromise = getInvoiceRemindersCollection()
      .createIndexes([
        { key: { ownerId: 1, createdAt: -1 }, name: "owner_createdAt" },
        { key: { ownerId: 1, invoiceId: 1, createdAt: -1 }, name: "owner_invoice_createdAt" },
        { key: { ownerId: 1, status: 1, createdAt: -1 }, name: "owner_status_createdAt" },
        { key: { ownerId: 1, type: 1, invoiceId: 1, createdAt: -1 }, name: "owner_type_invoice_createdAt" },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toInvoiceReminderResponse(reminder: InvoiceReminderDocument) {
  return {
    id: reminder._id?.toString(),
    invoiceId: reminder.invoiceId.toString(),
    customerId: reminder.customerId.toString(),
    invoiceNumber: reminder.invoiceNumber,
    customerName: reminder.customerName,
    type: reminder.type,
    recipientEmail: reminder.recipientEmail,
    status: reminder.status,
    sentAt: reminder.sentAt ? reminder.sentAt.toISOString() : null,
    failedAt: reminder.failedAt ? reminder.failedAt.toISOString() : null,
    errorMessage: reminder.errorMessage ?? null,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

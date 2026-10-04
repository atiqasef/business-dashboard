import { ObjectId } from "mongodb";
import { getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection, type InvoiceDocument } from "@/server/db/models/invoice";
import {
  ensureInvoiceReminderIndexes,
  getInvoiceRemindersCollection,
  toInvoiceReminderResponse,
  type InvoiceReminderDocument,
  type ReminderType,
} from "@/server/db/models/invoice-reminder";
import { sendEmail } from "@/server/email/send-email";
import { EmailConfigurationError, EmailDeliveryError } from "@/server/email/types";
import { buildInvoiceReminderEmailContent } from "@/server/email/templates/invoice-reminder";
import { buildInvoicePdfBuffer, invoicePdfFilename } from "@/server/invoices/pdf";
import { deriveInvoiceStatus } from "@/server/invoices/status";
import {
  AUTOMATED_REMINDER_COOLDOWN_DAYS,
  MANUAL_REMINDER_COOLDOWN_HOURS,
} from "@/server/reminders/constants";
import { getInvoiceBusinessBranding } from "@/server/settings/business-profile";

export class ReminderValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReminderValidationError";
    this.status = status;
  }
}

export type ReminderResponse = ReturnType<typeof toInvoiceReminderResponse>;

export type SendReminderResult =
  | { sent: true; reminder: ReminderResponse }
  | { sent: false; reminder: ReminderResponse; error: string; status: number };

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sanitizeErrorMessage(error: unknown) {
  if (error instanceof EmailConfigurationError) return "Email is not configured.";
  if (error instanceof EmailDeliveryError) return "Email provider rejected the send request.";
  if (error instanceof Error) {
    const message = error.message.trim().slice(0, 240);
    if (!message) return "Unable to send reminder.";
    if (/api[_ ]?key|secret|token|authorization/i.test(message)) return "Unable to send reminder.";
    return message;
  }
  return "Unable to send reminder.";
}

export function isInvoiceEligibleForReminder(invoice: InvoiceDocument, now = new Date()) {
  if (invoice.status === "cancelled" || invoice.status === "draft") return false;
  const status = deriveInvoiceStatus(invoice, now);
  if (status === "paid" || status === "cancelled" || status === "draft") return false;
  if (invoice.outstandingAmount <= 0) return false;
  return true;
}

async function assertCooldown(ownerId: string, invoiceId: ObjectId, type: ReminderType) {
  const cooldownMs =
    type === "manual"
      ? MANUAL_REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000
      : AUTOMATED_REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - cooldownMs);

  const recent = await getInvoiceRemindersCollection().findOne({
    ownerId,
    invoiceId,
    type,
    status: "sent",
    createdAt: { $gte: since },
  });

  if (recent) {
    throw new ReminderValidationError(
      type === "manual"
        ? "A reminder was already sent recently. Please wait before sending another."
        : `An automated ${type.replace("_", " ")} reminder was already sent recently.`,
      409,
    );
  }
}

async function persistReminder(document: InvoiceReminderDocument) {
  const result = await getInvoiceRemindersCollection().insertOne(document);
  return toInvoiceReminderResponse({ ...document, _id: result.insertedId });
}

export async function sendInvoiceReminder(options: {
  ownerId: string;
  invoiceId: string;
  type: ReminderType;
}): Promise<SendReminderResult> {
  const { ownerId, type } = options;
  if (!ownerId || typeof ownerId !== "string") throw new ReminderValidationError("ownerId is required");
  if (!ObjectId.isValid(options.invoiceId)) throw new ReminderValidationError("invoice id is invalid");

  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceReminderIndexes()]);

  const invoiceId = new ObjectId(options.invoiceId);
  const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId });
  if (!invoice) throw new ReminderValidationError("Invoice not found", 404);

  if (!isInvoiceEligibleForReminder(invoice)) {
    if (invoice.status === "cancelled") throw new ReminderValidationError("Cannot remind for a cancelled invoice", 409);
    if (invoice.status === "draft") throw new ReminderValidationError("Cannot remind for a draft invoice", 409);
    throw new ReminderValidationError("Invoice is already fully paid", 409);
  }

  const customer = await getCustomersCollection().findOne({ _id: invoice.customerId, ownerId });
  if (!customer) throw new ReminderValidationError("Customer not found", 404);

  const recipient = customer.email?.trim().toLowerCase();
  if (!recipient) {
    throw new ReminderValidationError("Customer needs a valid email address before a reminder can be sent.", 422);
  }
  if (!isValidEmail(recipient)) {
    throw new ReminderValidationError("Customer email address is invalid.", 422);
  }

  await assertCooldown(ownerId, invoiceId, type);

  const now = new Date();
  const status = deriveInvoiceStatus(invoice, now);
  const customerName = `${customer.firstName} ${customer.lastName}`.trim() || invoice.customerSnapshot.name;
  const branding = await getInvoiceBusinessBranding(ownerId);

  const baseRecord: Omit<InvoiceReminderDocument, "_id"> = {
    ownerId,
    invoiceId,
    customerId: invoice.customerId,
    invoiceNumber: invoice.invoiceNumber,
    customerName,
    type,
    recipientEmail: recipient,
    status: "failed",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const pdfBuffer = await buildInvoicePdfBuffer({
      invoice,
      status,
      customer: {
        name: customerName,
        email: customer.email ?? null,
        phone: customer.phone ?? invoice.customerSnapshot.phone ?? null,
        company: customer.company ?? null,
        address: customer.address ?? null,
        city: customer.city ?? null,
        country: customer.country ?? null,
      },
      branding,
    });

    const content = buildInvoiceReminderEmailContent({
      invoice,
      status,
      customerName,
      reminderType: type,
      branding,
    });

    const result = await sendEmail({
      to: recipient,
      subject: content.subject,
      html: content.html,
      text: content.text,
      fromDisplayName: branding.businessName !== "Ledger" ? branding.businessName : undefined,
      attachments: [
        {
          filename: invoicePdfFilename(invoice.invoiceNumber),
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    const reminder = await persistReminder({
      ...baseRecord,
      status: "sent",
      sentAt: now,
      providerMessageId: result.id,
    });

    return { sent: true, reminder };
  } catch (error) {
    const reminder = await persistReminder({
      ...baseRecord,
      status: "failed",
      failedAt: now,
      errorMessage: sanitizeErrorMessage(error),
    });

    return {
      sent: false,
      reminder,
      error:
        error instanceof EmailConfigurationError
          ? error.message
          : "Unable to send payment reminder. Please try again later.",
      status: error instanceof EmailConfigurationError ? 503 : 502,
    };
  }
}

export async function retryInvoiceReminder(ownerId: string, reminderId: string) {
  if (!ObjectId.isValid(reminderId)) throw new ReminderValidationError("reminder id is invalid");
  await ensureInvoiceReminderIndexes();

  const existing = await getInvoiceRemindersCollection().findOne({
    _id: new ObjectId(reminderId),
    ownerId,
  });
  if (!existing) throw new ReminderValidationError("Reminder not found", 404);
  if (existing.status !== "failed") {
    throw new ReminderValidationError("Only failed reminders can be retried", 409);
  }

  return sendInvoiceReminder({
    ownerId,
    invoiceId: existing.invoiceId.toHexString(),
    type: existing.type,
  });
}
